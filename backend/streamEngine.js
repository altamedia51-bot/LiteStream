
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { PassThrough } = require('stream');

let currentCommand = null;
let activeInputStream = null; // Stream penghubung Node.js -> FFmpeg
let currentStreamLoopActive = false; // Flag untuk menghentikan loop manual

const startStream = (inputPaths, rtmpUrl, options = {}) => {
  if (currentCommand) {
    stopStream();
  }

  const files = Array.isArray(inputPaths) ? inputPaths : [inputPaths];
  const isAllAudio = files.every(f => f.toLowerCase().endsWith('.mp3'));
  const shouldLoop = !!options.loop;
  
  // Reset Loop Flag
  currentStreamLoopActive = true;

  return new Promise((resolve, reject) => {
    let command = ffmpeg();

    if (isAllAudio) {
      // ==========================================
      // SOLUSI DJ MANUAL (Node.js Pipe)
      // ==========================================
      // Kita tidak menggunakan playlist.txt atau -stream_loop.
      // Kita memberi makan FFmpeg secara manual lewat Pipe (Stdin).
      // Ini membuat FFmpeg mengira ini adalah 1 file MP3 yang sangat panjang.
      
      const mixedStream = new PassThrough();
      activeInputStream = mixedStream;

      let fileIndex = 0;

      // Fungsi "DJ" untuk memutar lagu antrian
      const playNextSong = () => {
        if (!currentStreamLoopActive) return;

        const currentFile = files[fileIndex];
        const songStream = fs.createReadStream(currentFile);

        // Pipe lagu ke stream utama
        // { end: false } penting agar Pipe utama tidak tutup saat lagu habis
        songStream.pipe(mixedStream, { end: false });

        songStream.on('end', () => {
           // Lagu habis, lanjut ke berikutnya
           fileIndex++;
           
           if (fileIndex >= files.length) {
             if (shouldLoop) {
               fileIndex = 0; // Ulang dari awal (Looping)
               // console.log("Playlist looping...");
               playNextSong(); 
             } else {
               mixedStream.end(); // Selesai (Stop)
             }
           } else {
             playNextSong(); // Lagu selanjutnya
           }
        });

        songStream.on('error', (err) => {
           console.error("Error reading file:", err);
           // Skip file rusak
           fileIndex++;
           playNextSong();
        });
      };

      // Mulai memutar lagu pertama
      playNextSong();

      // --- KONFIGURASI FFMPEG ---

      const videoFilter = [
        'scale=1280:720:force_original_aspect_ratio=decrease',
        'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black',
        'format=yuv420p'
      ].join(',');

      // INPUT 0: IMAGE BACKGROUND (Tetap Loop Native FFmpeg)
      let imageInput = options.coverImagePath;
      if (!imageInput || !fs.existsSync(imageInput)) {
        command.input('color=c=black:s=1280x720:r=24')
               .inputOptions(['-f lavfi', '-re']);
      } else {
        command.input(imageInput)
               .inputOptions(['-loop 1', '-framerate 2', '-re']); 
      }

      // INPUT 1: AUDIO DARI NODE.JS PIPE
      command.input(mixedStream)
             .inputFormat('mp3') // Penting: Memberitahu FFmpeg data yang masuk adalah MP3
             // buffering agar stream mulus saat ganti lagu
             .inputOptions(['-re']); 

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
        
        '-b:v 3000k',
        '-minrate 3000k', 
        '-maxrate 3000k',
        '-bufsize 6000k',
        '-nal-hrd cbr',
        
        '-c:a aac',
        '-b:a 128k',
        '-ar 44100',
        
        // Filter Audio: Pastikan timestamp smooth
        '-af aresample=async=1',
        
        '-f flv',
        '-flvflags no_duration_filesize'
      ];

      command.outputOptions(outputOpts);

    } else {
      // --- MODE VIDEO (Tetap menggunakan Playlist Native karena Copy Codec) ---
      // Video sulit di-pipe manual karena header container-nya kompleks.
      // Kita pakai metode playlist.txt + stream_loop untuk video.
      
      const playlistPath = path.join(__dirname, 'uploads', 'playlist.txt');
      const playlistContent = files.map(f => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`).join('\n');
      fs.writeFileSync(playlistPath, playlistContent);

      const videoInputOpts = ['-f', 'concat', '-safe', '0', '-re'];
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
        if (global.io) global.io.emit('log', { type: 'start', message: `Stream Started. Mode: ${isAllAudio ? 'Node.js DJ Mixer' : 'Native Playlist'}` });
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
        if (stderrLine.includes('frame=') || stderrLine.includes('fps=')) return;
        if (stderrLine.includes('Error') || stderrLine.includes('fail')) {
            if (global.io) global.io.emit('log', { type: 'debug', message: stderrLine });
        }
      })
      .on('error', (err) => {
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
  // Matikan flag loop manual
  currentStreamLoopActive = false;
  
  // Tutup stream pipe jika ada
  if (activeInputStream) {
      try { activeInputStream.end(); } catch(e) {}
      activeInputStream = null;
  }

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
