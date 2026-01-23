
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
  const shouldLoop = options.loop === true;
  
  const playlistPath = path.join(__dirname, 'uploads', 'playlist.txt');
  const playlistContent = files.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(playlistPath, playlistContent);

  return new Promise((resolve, reject) => {
    let command = ffmpeg();

    if (isAllAudio) {
      // --- MODE AUDIO (RADIO/PODCAST) ---
      
      // Filter Complex: Memaksa gambar input menjadi 720p (1280x720)
      // Ini PENTING untuk mencegah error "width not divisible by 2" pada libx264
      // jika user mengupload gambar dengan dimensi ganjil (misal 505x505).
      const videoFilter = [
        'scale=1280:720:force_original_aspect_ratio=decrease',
        'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black',
        'format=yuv420p' // Memastikan format pixel didukung player
      ].join(',');

      // 1. INPUT 0: VISUAL (Image/Color)
      let imageInput = options.coverImagePath;
      if (!imageInput || !fs.existsSync(imageInput)) {
        command.input('color=c=black:s=1280x720:r=24').inputOptions(['-f lavfi']);
      } else {
        // -loop 1: Loop gambar selamanya
        // -framerate 2: Set fps input rendah untuk hemat CPU sebelum encoding
        command.input(imageInput).inputOptions(['-loop 1', '-framerate 2']); 
      }

      // 2. INPUT 1: AUDIO (Playlist)
      command.input(playlistPath).inputOptions([
        '-f concat',
        '-safe 0',
        shouldLoop ? '-stream_loop -1' : '',
        '-re'
      ].filter(Boolean));

      // OUTPUT OPTIONS
      command.outputOptions([
        '-map 0:v', 
        '-map 1:a',

        // Terapkan Filter Video
        `-vf ${videoFilter}`,

        '-c:v libx264',
        '-preset ultrafast', // Hemat CPU VPS
        
        '-r 24',           // Output FPS 24 (Standar Stabil)
        '-g 48',           // Keyframe tiap 2 detik
        '-keyint_min 48',
        '-sc_threshold 0',
        
        '-b:v 2500k',      // Video Bitrate
        '-maxrate 2500k',
        '-bufsize 5000k',
        
        '-c:a aac',        // Audio Codec
        '-b:a 128k',       // Audio Bitrate
        '-ar 44100',       // Sample Rate
        
        '-shortest',       // Stop stream jika audio habis
        '-max_muxing_queue_size 9999',
        
        '-f flv',
        '-flvflags no_duration_filesize'
      ]);

    } else {
      // --- MODE VIDEO (Direct Stream Copy) ---
      command
        .input(playlistPath)
        .inputOptions([
          '-f concat',
          '-safe 0',
          shouldLoop ? '-stream_loop -1' : '',
          '-re'
        ].filter(Boolean));

      command.outputOptions([
        '-c copy',
        '-f flv',
        '-flvflags no_duration_filesize'
      ]);
    }

    currentCommand = command
      .on('start', (commandLine) => {
        console.log('FFmpeg Engine Started:', commandLine);
        if (global.io) global.io.emit('log', { type: 'start', message: `Playlist Aktif: ${files.length} file. Engine: ${isAllAudio ? 'Audio-Visual Muxer' : 'Direct Copy'}` });
      })
      .on('stderr', (stderrLine) => {
        if (stderrLine.includes('bitrate=') || stderrLine.includes('Error') || stderrLine.includes('Conversion failed')) {
            if (stderrLine.includes('bitrate=   0.0kbits/s')) {
                console.warn("WARNING: Bitrate 0 detected!");
            }
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
