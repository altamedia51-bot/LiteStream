
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getVideos, saveVideo, deleteVideo, db } = require('./database');
const { startStream, stopStream, isStreaming } = require('./streamEngine');

// Setup Multer for Media Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 1024 * 1024 * 1000 }, // 1GB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.mp4', '.mkv', '.mp3', '.jpg', '.png', '.jpeg'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only videos (mp4/mkv), audio (mp3), and images (jpg/png) are allowed'));
    }
  }
});

// Media Management
router.get('/videos', async (req, res) => {
  try {
    const videos = await getVideos();
    res.json(videos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/videos/upload', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  
  const ext = path.extname(req.file.filename).toLowerCase();
  let type = 'video';
  if (ext === '.mp3') type = 'audio';
  if (['.jpg', '.jpeg', '.png'].includes(ext)) type = 'image';

  try {
    const videoId = await saveVideo({
      filename: req.file.filename,
      path: req.file.path,
      size: req.file.size,
      type: type
    });
    res.json({ success: true, id: videoId, type: type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/videos/:id', async (req, res) => {
  try {
    db.get("SELECT path FROM videos WHERE id = ?", [req.params.id], (err, row) => {
        if (row && fs.existsSync(row.path)) fs.unlinkSync(row.path);
        deleteVideo(req.params.id).then(() => res.json({ success: true }));
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stream Controls
router.post('/stream/start', async (req, res) => {
  const { videoId, rtmpUrl, coverImageId } = req.body;
  
  db.get("SELECT path, type FROM videos WHERE id = ?", [videoId], (err, video) => {
    if (err || !video) return res.status(404).json({ error: "Media not found" });
    
    const getTargetAndStart = (coverPath = null) => {
      db.get("SELECT value FROM stream_settings WHERE key = 'rtmp_url'", async (err, setting) => {
        const target = rtmpUrl || (setting ? setting.value : process.env.DEFAULT_RTMP);
        try {
          startStream(video.path, target, { coverImagePath: coverPath }).catch(e => console.error(e));
          res.json({ success: true, message: "Stream initiated" });
        } catch (e) {
          res.status(500).json({ error: e.message });
        }
      });
    };

    if (video.type === 'audio' && coverImageId) {
      db.get("SELECT path FROM videos WHERE id = ?", [coverImageId], (err, cover) => {
        getTargetAndStart(cover ? cover.path : null);
      });
    } else {
      getTargetAndStart();
    }
  });
});

router.post('/stream/stop', (req, res) => {
  const stopped = stopStream();
  res.json({ success: stopped });
});

router.get('/stream/status', (req, res) => {
  res.json({ active: isStreaming() });
});

// Settings Management
router.get('/settings', (req, res) => {
    db.get("SELECT value FROM stream_settings WHERE key = 'rtmp_url'", (err, row) => {
        res.json({ rtmp_url: row ? row.value : '' });
    });
});

router.post('/settings', (req, res) => {
    const { rtmp_url } = req.body;
    db.run("INSERT OR REPLACE INTO stream_settings (key, value) VALUES ('rtmp_url', ?)", [rtmp_url], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

module.exports = router;
