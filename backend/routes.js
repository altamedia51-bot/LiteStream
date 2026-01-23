
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getVideos, saveVideo, deleteVideo, db } = require('./database');
const { startStream, stopStream, isStreaming } = require('./streamEngine');

let playlistQueue = [];
let currentPlaylistIndex = 0;
let playlistOptions = {};
let isPlaylistRunning = false;
let nowPlayingFilename = "";

// Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, path.join(__dirname, 'uploads')); },
  filename: (req, file, cb) => { cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_')); }
});
const upload = multer({ storage });

// Helper: Start Next in Queue
const playNext = async () => {
  if (!isPlaylistRunning || playlistQueue.length === 0) return;

  if (currentPlaylistIndex >= playlistQueue.length) {
    if (playlistOptions.loop) {
      currentPlaylistIndex = 0; // Reset ke awal jika loop aktif
    } else {
      isPlaylistRunning = false;
      return;
    }
  }

  const mediaId = playlistQueue[currentPlaylistIndex];
  db.get("SELECT * FROM videos WHERE id = ?", [mediaId], async (err, video) => {
    if (!video) {
        currentPlaylistIndex++;
        playNext();
        return;
    }

    nowPlayingFilename = video.filename;
    if (global.io) {
        global.io.emit('log', { type: 'start', filename: video.filename, message: `Memutar playlist [${currentPlaylistIndex + 1}/${playlistQueue.length}]: ${video.filename}` });
        global.io.emit('queue-update', { count: playlistQueue.length - currentPlaylistIndex });
    }

    try {
      await startStream(video.path, playlistOptions.rtmpUrl, {
        coverImagePath: playlistOptions.coverPath,
        loop: false // FFmpeg jangan loop internal agar kita bisa pindah ke file berikutnya di Node.js
      });
      
      // Jika FFmpeg selesai normal (on 'end'), lanjut ke berikutnya
      currentPlaylistIndex++;
      playNext();
    } catch (e) {
      console.error("Stream Error, skipping...", e);
      currentPlaylistIndex++;
      playNext();
    }
  });
};

router.get('/videos', async (req, res) => {
  res.json(await getVideos());
});

router.post('/videos/upload', upload.single('video'), async (req, res) => {
  const ext = path.extname(req.file.filename).toLowerCase();
  let type = (ext === '.mp3') ? 'audio' : (['.jpg','.png','.jpeg'].includes(ext) ? 'image' : 'video');
  const id = await saveVideo({ filename: req.file.filename, path: req.file.path, size: req.file.size, type });
  res.json({ success: true, id });
});

router.delete('/videos/:id', async (req, res) => {
  db.get("SELECT path FROM videos WHERE id = ?", [req.params.id], (err, row) => {
    if (row && fs.existsSync(row.path)) fs.unlinkSync(row.path);
    deleteVideo(req.params.id).then(() => res.json({ success: true }));
  });
});

// NEW: Start Playlist
router.post('/playlist/start', async (req, res) => {
  const { ids, rtmpUrl, coverImageId, loop } = req.body;
  
  if (!ids || ids.length === 0) return res.status(400).json({ error: "No media selected" });

  stopStream(); // Hentikan yang sedang jalan
  
  playlistQueue = ids;
  currentPlaylistIndex = 0;
  isPlaylistRunning = true;
  
  // Ambil cover path jika ada
  let coverPath = null;
  if (coverImageId) {
    const cover = await new Promise(r => db.get("SELECT path FROM videos WHERE id = ?", [coverImageId], (e, row) => r(row)));
    if (cover) coverPath = cover.path;
  }

  playlistOptions = { rtmpUrl, coverPath, loop };

  // Mulai proses background
  playNext();
  res.json({ success: true });
});

router.post('/stream/stop', (req, res) => {
  isPlaylistRunning = false;
  playlistQueue = [];
  const stopped = stopStream();
  res.json({ success: stopped });
});

router.get('/stream/status', (req, res) => {
  res.json({ active: isStreaming(), nowPlaying: nowPlayingFilename });
});

router.get('/settings', (req, res) => {
  db.get("SELECT value FROM stream_settings WHERE key = 'rtmp_url'", (err, row) => res.json({ rtmp_url: row ? row.value : '' }));
});

router.post('/settings', (req, res) => {
  db.run("INSERT OR REPLACE INTO stream_settings (key, value) VALUES ('rtmp_url', ?)", [req.body.rtmp_url], () => res.json({ success: true }));
});

module.exports = router;
