
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');

let currentCommand = null;

/**
 * Starts a stream using FFmpeg.
 * @param {string} inputPath - Local path to the media file (mp4 or mp3)
 * @param {string} rtmpUrl - Target RTMP endpoint
 * @param {object} options - Optional settings like coverImagePath for audio
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
      // KASUS B: Audio + Image (Needs encoding but optimized for low-resource VPS)
      // Use a default image if none provided
      const imagePath = options.coverImagePath || path.join(__dirname, 'default_cover.jpg');
      
      command = ffmpeg()
        .input(imagePath)
        .inputOptions(['-loop 1'])
        .input(inputPath)
        .outputOptions([
          '-c:v libx264',
          '-preset ultrafast', // Fast encoding, low CPU
          '-tune stillimage',  // Optimization for static background
          '-r 2',              // 2 FPS is plenty for a still image, huge CPU save
          '-c:a aac',
          '-b:a 128k',
          '-pix_fmt yuv420p',
          '-shortest',         // Stop when audio ends
          '-f flv',
          '-flvflags no_duration_filesize'
        ]);
    } else {
      // KASUS A: Video (Standard copy-paste streaming)
      command = ffmpeg(inputPath)
        .inputOptions(['-re'])
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
        if (global.io) global.io.emit('log', { type: 'start', message: `FFmpeg started: ${isAudio ? 'Audio-to-Video' : 'Direct Copy'}` });
      })
      .on('progress', (progress) => {
        if (global.io) global.io.emit('streamProgress', progress);
      })
      .on('stderr', (stderrLine) => {
        if (stderrLine.includes('frame=')) {
          if (global.io) global.io.emit('log', { type: 'debug', message: stderrLine });
        }
      })
      .on('error', (err, stdout, stderr) => {
        console.error('FFmpeg Error:', err.message);
        if (global.io) global.io.emit('log', { type: 'error', message: `FFmpeg Error: ${err.message}` });
        currentCommand = null;
        reject(err);
      })
      .on('end', () => {
        console.log('Stream finished successfully');
        if (global.io) global.io.emit('log', { type: 'end', message: 'Stream ended' });
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
    if (global.io) global.io.emit('log', { type: 'info', message: 'Manual stream stop' });
    return true;
  }
  return false;
};

const isStreaming = () => {
  return !!currentCommand;
};

module.exports = { startStream, stopStream, isStreaming };
