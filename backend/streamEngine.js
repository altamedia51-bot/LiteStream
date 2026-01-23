
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
      // Konfigurasi ini dioptimalkan untuk menjaga koneksi RTMP tetap hidup (Keep-Alive)
      // meskipun gambar visualnya statis.

      // 1. INPUT 0: VISUAL (Image/Color)
      let imageInput = options.coverImagePath;
      if (!imageInput || !fs.existsSync(imageInput)) {
        command.input('color=c=black:s=1280x720:r=24').inputOptions(['-f lavfi']);
      } else {
        command.input(imageInput).inputOptions(['-loop 1']);
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
        // Mapping Eksplisit: Mencegah FFmpeg salah pilih stream
        '-map 0:v', 
        '-map 1:a',

        '-c:v libx264',
        '-preset ultrafast', // Hemat CPU VPS
        // '-tune stillimage' DIHAPUS: Menyebabkan bitrate drop ke 0 dan disconnect
        '-pix_fmt yuv420p',
        
        '-r 24',           // FPS Standar YouTube/FB
        '-g 48',           // Keyframe tiap 2 detik (24*2). Wajib untuk stabilitas.
        '-keyint_min 48',
        '-sc_threshold 0', // Matikan deteksi scene agar bitrate rata
        
        '-b:v 2500k',      // Bitrate video konstan (CBR)
        '-maxrate 2500k',
        '-bufsize 5000k',
        
        '-c:a aac',
        '-b:a 128k',
        '-ar 44100',       // Sample rate standar
        
        '-shortest',       // Stream mati jika playlist audio habis (walau gambar looping)
        '-max_muxing_queue_size 9999', // Mencegah crash "buffer overflow"
        
        '-f flv',
        '-flvflags no_duration_filesize'
      ]);

    } else {
      // --- MODE VIDEO (Direct Stream Copy) ---
      // Paling ringan CPU karena tidak ada encoding ulang
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
        // Filter log spam, hanya tampilkan info penting/error
        if (stderrLine.includes('bitrate=') || stderrLine.includes('Error') || stderrLine.includes('Conversion failed')) {
            // Deteksi bitrate drop
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
