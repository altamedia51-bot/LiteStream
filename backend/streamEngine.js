
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
  
  // FIX: Gunakan path absolute agar FFmpeg tidak bingung mencari file
  const playlistPath = path.join(__dirname, 'uploads', 'playlist.txt');
  const playlistContent = files.map(f => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(playlistPath, playlistContent);

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
      // FIX: Flag '-re' dipindah ke sini (Visual Input). 
      // Ini memaksa gambar dibaca secara real-time sebagai "Clock Master".
      let imageInput = options.coverImagePath;
      if (!imageInput || !fs.existsSync(imageInput)) {
        command.input('color=c=black:s=1280x720:r=24')
               .inputOptions(['-f lavfi', '-re']);
      } else {
        command.input(imageInput)
               .inputOptions(['-loop 1', '-framerate 2', '-re']); 
      }

      // 2. INPUT 1: AUDIO (Playlist)
      // Note: '-re' DIHAPUS dari sini untuk mencegah buffer underrun saat ganti lagu
      command.input(playlistPath).inputOptions([
        '-f concat',
        '-safe 0',
        shouldLoop ? '-stream_loop -1' : ''
      ].filter(Boolean));

      // OUTPUT OPTIONS
      command.outputOptions([
        '-map 0:v', 
        '-map 1:a',
        `-vf ${videoFilter}`,
        '-c:v libx264',
        '-preset ultrafast',
        
        '-r 24',
        '-g 48',
        '-keyint_min 48',
        '-sc_threshold 0',
        
        // FIX BITRATE YOUTUBE: Force Constant Bitrate (CBR)
        // Kita paksa bitrate minimal 3000k agar YouTube tidak mendeteksi "Low Bitrate"
        // pada gambar statis.
        '-b:v 3000k',
        '-minrate 3000k', 
        '-maxrate 3000k',
        '-bufsize 6000k',
        '-nal-hrd cbr',
        
        '-c:a aac',
        '-b:a 128k',
        '-ar 44100',
        
        '-fflags +genpts', 
        '-shortest',
        '-max_muxing_queue_size 9999',
        
        '-f flv',
        '-flvflags no_duration_filesize'
      ]);

    } else {
      // --- MODE VIDEO (Direct Stream Copy) ---
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
