
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
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
      currentPlaylistIndex = 0;
    } else {
      isPlaylistRunning = false;
      nowPlayingFilename = "";
      if (global.io) global.io.emit('log', { type: 'end', message: 'Playlist selesai.' });
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
        loop: false
      });
      currentPlaylistIndex++;
      playNext();
    } catch (e) {
      currentPlaylistIndex++;
      playNext();
    }
  });
};

// Scheduler Worker
cron.schedule('* * * * *', () => {
  const now = new Date().toISOString();
  db.all("SELECT * FROM schedules WHERE scheduled_at <= ? AND status = 'pending'", [now], async (err, rows) => {
    if (err || !rows) return;
    
    for (const schedule of rows) {
      db.run("UPDATE schedules SET status = 'completed' WHERE id = ?", [schedule.id]);
      let coverPath = null;
      if (schedule.cover_image_id) {
        const cover = await new Promise(r => db.get("SELECT path FROM videos WHERE id = ?", [schedule.cover_image_id], (e, row) => r(row)));
        if (cover) coverPath = cover.path;
      }
      stopStream();
      playlistQueue = JSON.parse(schedule.media_ids);
      currentPlaylistIndex = 0;
      isPlaylistRunning = true;
      playlistOptions = { rtmpUrl: schedule.rtmp_url, coverPath: coverPath, loop: !!schedule.loop_playlist };
      playNext();
      if (global.io) global.io.emit('log', { type: 'info', message: `JADWAL OTOMATIS DIMULAI (ID: ${schedule.id})` });
    }
  });
});

// --- USER MANAGEMENT ROUTES ---
router.get('/users', (req, res) => {
  db.all("SELECT id, username, role FROM users", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

router.delete('/users/:id', (req, res) => {
  const targetId = req.params.id;
  const currentUserId = req.session.user.id;

  if (parseInt(targetId) === parseInt(currentUserId)) {
    return res.status(400).json({ success: false, error: "Anda tidak bisa menghapus akun Anda sendiri." });
  }

  db.run("DELETE FROM users WHERE id = ?", [targetId], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true });
  });
});

// --- VIDEO ROUTES ---
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

router.post('/playlist/start', async (req, res) => {
  const { ids, rtmpUrl, coverImageId, loop } = req.body;
  if (!ids || ids.length === 0) return res.status(400).json({ error: "No media selected" });
  stopStream();
  playlistQueue = ids;
  currentPlaylistIndex = 0;
  isPlaylistRunning = true;
  let coverPath = null;
  if (coverImageId) {
    const cover = await new Promise(r => db.get("SELECT path FROM videos WHERE id = ?", [coverImageId], (e, row) => r(row)));
    if (cover) coverPath = cover.path;
  }
  playlistOptions = { rtmpUrl, coverPath, loop };
  playNext();
  res.json({ success: true });
});

router.post('/stream/stop', (req, res) => {
  isPlaylistRunning = false;
  playlistQueue = [];
  nowPlayingFilename = "";
  const stopped = stopStream();
  res.json({ success: stopped });
});

router.get('/stream/status', (req, res) => {
  res.json({ active: isStreaming(), nowPlaying: nowPlayingFilename });
});

// --- SCHEDULE ROUTES ---
router.get('/schedules', (req, res) => {
  db.all("SELECT * FROM schedules WHERE status = 'pending' ORDER BY scheduled_at ASC", (err, rows) => {
    res.json(rows || []);
  });
});

router.post('/schedules', (req, res) => {
  const { media_ids, rtmp_url, cover_image_id, loop_playlist, scheduled_at } = req.body;
  db.run(
    "INSERT INTO schedules (media_ids, rtmp_url, cover_image_id, loop_playlist, scheduled_at) VALUES (?, ?, ?, ?, ?)",
    [JSON.stringify(media_ids), rtmp_url, cover_image_id, loop_playlist ? 1 : 0, scheduled_at],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    }
  );
});

router.delete('/schedules/:id', (req, res) => {
  db.run("DELETE FROM schedules WHERE id = ?", [req.params.id], () => res.json({ success: true }));
});

// --- SETTINGS ROUTES ---
router.get('/settings', (req, res) => {
  db.get("SELECT value FROM stream_settings WHERE key = 'rtmp_url'", (err, row) => res.json({ rtmp_url: row ? row.value : '' }));
});

router.post('/settings', (req, res) => {
  db.run("INSERT OR REPLACE INTO stream_settings (key, value) VALUES ('rtmp_url', ?)", [req.body.rtmp_url], () => res.json({ success: true }));
});

module.exports = router;
