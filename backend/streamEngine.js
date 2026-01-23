
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
  const shouldLoop = !!options.loop;
  
  // 1. Buat Playlist File (Standard, 1x list saja)
  const playlistPath = path.join(__dirname, 'uploads', 'playlist.txt');
  const playlistContent = files.map(f => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(playlistPath, playlistContent);

  return new Promise((resolve, reject) => {
    let command = ffmpeg();

    if (isAllAudio) {
      // --- MODE AUDIO (RADIO/PODCAST - TRUE INFINITE) ---
      
      const videoFilter = [
        'scale=1280:720:force_original_aspect_ratio=decrease',
        'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black',
        'format=yuv420p'
      ].join(',');

      // INPUT 0: IMAGE BACKGROUND
      // -loop 1: Gambar diulang terus menerus (infinite image stream)
      // -re: Membaca input secara realtime (penting agar tidak terlalu cepat)
      let imageInput = options.coverImagePath;
      if (!imageInput || !fs.existsSync(imageInput)) {
        command.input('color=c=black:s=1280x720:r=24')
               .inputOptions(['-f lavfi', '-re']);
      } else {
        command.input(imageInput)
               .inputOptions(['-loop 1', '-framerate 2', '-re']); 
      }

      // INPUT 1: AUDIO PLAYLIST
      const audioInputOptions = [];
      
      // TRUE INFINITE LOOP LOGIC:
      // -stream_loop -1: Memerintahkan FFmpeg mengulang input ini selamanya.
      // Diletakkan SEBELUM input file (-i).
      if (shouldLoop) {
          audioInputOptions.push('-stream_loop', '-1');
      }
      
      // -re : Read at native frame rate. Mencegah FFmpeg membaca file secepat kilat.
      audioInputOptions.push('-re'); 
      audioInputOptions.push('-f', 'concat', '-safe', '0');
      
      command.input(playlistPath).inputOptions(audioInputOptions);

      // OUTPUT OPTIONS
      const outputOpts = [
        '-map 0:v', 
        '-map 1:a',
        `-vf ${videoFilter}`,
        '-c:v libx264',
        '-preset ultrafast', // Hemat CPU VPS
        
        '-r 24',
        '-g 48',
        '-keyint_min 48',
        '-sc_threshold 0',
        
        // Bitrate Stabil untuk YouTube
        '-b:v 3000k',
        '-minrate 3000k', 
        '-maxrate 3000k',
        '-bufsize 6000k',
        '-nal-hrd cbr',
        
        '-c:a aac',
        '-b:a 128k',
        '-ar 44100',
        
        // --- RAHASIA TRUE INFINITE ---
        // asetpts=N/SR/TB : 
        // Ini memaksa FFmpeg membuat timestamp BARU berdasarkan jumlah sample yang lewat,
        // BUKAN berdasarkan timestamp dari file asli.
        // Saat file mp3 mengulang (loop), timestamp asli jadi 0, tapi filter ini akan
        // membuatnya terus naik (misal: jam ke-100 tetap lanjut).
        '-af aresample=async=1,asetpts=N/SR/TB',
        
        '-fflags +genpts+igndts', 
        '-ignore_unknown',
        
        '-f flv',
        '-flvflags no_duration_filesize'
      ];

      // HAPUS -shortest.
      // Kita ingin stream jalan selamanya mengikuti audio yang diloop, atau gambar yang diloop.
      // Jika salah satu mati, stream mati. Karena dua-duanya infinite, stream infinite.

      command.outputOptions(outputOpts);

    } else {
      // --- MODE VIDEO (Direct Stream Copy) ---
      const videoInputOpts = ['-f', 'concat', '-safe', '0', '-re'];
      // Loop untuk video juga menggunakan native stream loop
      if (shouldLoop) videoInputOpts.unshift('-stream_loop', '-1');

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
        console.log('FFmpeg Engine Started');
        if (global.io) global.io.emit('log', { type: 'start', message: `Stream Started. Mode: ${shouldLoop ? 'True Infinite Loop' : 'Single Play'}` });
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
        // Filter log spam
        if (stderrLine.includes('frame=') || stderrLine.includes('fps=')) return;
        if (stderrLine.includes('Error') || stderrLine.includes('fail')) {
            if (global.io) global.io.emit('log', { type: 'debug', message: stderrLine });
        }
      })
      .on('error', (err) => {
        // Abaikan error SIGKILL (saat user stop manual)
        if (err.message.includes('SIGKILL')) return;
        
        console.error("FFmpeg Error:", err.message);
        if (global.io) global.io.emit('log', { type: 'error', message: `Engine Failure: ${err.message}` });
        currentCommand = null;
        reject(err);
      })
      .on('end', () => {
        if (global.io) global.io.emit('log', { type: 'end', message: 'Stream Selesai.' });
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
