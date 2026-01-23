
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
      // MODE AUDIO PLAYLIST + BACKGROUND
      let imageInput = options.coverImagePath;
      
      // Jika imagePath tidak ada, gunakan solid black background generator dari ffmpeg
      if (!imageInput || !fs.existsSync(imageInput)) {
        command.input('color=c=black:s=1280x720:r=15').inputOptions(['-f lavfi']);
      } else {
        command.input(imageInput).inputOptions(['-loop 1']);
      }

      command.input(playlistPath).inputOptions([
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
        '-c:a aac',
        '-b:a 128k',
        '-ar 44100',
        '-shortest',
        '-f flv',
        '-flvflags no_duration_filesize'
      ]);
    } else {
      // MODE VIDEO PLAYLIST (Copy Codec)
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
        if (global.io) global.io.emit('log', { type: 'start', message: `Playlist Aktif: ${files.length} file.` });
      })
      .on('stderr', (stderrLine) => {
        if (stderrLine.includes('bitrate=')) {
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
    if (global.io) global.io.emit('log', { type: 'info', message: 'Stream dihentikan.' });
    return true;
  }
  return false;
};

const isStreaming = () => !!currentCommand;

module.exports = { startStream, stopStream, isStreaming };
