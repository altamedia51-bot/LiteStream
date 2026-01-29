
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { PassThrough } = require('stream');
const { db } = require('./database');

let currentCommand = null;
let activeInputStream = null; 
let currentStreamLoopActive = false; 
let currentStreamUserId = null;

// Updated: Accepts an ARRAY of destinations instead of a single URL
const startStream = (inputPaths, destinations, options = {}) => {
  if (currentCommand) {
    stopStream();
  }

  if (!destinations || destinations.length === 0) {
      throw new Error("No active streaming destinations found.");
  }

  const files = Array.isArray(inputPaths) ? inputPaths : [inputPaths];
  const isAllAudio = files.every(f => f.toLowerCase().endsWith('.mp3'));
  const shouldLoop = !!options.loop;
  currentStreamUserId = options.userId;
  
  currentStreamLoopActive = true;

  return new Promise((resolve, reject) => {
    let command = ffmpeg();
    let lastProcessedSecond = 0;

    if (isAllAudio) {
      const mixedStream = new PassThrough();
      activeInputStream = mixedStream;
      let fileIndex = 0;

      const playNextSong = () => {
        if (!currentStreamLoopActive) return;
        const currentFile = files[fileIndex];
        const songStream = fs.createReadStream(currentFile);
        songStream.pipe(mixedStream, { end: false });

        songStream.on('end', () => {
           fileIndex++;
           if (fileIndex >= files.length) {
             if (shouldLoop) {
               fileIndex = 0; 
               playNextSong(); 
             } else {
               mixedStream.end();
             }
           } else {
             playNextSong();
           }
        });
        songStream.on('error', (err) => {
           fileIndex++;
           playNextSong();
        });
      };

      playNextSong();

      const videoFilter = [
        'scale=1280:720:force_original_aspect_ratio=decrease',
        'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black',
        'format=yuv420p'
      ].join(',');

      let imageInput = options.coverImagePath;
      if (!imageInput || !fs.existsSync(imageInput)) {
        command.input('color=c=black:s=1280x720:r=24').inputOptions(['-f lavfi', '-re']);
      } else {
        command.input(imageInput).inputOptions(['-loop 1', '-framerate 2', '-re']); 
      }

      command.input(mixedStream).inputFormat('mp3').inputOptions(['-re']); 

      // GLOBAL ENCODING OPTIONS (Applied once, then mapped to multiple outputs)
      // Note: Fluent-ffmpeg applies .outputOptions() to the immediately preceding output.
      // However, if we define them before outputs, some versions might behave differently.
      // Safe strategy: Define input options -> Add Outputs with their specific flags.
      // Since we want the SAME encoding for all, we will repeat the encoding flags for each output
      // OR rely on ffmpeg's ability to reuse the encoded stream.
      
      const encodingFlags = [
        '-map 0:v', '-map 1:a', `-vf ${videoFilter}`,
        '-c:v libx264', '-preset ultrafast', '-r 24', '-g 48', '-keyint_min 48', '-sc_threshold 0',
        '-b:v 3000k', '-minrate 3000k', '-maxrate 3000k', '-bufsize 6000k', '-nal-hrd cbr',
        '-c:a aac', '-b:a 128k', '-ar 44100', '-af aresample=async=1',
        '-f flv', '-flvflags no_duration_filesize'
      ];

      // Add outputs for each destination
      destinations.forEach(dest => {
          const fullUrl = dest.rtmp_url + dest.stream_key;
          command.output(fullUrl).outputOptions(encodingFlags);
      });

    } else {
      // Playlist logic (Existing video files)
      const playlistPath = path.join(__dirname, 'uploads', 'playlist.txt');
      const playlistContent = files.map(f => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`).join('\n');
      fs.writeFileSync(playlistPath, playlistContent);

      const videoInputOpts = ['-f', 'concat', '-safe', '0', '-re'];
      if (shouldLoop) videoInputOpts.unshift('-stream_loop', '-1');

      command.input(playlistPath).inputOptions(videoInputOpts);
      
      const copyFlags = ['-c copy', '-f flv', '-flvflags no_duration_filesize'];
      
      destinations.forEach(dest => {
          const fullUrl = dest.rtmp_url + dest.stream_key;
          command.output(fullUrl).outputOptions(copyFlags);
      });
    }

    currentCommand = command
      .on('start', (commandLine) => {
        const destNames = destinations.map(d => d.name || d.platform).join(', ');
        if (global.io) global.io.emit('log', { type: 'start', message: `Multi-Stream Started to: ${destNames}` });
      })
      .on('progress', (progress) => {
        if (!currentStreamUserId) return;

        const currentTimemark = progress.timemark; 
        const parts = currentTimemark.split(':');
        const totalSeconds = (+parts[0]) * 3600 + (+parts[1]) * 60 + (+parseFloat(parts[2]));
        const diff = Math.floor(totalSeconds - lastProcessedSecond);

        if (diff >= 5) { 
            lastProcessedSecond = totalSeconds;
            
            db.get(`
                SELECT u.usage_seconds, p.daily_limit_hours 
                FROM users u JOIN plans p ON u.plan_id = p.id 
                WHERE u.id = ?`, [currentStreamUserId], (err, row) => {
                if (row) {
                    const newUsage = row.usage_seconds + diff;
                    const limitSeconds = row.daily_limit_hours * 3600;

                    db.run("UPDATE users SET usage_seconds = ? WHERE id = ?", [newUsage, currentStreamUserId]);

                    if (newUsage >= limitSeconds) {
                        if (global.io) global.io.emit('log', { type: 'error', message: 'Batas penggunaan harian tercapai! Stream dimatikan otomatis.' });
                        stopStream();
                    }

                    if (global.io) {
                        global.io.emit('stats', { 
                            duration: progress.timemark, 
                            bitrate: progress.currentKbps ? Math.round(progress.currentKbps) + ' kbps' : 'N/A',
                            usage_remaining: Math.max(0, limitSeconds - newUsage),
                            destination_count: destinations.length
                        });
                    }
                }
            });
        }
      })
      .on('error', (err) => {
        if (err.message.includes('SIGKILL')) return;
        if (global.io) global.io.emit('log', { type: 'error', message: 'Stream Error: ' + err.message });
        currentCommand = null;
        reject(err);
      })
      .on('end', () => {
        currentCommand = null;
        if (global.io) global.io.emit('log', { type: 'end', message: 'Stream finished.' });
        resolve();
      });

    // Run without explicit save() argument because we used .output() multiple times
    currentCommand.run();
  });
};

const stopStream = () => {
  currentStreamLoopActive = false;
  currentStreamUserId = null;
  if (activeInputStream) {
      try { activeInputStream.end(); } catch(e) {}
      activeInputStream = null;
  }
  if (currentCommand) {
    try { currentCommand.kill('SIGKILL'); } catch (e) {}
    currentCommand = null;
    return true;
  }
  return false;
};

const isStreaming = () => !!currentCommand;

module.exports = { startStream, stopStream, isStreaming };
