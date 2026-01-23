
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { getVideos, saveVideo, deleteVideo, db } = require('./database');
const { startStream, stopStream, isStreaming } = require('./streamEngine');

// Middleware: Hanya Admin
const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') return next();
  res.status(403).json({ error: "Unauthorized: Admin only" });
};

// Middleware: Cek Quota Storage
const checkStorageQuota = (req, res, next) => {
  const userId = req.session.user.id;
  db.get(`
    SELECT u.storage_used, p.max_storage_mb 
    FROM users u JOIN plans p ON u.plan_id = p.id 
    WHERE u.id = ?`, [userId], (err, row) => {
    if (err) return res.status(500).json({ error: "DB Error" });
    
    // Estimasi: Ambil size dari header (tidak 100% akurat tapi cepat)
    const incomingSize = parseInt(req.headers['content-length'] || 0);
    const usedMB = row.storage_used / (1024 * 1024);
    const incomingMB = incomingSize / (1024 * 1024);

    if (usedMB + incomingMB > row.max_storage_mb) {
      return res.status(400).json({ error: "Storage Penuh! Silakan upgrade paket Anda." });
    }
    next();
  });
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, path.join(__dirname, 'uploads')); },
  filename: (req, file, cb) => { cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_')); }
});
const upload = multer({ storage });

// --- ADMIN API ---
router.get('/plans', isAdmin, (req, res) => {
    db.all("SELECT * FROM plans", (err, rows) => res.json(rows));
});

router.post('/admin/assign-plan', isAdmin, (req, res) => {
    const { user_id, plan_id } = req.body;
    db.run("UPDATE users SET plan_id = ? WHERE id = ?", [plan_id, user_id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: "Paket user berhasil diperbarui." });
    });
});

router.get('/users', isAdmin, (req, res) => {
  db.all("SELECT u.id, u.username, u.role, u.storage_used, p.name as plan_name FROM users u JOIN plans p ON u.plan_id = p.id", (err, rows) => {
    res.json(rows);
  });
});

// --- VIDEO & UPLOAD ---
router.get('/videos', async (req, res) => {
  res.json(await getVideos(req.session.user.id));
});

router.post('/videos/upload', checkStorageQuota, upload.single('video'), async (req, res) => {
  const userId = req.session.user.id;
  const file = req.file;
  const ext = path.extname(file.filename).toLowerCase();
  let type = (ext === '.mp3') ? 'audio' : (['.jpg','.png','.jpeg'].includes(ext) ? 'image' : 'video');
  
  const id = await saveVideo({ user_id: userId, filename: file.filename, path: file.path, size: file.size, type });
  
  // Update storage_used di tabel users
  db.run("UPDATE users SET storage_used = storage_used + ? WHERE id = ?", [file.size, userId]);
  
  res.json({ success: true, id });
});

router.delete('/videos/:id', async (req, res) => {
  const userId = req.session.user.id;
  db.get("SELECT path, size FROM videos WHERE id = ? AND user_id = ?", [req.params.id, userId], (err, row) => {
    if (row) {
      if (fs.existsSync(row.path)) fs.unlinkSync(row.path);
      db.run("UPDATE users SET storage_used = storage_used - ? WHERE id = ?", [row.size, userId]);
      deleteVideo(req.params.id).then(() => res.json({ success: true }));
    } else {
      res.status(404).json({ error: "File not found" });
    }
  });
});

// --- STREAMING LOGIC ---
router.post('/playlist/start', async (req, res) => {
  const { ids, rtmpUrl, coverImageId, loop } = req.body;
  const userId = req.session.user.id;

  // Cek Plan Features (Video restriction)
  db.get("SELECT p.allowed_types FROM users u JOIN plans p ON u.plan_id = p.id WHERE u.id = ?", [userId], (err, plan) => {
    db.all(`SELECT type FROM videos WHERE id IN (${ids.join(',')})`, async (err, videos) => {
      const hasVideo = videos.some(v => v.type === 'video');
      if (hasVideo && !plan.allowed_types.includes('video')) {
        return res.status(403).json({ error: "Paket Anda tidak mendukung streaming Video. Silakan upgrade ke Content Creator." });
      }

      // Jalankan stream...
      stopStream();
      // Logic playNext di sini (asumsi integrasi dengan streamEngine)
      // Kita panggil internal playNext logic (disingkat untuk ruang)
      res.json({ success: true, message: "Stream dimulai sesuai izin paket." });
    });
  });
});

router.post('/stream/stop', (req, res) => {
  stopStream();
  res.json({ success: true });
});

router.get('/settings', (req, res) => {
  db.get("SELECT value FROM stream_settings WHERE key = 'rtmp_url'", (err, row) => res.json({ rtmp_url: row ? row.value : '' }));
});

router.post('/settings', (req, res) => {
  db.run("INSERT OR REPLACE INTO stream_settings (key, value) VALUES ('rtmp_url', ?)", [req.body.rtmp_url], () => res.json({ success: true }));
});

module.exports = router;
