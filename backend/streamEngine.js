
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { PassThrough } = require('stream');
const { db } = require('./database');

// STORE MULTIPLE STREAMS
const activeStreams = new Map();

const startStream = (inputPaths, destinations, options = {}) => {
  if (!destinations || destinations.length === 0) throw new Error("Pilih minimal satu tujuan streaming.");

  const streamId = 'stream_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  const files = Array.isArray(inputPaths) ? inputPaths : [inputPaths];
  const isAllAudio = files.every(f => f.toLowerCase().endsWith('.mp3'));
  const shouldLoop = !!options.loop;
  const currentUserId = options.userId;
  const runningText = options.runningText || '';
  
  const streamState = {
      id: streamId, userId: currentUserId, loopActive: true, 
      activeInputStream: null, command: null, destinations: destinations
  };

  return new Promise((resolve, reject) => {
    let command = ffmpeg();
    let lastProcessedSecond = 0;

    if (isAllAudio) {
      const mixedStream = new PassThrough();
      streamState.activeInputStream = mixedStream;
      let fileIndex = 0;

      const playNextSong = () => {
        if (!streamState.loopActive) return;
        const currentFile = files[fileIndex];
        
        if (!fs.existsSync(currentFile)) {
             // Notify frontend about missing file
             if (global.io) global.io.emit('log', { type: 'error', message: `File hilang, melewati: ${path.basename(currentFile)}` });
             fileIndex++;
             if (fileIndex < files.length) playNextSong();
             return;
        }

        const songStream = fs.createReadStream(currentFile);
        songStream.pipe(mixedStream, { end: false });
        songStream.on('end', () => {
           fileIndex++;
           if (fileIndex >= files.length) {
             if (shouldLoop) { fileIndex = 0; playNextSong(); } 
             else { mixedStream.end(); }
           } else { playNextSong(); }
        });
        songStream.on('error', (err) => { 
            console.error("Read Stream Error:", err);
            fileIndex++; if(fileIndex < files.length) playNextSong(); 
        });
      };

      playNextSong();

      // BASE FILTERS
      const videoFilters = [
        'scale=1280:720:force_original_aspect_ratio=decrease',
        'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black',
        'format=yuv420p'
      ];

      // RUNNING TEXT LOGIC
      if (runningText && runningText.trim().length > 0) {
          const safeText = runningText.replace(/'/g, '').replace(/:/g, '\\:').replace(/,/g, '\\,');
          let fontOption = '';
          const possibleFonts = [
              '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
              '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
              '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf'
          ];
          for (const f of possibleFonts) {
              if (fs.existsSync(f)) { fontOption = `:fontfile=${f}`; break; }
          }
          videoFilters.push(`drawtext=text='${safeText}'${fontOption}:fontcolor=white:fontsize=40:box=1:boxcolor=black@0.6:boxborderw=10:x=w-mod(t*100\\,w+text_w):y=h-th-20`);
      }

      const filterString = videoFilters.join(',');

      let imageInput = options.coverImagePath;
      if (!imageInput || !fs.existsSync(imageInput)) {
        command.input('color=c=black:s=1280x720:r=24').inputOptions(['-f lavfi', '-re']);
      } else {
        command.input(imageInput).inputOptions(['-loop 1', '-framerate 2', '-re']); 
      }

      command.input(mixedStream).inputFormat('mp3').inputOptions(['-re']); 
      
      const encodingFlags = [
        '-map', '0:v', '-map', '1:a', 
        '-vf', filterString,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', 
        '-r', '24', '-g', '48', '-keyint_min', '48', '-sc_threshold', '0',
        '-b:v', '2500k', '-maxrate', '2500k', '-bufsize', '4000k', 
        '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-af', 'aresample=async=1',
        '-f', 'flv', '-flvflags', 'no_duration_filesize'
      ];

      destinations.forEach(dest => {
          let rtmp = dest.rtmp_url;
          if (rtmp && !rtmp.endsWith('/')) rtmp += '/';
          command.output(rtmp + dest.stream_key).outputOptions(encodingFlags);
      });

    } else {
      // PLAYLIST MODE
      const playlistPath = path.join(__dirname, 'uploads', `playlist_${streamId}.txt`);
      const playlistContent = files.map(f => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`).join('\n');
      fs.writeFileSync(playlistPath, playlistContent);
      streamState.cleanupFile = playlistPath;

      const videoInputOpts = ['-f', 'concat', '-safe', '0', '-re'];
      if (shouldLoop) videoInputOpts.unshift('-stream_loop', '-1');

      command.input(playlistPath).inputOptions(videoInputOpts);
      const copyFlags = ['-c', 'copy', '-f', 'flv', '-flvflags', 'no_duration_filesize'];
      
      destinations.forEach(dest => {
          let rtmp = dest.rtmp_url;
          if (rtmp && !rtmp.endsWith('/')) rtmp += '/';
          command.output(rtmp + dest.stream_key).outputOptions(copyFlags);
      });
    }

    streamState.command = command
      .on('start', () => {
        const destNames = destinations.map(d => d.name).join(', ');
        if (global.io) global.io.emit('log', { type: 'start', message: `Broadcast dimulai ke: ${destNames}` });
        activeStreams.set(streamId, streamState);
        resolve(streamId);
      })
      .on('progress', (progress) => {
        const parts = progress.timemark.split(':');
        const totalSeconds = (+parts[0]) * 3600 + (+parts[1]) * 60 + (+parseFloat(parts[2]));
        const diff = Math.floor(totalSeconds - lastProcessedSecond);
        if (diff >= 5) { 
            lastProcessedSecond = totalSeconds;
            if (global.io) global.io.emit('stats', { streamId: streamId, duration: progress.timemark, bitrate: progress.currentKbps ? Math.round(progress.currentKbps) + ' kbps' : 'N/A' });
            db.run("UPDATE users SET usage_seconds = usage_seconds + ? WHERE id = ?", [diff, currentUserId]);
        }
      })
      .on('error', (err) => {
        const errMsg = err.message;
        
        // --- TRANSLATE ERROR MESSAGES TO HUMAN READABLE ---
        if (errMsg.includes('SIGKILL')) {
            // Ini normal, user menekan tombol stop. Jangan kirim error.
            return;
        }

        let humanError = `Engine Error: ${errMsg.substring(0, 50)}...`; // Default fallback

        if (errMsg.includes('Connection refused') || errMsg.includes('I/O error') || errMsg.includes('EPIPE')) {
            humanError = "Koneksi ke YouTube/Facebook GAGAL. Cek Stream Key & Internet VPS.";
        } else if (errMsg.includes('No such file')) {
            humanError = "File hilang atau path salah.";
        } else if (errMsg.includes('Invalid argument') || errMsg.includes('Option not found')) {
            humanError = "Settingan Stream salah (Code Error).";
        } else if (errMsg.includes('Conversion failed')) {
            humanError = "Format File tidak didukung.";
        }

        console.error(`[STREAM ERROR ${streamId}]`, errMsg);
        if (global.io) global.io.emit('log', { type: 'error', message: `STOP: ${humanError}` });
        
        stopStream(streamId);
      })
      .on('end', () => {
         if (global.io) global.io.emit('log', { type: 'end', message: `Stream Selesai (Playlist habis).` });
         stopStream(streamId);
      });

    streamState.command.run();
  });
};

const stopStream = (streamId = null, userId = null) => {
  let count = 0;
  activeStreams.forEach((state, key) => {
      let stop = false;
      if (streamId && key === streamId) stop = true;
      if (userId && state.userId === userId) stop = true;
      if (!streamId && !userId) stop = true; 

      if (stop) {
          state.loopActive = false;
          if (state.activeInputStream) try { state.activeInputStream.end(); } catch(e){}
          if (state.command) try { state.command.kill('SIGKILL'); } catch(e){}
          if (state.cleanupFile && fs.existsSync(state.cleanupFile)) try { fs.unlinkSync(state.cleanupFile); } catch(e){}
          activeStreams.delete(key);
          count++;
      }
  });
  return count > 0;
};

const getActiveStreams = (userId) => {
    const list = [];
    activeStreams.forEach((v, k) => { if(v.userId === userId) list.push({ id: k, destinations: v.destinations }); });
    return list;
};

module.exports = { startStream, stopStream, getActiveStreams };
