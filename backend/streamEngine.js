
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
  
  // STRATEGI LOOP STABIL:
  // FFmpeg sering gagal melakukan looping timestamps dengan flag -stream_loop -1 pada RTMP.
  // Solusi paling stabil untuk VPS adalah menduplikasi entry di playlist.txt sebanyak mungkin (misal 1000x).
  // Ini memastikan timestamps selalu linear tanpa reset, mencegah streaming mati.
  const loopCount = shouldLoop ? 1000 : 1;
  const playlistEntries = [];
  
  for (let i = 0; i < loopCount; i++) {
      files.forEach(f => {
          playlistEntries.push(`file '${path.resolve(f).replace(/'/g, "'\\''")}'`);
      });
  }

  // FIX: Gunakan path absolute agar FFmpeg tidak bingung mencari file
  const playlistPath = path.join(__dirname, 'uploads', 'playlist.txt');
  fs.writeFileSync(playlistPath, playlistEntries.join('\n'));

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
      // Menggunakan -re di sini sebagai Master Clock
      let imageInput = options.coverImagePath;
      if (!imageInput || !fs.existsSync(imageInput)) {
        command.input('color=c=black:s=1280x720:r=24')
               .inputOptions(['-f lavfi', '-re']);
      } else {
        command.input(imageInput)
               .inputOptions(['-loop 1', '-framerate 2', '-re']); 
      }

      // 2. INPUT 1: AUDIO (Playlist)
      // Kita tidak menggunakan -stream_loop lagi, tapi mengandalkan playlist yang sangat panjang.
      command.input(playlistPath).inputOptions([
        '-f', 'concat', 
        '-safe', '0'
      ]);

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
        
        // CRITICAL FIX FOR AUDIO SYNC:
        // 1. aresample: Koreksi drift sampling rate
        // 2. asetpts=N/SR/TB: Generate timestamp baru yang monoton (terus naik) berdasarkan jumlah sampel.
        //    Ini mencegah error "Non-monotonous DTS" yang mematikan stream saat ganti lagu atau loop.
        '-af aresample=async=1000,asetpts=N/SR/TB',
        
        '-fflags +genpts+igndts', 
        '-max_muxing_queue_size 9999',
        '-ignore_unknown',
        
        '-f flv',
        '-flvflags no_duration_filesize'
      ];

      // CRITICAL FIX: Hanya gunakan -shortest jika TIDAK looping.
      // Jika looping (playlist panjang), kita biarkan stream mati sendiri kalau habis (setelah ribuan jam).
      if (!shouldLoop) {
        outputOpts.push('-shortest');
      }

      command.outputOptions(outputOpts);

    } else {
      // --- MODE VIDEO (Direct Stream Copy) ---
      // Sama, kita gunakan playlist panjang untuk loop video
      const videoInputOpts = ['-f', 'concat', '-safe', '0', '-re'];
      
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
        if (global.io) global.io.emit('log', { type: 'start', message: `Playlist Aktif: ${files.length} file. Mode Loop: ${shouldLoop ? 'Infinite (Polyfill)' : 'Single Run'}` });
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
