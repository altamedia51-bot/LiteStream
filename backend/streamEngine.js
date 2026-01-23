
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

let currentCommand = null;

const startStream = (inputPaths, rtmpUrl, options = {}) => {
  if (currentCommand) {
    stopStream();
  }

  const files = Array.isArray(inputPaths) ? inputPaths : [inputPaths];
  const isAllAudio = files.every(f => f.toLowerCase().endsWith('.mp3'));
  // Ubah ke loose boolean check agar lebih aman
  const shouldLoop = !!options.loop;
  
  // FIX: Gunakan path absolute agar FFmpeg tidak bingung mencari file
  const playlistPath = path.join(__dirname, 'uploads', 'playlist.txt');
  const playlistContent = files.map(f => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(playlistPath, playlistContent);

  return new Promise((resolve, reject) => {
    let command = ffmpeg();

    if (isAllAudio) {
      // --- MODE AUDIO (RADIO/PODCAST) ---
      
      const videoFilter = [
        'scale=1280:720:force_original_aspect_ratio=decrease',
        'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black',
        'format=yuv420p'
      ].join(',');

      // 1. INPUT 0: VISUAL (Image/Color)
      let imageInput = options.coverImagePath;
      if (!imageInput || !fs.existsSync(imageInput)) {
        command.input('color=c=black:s=1280x720:r=24')
               .inputOptions(['-f lavfi', '-re']);
      } else {
        command.input(imageInput)
               .inputOptions(['-loop 1', '-framerate 2', '-re']); 
      }

      // 2. INPUT 1: AUDIO (Playlist)
      // FIX ORDER: -stream_loop harus didefinisikan SEBELUM input file dan SEBELUM format concat
      const audioInputOptions = [];
      if (shouldLoop) {
          audioInputOptions.push('-stream_loop', '-1');
      }
      audioInputOptions.push('-f', 'concat', '-safe', '0');
      
      command.input(playlistPath).inputOptions(audioInputOptions);

      // OUTPUT OPTIONS
      const outputOpts = [
        '-map 0:v', 
        '-map 1:a',
        `-vf ${videoFilter}`,
        '-c:v libx264',
        '-preset ultrafast',
        
        '-r 24',
        '-g 48',
        '-keyint_min 48',
        '-sc_threshold 0',
        
        // FIX BITRATE YOUTUBE
        '-b:v 3000k',
        '-minrate 3000k', 
        '-maxrate 3000k',
        '-bufsize 6000k',
        '-nal-hrd cbr',
        
        '-c:a aac',
        '-b:a 128k',
        '-ar 44100',
        
        // FIX LOOP GAP: Resample audio agar timestamp tetap sinkron saat loop
        '-af aresample=async=1',
        
        '-fflags +genpts+igndts', 
        '-max_muxing_queue_size 9999',
        '-ignore_unknown',
        
        '-f flv',
        '-flvflags no_duration_filesize'
      ];

      // CRITICAL FIX: Hanya gunakan -shortest jika TIDAK looping.
      if (!shouldLoop) {
        outputOpts.push('-shortest');
      }

      command.outputOptions(outputOpts);

    } else {
      // --- MODE VIDEO (Direct Stream Copy) ---
      // Fix order for video loop as well
      const videoInputOpts = ['-f', 'concat', '-safe', '0', '-re'];
      if (shouldLoop) videoInputOpts.unshift('-stream_loop', '-1');

      command
        .input(playlistPath)
        .inputOptions(videoInputOpts);

      command.outputOptions([
        '-c copy',
        '-f flv',
        '-flvflags no_duration_filesize'
      ]);
    }

    currentCommand = command
      .on('start', (commandLine) => {
        console.log('FFmpeg Engine Started:', commandLine);
        if (global.io) global.io.emit('log', { type: 'start', message: `Playlist Aktif: ${files.length} file. Loop: ${shouldLoop}` });
      })
      .on('progress', (progress) => {
        if (global.io) {
            global.io.emit('stats', { 
                duration: progress.timemark, 
                bitrate: progress.currentKbps ? Math.round(progress.currentKbps) + ' kbps' : 'N/A' 
            });
        }
      })
      .on('stderr', (stderrLine) => {
        // Filter some harmless looping warnings
        if (stderrLine.includes('DTS') || stderrLine.includes('non-monotonous')) return;

        if (stderrLine.includes('bitrate=') || stderrLine.includes('Error') || stderrLine.includes('Conversion failed')) {
            if (global.io) global.io.emit('log', { type: 'debug', message: stderrLine });
        }
      })
      .on('error', (err) => {
        console.error("FFmpeg Error:", err.message);
        if (global.io) global.io.emit('log', { type: 'error', message: `Engine Failure: ${err.message}` });
        currentCommand = null;
        reject(err);
      })
      .on('end', () => {
        if (global.io) global.io.emit('log', { type: 'end', message: 'Playlist Selesai.' });
        currentCommand = null;
        resolve();
      });

    currentCommand.save(rtmpUrl);
  });
};

const stopStream = () => {
  if (currentCommand) {
    try {
      currentCommand.kill('SIGKILL');
    } catch (e) {}
    currentCommand = null;
    if (global.io) global.io.emit('log', { type: 'info', message: 'Stream dihentikan oleh user.' });
    return true;
  }
  return false;
};

const isStreaming = () => !!currentCommand;

module.exports = { startStream, stopStream, isStreaming };
