
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

let currentCommand = null;

/**
 * Memulai streaming. Mendukung single file atau array of paths (Playlist).
 */
const startStream = (inputPaths, rtmpUrl, options = {}) => {
  if (currentCommand) {
    stopStream();
  }

  // Normalisasi input ke array
  const files = Array.isArray(inputPaths) ? inputPaths : [inputPaths];
  const isAllAudio = files.every(f => f.toLowerCase().endsWith('.mp3'));
  const shouldLoop = options.loop === true;
  
  // Buat file playlist untuk concat demuxer (Sangat ringan untuk VPS)
  const playlistPath = path.join(__dirname, 'uploads', 'playlist.txt');
  const playlistContent = files.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(playlistPath, playlistContent);

  return new Promise((resolve, reject) => {
    let command = ffmpeg();

    if (isAllAudio) {
      // MODE AUDIO PLAYLIST + BACKGROUND IMAGE
      const imagePath = options.coverImagePath || path.join(__dirname, 'default_cover.jpg');
      
      command
        .input(imagePath).inputOptions(['-loop 1'])
        .input(playlistPath).inputOptions([
          '-f concat',
          '-safe 0',
          shouldLoop ? '-stream_loop -1' : '',
          '-re'
        ].filter(Boolean));

      command.outputOptions([
        '-c:v libx264',
        '-preset ultrafast',
        '-tune stillimage',
        '-pix_fmt yuv420p',
        '-r 15',
        '-g 30',
        '-b:v 2000k',
        '-minrate 2000k',
        '-maxrate 2000k',
        '-bufsize 4000k',
        '-c:a aac',
        '-b:a 128k',
        '-ar 44100',
        '-shortest',
        '-f flv',
        '-flvflags no_duration_filesize'
      ]);
    } else {
      // MODE VIDEO PLAYLIST (Copy Codec - Zero CPU Load)
      command
        .input(playlistPath)
        .inputOptions([
          '-f concat',
          '-safe 0',
          shouldLoop ? '-stream_loop -1' : '',
          '-re'
        ].filter(Boolean));

      command.outputOptions([
        '-c copy', // Sangat penting untuk VPS 1GB RAM
        '-f flv',
        '-flvflags no_duration_filesize'
      ]);
    }

    currentCommand = command
      .on('start', (commandLine) => {
        console.log('FFmpeg Command:', commandLine);
        if (global.io) global.io.emit('log', { type: 'start', message: `Playlist dimulai (${files.length} file).` });
      })
      .on('stderr', (stderrLine) => {
        if (stderrLine.includes('bitrate=')) {
          if (global.io) global.io.emit('log', { type: 'debug', message: stderrLine });
        }
      })
      .on('error', (err) => {
        if (global.io) global.io.emit('log', { type: 'error', message: `Stream Error: ${err.message}` });
        currentCommand = null;
        reject(err);
      })
      .on('end', () => {
        if (global.io) global.io.emit('log', { type: 'end', message: 'Streaming Playlist selesai.' });
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
      console.log("FFmpeg process killed manually.");
    } catch (e) { console.error("Error killing FFmpeg:", e); }
    currentCommand = null;
    if (global.io) global.io.emit('log', { type: 'info', message: 'Streaming telah dihentikan oleh pengguna.' });
    return true;
  }
  return false;
};

const isStreaming = () => !!currentCommand;

module.exports = { startStream, stopStream, isStreaming };
