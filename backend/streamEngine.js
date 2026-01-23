
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

  return new Promise((resolve, reject) => {
    console.log(`Starting stream: ${inputPath} -> ${rtmpUrl} (Type: ${isAudio ? 'Audio' : 'Video'})`);
    
    let command;

    if (isAudio) {
      // KASUS B: Audio + Image
      const imagePath = options.coverImagePath || path.join(__dirname, 'default_cover.jpg');
      
      command = ffmpeg()
        .input(imagePath)
        .inputOptions(['-loop 1'])
        .input(inputPath)
        .inputOptions(['-re']) // PENTING: Memaksa audio dibaca real-time (1x speed)
        .outputOptions([
          '-c:v libx264',
          '-preset ultrafast', 
          '-tune stillimage',  
          '-r 2',              // Hemat CPU: Hanya 2 frame per detik
          '-c:a aac',
          '-b:a 128k',
          '-pix_fmt yuv420p',
          '-shortest',         
          '-f flv',
          '-flvflags no_duration_filesize'
        ]);
    } else {
      // KASUS A: Video (Direct Copy)
      command = ffmpeg(inputPath)
        .inputOptions(['-re']) // PENTING: Memaksa video dibaca real-time
        .outputOptions([
          '-c:v copy',
          '-c:a copy',
          '-f flv',
          '-flvflags no_duration_filesize'
        ]);
    }

    currentCommand = command
      .on('start', (commandLine) => {
        console.log('FFmpeg Spawned:', commandLine);
        if (global.io) global.io.emit('log', { type: 'start', message: `Stream Dimulai: ${isAudio ? 'Mode Hemat CPU (Audio)' : 'Mode Direct Copy (Video)'}` });
      })
      .on('stderr', (stderrLine) => {
        // Hanya kirim log yang berguna ke dashboard agar tidak lag
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
        if (global.io) global.io.emit('log', { type: 'end', message: 'Streaming telah selesai secara normal.' });
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
    if (global.io) global.io.emit('log', { type: 'info', message: 'Streaming dihentikan secara manual.' });
    return true;
  }
  return false;
};

const isStreaming = () => {
  return !!currentCommand;
};

module.exports = { startStream, stopStream, isStreaming };
