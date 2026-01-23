
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');

let currentCommand = null;

/**
 * Starts a stream using FFmpeg with stabilization for low-resource VPS.
 */
const startStream = (inputPath, rtmpUrl, options = {}) => {
  if (currentCommand) {
    console.log("Stopping existing stream first...");
    stopStream();
  }

  const isAudio = inputPath.toLowerCase().endsWith('.mp3');
  const shouldLoop = options.loop === true;

  return new Promise((resolve, reject) => {
    console.log(`Starting stable stream: ${inputPath} -> ${rtmpUrl} (Loop: ${shouldLoop})`);
    
    let command = ffmpeg();

    // STABILIZATION: Tambah thread_queue_size untuk mencegah "Thread message queue blocking"
    // Ini sangat penting di VPS dengan CPU rendah agar input tidak 'telat' dibaca.

    if (isAudio) {
      const imagePath = options.coverImagePath || path.join(__dirname, 'default_cover.jpg');
      
      command
        .input(imagePath)
        .inputOptions(['-loop 1', '-thread_queue_size 1024'])
        
      if (shouldLoop) {
        command.input(inputPath).inputOptions(['-stream_loop -1', '-re', '-thread_queue_size 1024']);
      } else {
        command.input(inputPath).inputOptions(['-re', '-thread_queue_size 1024']);
      }

      command.outputOptions([
        '-c:v libx264',
        '-preset ultrafast', 
        '-tune stillimage',  
        '-r 10',             // Naikkan ke 10 FPS (lebih stabil untuk standar RTMP daripada 2 FPS)
        '-g 20',             // Keyframe setiap 2 detik (10 fps * 2) agar server tujuan tidak 'loading'
        '-c:a aac',
        '-b:a 128k',
        '-ar 44100',
        '-pix_fmt yuv420p',
        // CBR SETTINGS (Mencegah lonjakan data yang bikin buffering)
        '-maxrate 1500k',
        '-bufsize 3000k', 
        '-shortest',
        '-f flv',
        '-flvflags no_duration_filesize'
      ]);
    } else {
      // VIDEO MODE
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
        console.log('FFmpeg Stable Spawned:', commandLine);
        if (global.io) global.io.emit('log', { type: 'start', message: `Stream Stabil Dimulai ${shouldLoop ? '(Looping Aktif)' : ''}` });
      })
      .on('stderr', (stderrLine) => {
        // Filter log agar tidak membebani socket
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
    try {
        currentCommand.kill('SIGKILL');
    } catch (e) {
        console.error("Kill error", e);
    }
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
