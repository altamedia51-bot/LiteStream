
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');

let currentCommand = null;

/**
 * Memulai streaming dengan optimasi CBR (Constant Bitrate) untuk mencegah loading/buffering.
 */
const startStream = (inputPath, rtmpUrl, options = {}) => {
  if (currentCommand) {
    stopStream();
  }

  const isAudio = inputPath.toLowerCase().endsWith('.mp3');
  const shouldLoop = options.loop === true;

  return new Promise((resolve, reject) => {
    let command = ffmpeg();

    // Input Configuration
    if (isAudio) {
      const imagePath = options.coverImagePath || path.join(__dirname, 'default_cover.jpg');
      
      // Input Gambar (Looping untuk visual)
      command.input(imagePath).inputOptions(['-loop 1', '-thread_queue_size 1024']);
      
      // Input Audio
      if (shouldLoop) {
        command.input(inputPath).inputOptions(['-stream_loop -1', '-re', '-thread_queue_size 1024']);
      } else {
        command.input(inputPath).inputOptions(['-re', '-thread_queue_size 1024']);
      }

      // Output Settings untuk Audio + Image (Butuh Re-encoding Video)
      command.outputOptions([
        '-c:v libx264',
        '-preset ultrafast', // Sangat penting untuk VPS 1 Core
        '-tune stillimage',
        '-pix_fmt yuv420p',
        '-r 15',             // 15 FPS lebih disukai YouTube daripada 2/10 FPS
        '-g 30',             // Keyframe setiap 2 detik (15fps * 2)
        
        // CBR SETTINGS (Solusi untuk "Low Bitrate" Warning)
        '-b:v 2000k',        // Set video bitrate ke 2000k agar stabil
        '-minrate 2000k',
        '-maxrate 2000k',
        '-bufsize 4000k',    // Buffer 2x dari bitrate
        
        '-c:a aac',
        '-b:a 128k',
        '-ar 44100',
        '-shortest',         // Berhenti jika salah satu input habis (berguna jika tidak loop)
        '-f flv',
        '-flvflags no_duration_filesize'
      ]);
    } else {
      // VIDEO MODE (Copy codec agar hemat CPU)
      if (shouldLoop) {
        command.input(inputPath).inputOptions(['-stream_loop -1', '-re', '-thread_queue_size 1024']);
      } else {
        command.input(inputPath).inputOptions(['-re', '-thread_queue_size 1024']);
      }

      command.outputOptions([
        '-c:v copy',
        '-c:a copy',
        '-f flv',
        '-flvflags no_duration_filesize'
      ]);
    }

    currentCommand = command
      .on('start', (commandLine) => {
        console.log('FFmpeg Spawned:', commandLine);
        if (global.io) global.io.emit('log', { type: 'start', message: `Stream Aktif (Loop: ${shouldLoop}) - Bitrate: 2000kbps` });
      })
      .on('stderr', (stderrLine) => {
        // Hanya kirim stats bitrate ke dashboard agar tidak lag
        if (stderrLine.includes('bitrate=')) {
          if (global.io) global.io.emit('log', { type: 'debug', message: stderrLine });
        }
      })
      .on('error', (err) => {
        console.error('FFmpeg Error:', err.message);
        if (global.io) global.io.emit('log', { type: 'error', message: `FFmpeg Error: ${err.message}` });
        currentCommand = null;
        reject(err);
      })
      .on('end', () => {
        if (global.io) global.io.emit('log', { type: 'end', message: 'Streaming selesai.' });
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
    } catch (e) { console.error(e); }
    currentCommand = null;
    if (global.io) global.io.emit('log', { type: 'info', message: 'Stream dihentikan.' });
    return true;
  }
  return false;
};

const isStreaming = () => !!currentCommand;

module.exports = { startStream, stopStream, isStreaming };
