
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');

let currentCommand = null;

/**
 * Starts a stream using FFmpeg.
 */
const startStream = (inputPath, rtmpUrl, options = {}) => {
  if (currentCommand) {
    console.log("Stopping existing stream first...");
    stopStream();
  }

  const isAudio = inputPath.toLowerCase().endsWith('.mp3');
  const shouldLoop = options.loop === true;

  return new Promise((resolve, reject) => {
    console.log(`Starting stream: ${inputPath} -> ${rtmpUrl} (Loop: ${shouldLoop})`);
    
    let command = ffmpeg();

    if (isAudio) {
      // KASUS B: Audio + Image
      const imagePath = options.coverImagePath || path.join(__dirname, 'default_cover.jpg');
      
      // Input Gambar (Looping selamanya untuk visual)
      command.input(imagePath).inputOptions(['-loop 1']);
      
      // Input Audio (Looping jika diminta)
      if (shouldLoop) {
        command.input(inputPath).inputOptions(['-stream_loop -1', '-re']);
      } else {
        command.input(inputPath).inputOptions(['-re']);
      }

      command.outputOptions([
        '-c:v libx264',
        '-preset ultrafast', 
        '-tune stillimage',  
        '-r 2',              // Hemat CPU: Hanya 2 frame per detik
        '-c:a aac',
        '-b:a 128k',
        '-pix_fmt yuv420p',
        '-shortest',         // Berhenti jika audio selesai (jika tidak loop)
        '-f flv',
        '-flvflags no_duration_filesize'
      ]);
    } else {
      // KASUS A: Video
      if (shouldLoop) {
        command.input(inputPath).inputOptions(['-stream_loop -1', '-re']);
      } else {
        command.input(inputPath).inputOptions(['-re']);
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
        if (global.io) global.io.emit('log', { type: 'start', message: `Stream Dimulai ${shouldLoop ? '(Looping Aktif)' : ''}` });
      })
      .on('stderr', (stderrLine) => {
        if (stderrLine.includes('bitrate=') || stderrLine.includes('frame=')) {
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
        console.log('Stream finished');
        if (global.io) global.io.emit('log', { type: 'end', message: 'Streaming telah selesai.' });
        currentCommand = null;
        resolve();
      });

    currentCommand.save(rtmpUrl);
  });
};

const stopStream = () => {
  if (currentCommand) {
    currentCommand.kill('SIGKILL');
    currentCommand = null;
    if (global.io) global.io.emit('log', { type: 'info', message: 'Streaming dihentikan manual.' });
    return true;
  }
  return false;
};

const isStreaming = () => {
  return !!currentCommand;
};

module.exports = { startStream, stopStream, isStreaming };
