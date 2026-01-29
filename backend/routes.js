
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs'); 
const { getVideos, saveVideo, deleteVideo, db } = require('./database');
const { startStream, stopStream, getActiveStreams } = require('./streamEngine');

// Helper: Reset harian jika tanggal berubah
const syncUserUsage = (userId) => {
    return new Promise((resolve) => {
        const today = new Date().toISOString().split('T')[0];
        db.get("SELECT last_usage_reset, usage_seconds FROM users WHERE id = ?", [userId], (err, row) => {
            if (row && row.last_usage_reset !== today) {
                db.run("UPDATE users SET usage_seconds = 0, last_usage_reset = ? WHERE id = ?", [today, userId], () => {
                    resolve(0);
                });
            } else {
                resolve(row ? row.usage_seconds : 0);
            }
        });
    });
};

const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') return next();
  res.status(403).json({ error: "Unauthorized: Admin only" });
};

const checkStorageQuota = (req, res, next) => {
  const userId = req.session.user.id;
  // Jika Admin, bypass quota check
  if (req.session.user.role === 'admin') return next();

  db.get(`
    SELECT u.storage_used, p.max_storage_mb 
    FROM users u JOIN plans p ON u.plan_id = p.id 
    WHERE u.id = ?`, [userId], (err, row) => {
    if (err) return res.status(500).json({ error: "DB Error" });
    const incomingSize = parseInt(req.headers['content-length'] || 0);
    const usedMB = row.storage_used / (1024 * 1024);
    const incomingMB = incomingSize / (1024 * 1024);
    if (usedMB + incomingMB > row.max_storage_mb) {
      return res.status(400).json({ error: "Storage Penuh!" });
    }
    next();
  });
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, path.join(__dirname, 'uploads')); },
  filename: (req, file, cb) => { cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_')); }
});
const upload = multer({ storage });

// --- FOLDER ROUTES ---

router.get('/folders', (req, res) => {
    const userId = req.session.user.id;
    db.all("SELECT * FROM folders WHERE user_id = ? ORDER BY name ASC", [userId], (err, rows) => {
        if(err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

router.post('/folders', (req, res) => {
    const userId = req.session.user.id;
    const { name, parent_id } = req.body;
    if(!name) return res.status(400).json({error: "Nama folder wajib"});
    
    db.run("INSERT INTO folders (user_id, name, parent_id) VALUES (?, ?, ?)", 
        [userId, name, parent_id || null], 
        function(err) {
            if(err) return res.status(500).json({error: err.message});
            res.json({success: true, id: this.lastID});
        }
    );
});

router.delete('/folders/:id', (req, res) => {
    const userId = req.session.user.id;
    const folderId = req.params.id;

    // Cek apakah folder kosong (file dan subfolder)
    db.get("SELECT COUNT(*) as count FROM videos WHERE folder_id = ?", [folderId], (err, row) => {
        if(row && row.count > 0) return res.status(400).json({error: "Folder tidak kosong (ada file)."});
        
        db.get("SELECT COUNT(*) as count FROM folders WHERE parent_id = ?", [folderId], (err2, row2) => {
             if(row2 && row2.count > 0) return res.status(400).json({error: "Folder tidak kosong (ada subfolder)."});
             
             db.run("DELETE FROM folders WHERE id = ? AND user_id = ?", [folderId, userId], (err3) => {
                 if(err3) return res.status(500).json({error: err3.message});
                 res.json({success: true});
             });
        });
    });
});

// --- DESTINATION ROUTES (MULTI-STREAM) ---

router.get('/destinations', (req, res) => {
    const userId = req.session.user.id;
    db.all("SELECT * FROM stream_destinations WHERE user_id = ? ORDER BY created_at DESC", [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

router.post('/destinations', (req, res) => {
    const userId = req.session.user.id;
    const { name, platform, rtmp_url, stream_key } = req.body;
    
    if(!platform || !stream_key) return res.status(400).json({ error: "Platform dan Stream Key wajib diisi" });

    // 1. Cek Limit Plan vs Existing Destinations
    db.get(`
        SELECT p.max_active_streams, p.name as plan_name
        FROM users u
        JOIN plans p ON u.plan_id = p.id
        WHERE u.id = ?`, [userId], (err, plan) => {
        
        if (err) return res.status(500).json({ error: "DB Error" });

        // Function untuk proses insert (dipanggil jika lolos cek)
        const processInsert = () => {
            db.run(
                "INSERT INTO stream_destinations (user_id, name, platform, rtmp_url, stream_key, is_active) VALUES (?, ?, ?, ?, ?, 1)", 
                [userId, name || platform, platform, rtmp_url, stream_key], 
                function(err) {
                    if(err) return res.status(500).json({ error: err.message });
                    res.json({ success: true, id: this.lastID });
                }
            );
        };

        // Bypass untuk Admin
        if (req.session.user.role === 'admin') {
            return processInsert();
        }

        // Cek jumlah destinasi yang sudah ada
        db.get("SELECT COUNT(*) as count FROM stream_destinations WHERE user_id = ?", [userId], (err, row) => {
            if (err) return res.status(500).json({ error: "DB Error" });

            // VALIDASI: Jika jumlah destinasi >= max_active_streams, tolak.
            // Stream Tester (Plan 1) max_active_streams = 1.
            if (row.count >= plan.max_active_streams) {
                return res.status(403).json({ 
                    error: `Limit Tercapai! Paket ${plan.plan_name} hanya mendukung ${plan.max_active_streams} tujuan stream.` 
                });
            }

            processInsert();
        });
    });
});

router.delete('/destinations/:id', (req, res) => {
    const userId = req.session.user.id;
    db.run("DELETE FROM stream_destinations WHERE id = ? AND user_id = ?", [req.params.id, userId], (err) => {
        if(err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

router.put('/destinations/:id/toggle', (req, res) => {
    const userId = req.session.user.id;
    db.get("SELECT is_active FROM stream_destinations WHERE id = ? AND user_id = ?", [req.params.id, userId], (err, row) => {
        if(!row) return res.status(404).json({ error: "Not found" });
        const newState = row.is_active ? 0 : 1;
        db.run("UPDATE stream_destinations SET is_active = ? WHERE id = ?", [newState, req.params.id], (err) => {
            if(err) return res.status(500).json({ error: err.message });
            res.json({ success: true, active: newState });
        });
    });
});

// --- EXISTING ROUTES ---

router.get('/plans-public', (req, res) => {
  db.all("SELECT * FROM plans", (err, rows) => res.json(rows));
});

router.get('/landing-content', (req, res) => {
    const keys = ['landing_title', 'landing_desc', 'landing_btn_reg', 'landing_btn_login'];
    const placeholders = keys.map(() => '?').join(',');
    db.all(`SELECT key, value FROM stream_settings WHERE key IN (${placeholders})`, keys, (err, rows) => {
        const settings = {};
        if(rows) rows.forEach(r => settings[r.key] = r.value);
        res.json(settings);
    });
});

router.get('/plans', isAdmin, (req, res) => db.all("SELECT * FROM plans", (err, rows) => res.json(rows)));

router.put('/plans/:id', isAdmin, (req, res) => {
  const { name, max_storage_mb, allowed_types, price_text, features_text, daily_limit_hours } = req.body;
  db.run(`UPDATE plans SET 
          name = ?, max_storage_mb = ?, allowed_types = ?, price_text = ?, features_text = ?, daily_limit_hours = ?
          WHERE id = ?`, 
    [name, max_storage_mb, allowed_types, price_text, features_text, daily_limit_hours, req.params.id], 
    function(err) {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true });
    }
  );
});

router.get('/users', isAdmin, (req, res) => {
    // FIX: Menggunakan SELECT u.* (wildcard) daripada memilih u.created_at secara eksplisit.
    // Jika kolom created_at belum ada di DB (karena migrasi gagal/belum restart), query ini TIDAK akan crash.
    // Frontend akan menerima undefined untuk created_at dan menggunakan fallback Date.now().
    db.all("SELECT u.*, p.name as plan_name FROM users u LEFT JOIN plans p ON u.plan_id = p.id", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

router.put('/users/:id', isAdmin, (req, res) => {
    const { plan_id } = req.body;
    db.run("UPDATE users SET plan_id = ? WHERE id = ?", [plan_id, req.params.id], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true });
    });
});

router.delete('/users/:id', isAdmin, (req, res) => {
    const userId = req.params.id;
    // Prevent deleting self (admin) if only 1 admin exists, or just logic check in frontend. 
    // Here we just prevent deleting user ID 1 (assumed Super Admin) or check current session.
    if(parseInt(userId) === req.session.user.id) return res.status(400).json({ error: "Cannot delete yourself." });

    // 1. Delete Videos
    // 2. Delete Folders
    // 3. Delete Destinations
    // 4. Delete User
    // For simplicity in SQLite, cascading delete is usually handled by DB, but we do manual cleanup if needed.
    // Assuming Foreign Keys ON.
    db.run("DELETE FROM users WHERE id = ?", [userId], function(err) {
        if(err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true });
    });
});

router.get('/videos', async (req, res) => res.json(await getVideos(req.session.user.id)));

router.post('/videos/upload', checkStorageQuota, upload.single('video'), async (req, res) => {
  const userId = req.session.user.id;
  if (!req.file) return res.status(400).json({ error: "Pilih file dulu" });
  
  // Get Folder ID from Query or Body
  const folderId = req.body.folderId || req.query.folderId || null;

  const file = req.file;
  const ext = path.extname(file.filename).toLowerCase();
  
  // RESTRICT: Only Audio and Images allowed
  if (!['.mp3', '.jpg', '.jpeg', '.png'].includes(ext)) {
      // Hapus file yang terlanjur terupload
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: "Hanya file MP3 dan Gambar (JPG/PNG) yang diperbolehkan." });
  }

  let type = (ext === '.mp3') ? 'audio' : 'image';
  
  const id = await saveVideo({ user_id: userId, filename: file.filename, path: file.path, size: file.size, type, folder_id: folderId });
  db.run("UPDATE users SET storage_used = storage_used + ? WHERE id = ?", [file.size, userId]);
  res.json({ success: true, id, type });
});

router.delete('/videos/:id', async (req, res) => {
  const userId = req.session.user.id;
  db.get("SELECT path, size FROM videos WHERE id = ? AND user_id = ?", [req.params.id, userId], (err, row) => {
    if (row) {
      if (fs.existsSync(row.path)) fs.unlinkSync(row.path);
      db.run("UPDATE users SET storage_used = storage_used - ? WHERE id = ?", [row.size, userId]);
      deleteVideo(req.params.id).then(() => res.json({ success: true }));
    } else res.status(404).json({ error: "File not found" });
  });
});

router.get('/stream/status', async (req, res) => {
    const usage = await syncUserUsage(req.session.user.id);
    const activeStreamsList = getActiveStreams(req.session.user.id);
    res.json({ 
        active_streams: activeStreamsList, // Return detailed list of all running streams
        usage_seconds: usage,
        total_active: activeStreamsList.length
    });
});

router.post('/playlist/start', async (req, res) => {
  const { ids, coverImageId, loop, destinationIds } = req.body;
  const userId = req.session.user.id;

  if (!ids || ids.length === 0) return res.status(400).json({ error: "Pilih minimal 1 file audio." });
  if (!destinationIds || destinationIds.length === 0) return res.status(400).json({ error: "Pilih minimal 1 tujuan streaming." });

  const currentUsage = await syncUserUsage(userId);
  
  // LOGIC ADMIN BYPASS
  if (req.session.user.role === 'admin') {
      // Admin Logic: Langsung gas tanpa cek kuota
      const placeholdersDest = destinationIds.map(() => '?').join(',');
      const destinations = await new Promise((resolve) => {
            db.all(`SELECT name, platform, rtmp_url, stream_key FROM stream_destinations WHERE id IN (${placeholdersDest}) AND user_id = ?`, [...destinationIds, userId], (err, rows) => resolve(rows));
      });
      
      if (!destinations || destinations.length === 0) return res.status(400).json({ error: "Tujuan streaming tidak valid." });

      const placeholders = ids.map(() => '?').join(',');
      db.all(`SELECT * FROM videos WHERE id IN (${placeholders}) AND user_id = ?`, [...ids, userId], async (err, items) => {
          if (!items || items.length === 0) return res.status(404).json({ error: "Media tidak ditemukan" });
          
          const audioFiles = items.filter(i => i.type === 'audio').map(a => a.path);
          const imageFiles = items.filter(i => i.type === 'image');
          let finalCoverPath = null;
          if (coverImageId) {
                const cov = await new Promise(r => db.get("SELECT path FROM videos WHERE id=?", [coverImageId], (e,row)=>r(row)));
                if(cov) finalCoverPath = cov.path;
          }
          if (!finalCoverPath && imageFiles.length > 0) finalCoverPath = imageFiles[0].path; 

          try {
              // FIX: variable playlistPaths undefined here, use audioFiles
              const streamId = await startStream(audioFiles, destinations, { userId, loop: !!loop, coverImagePath: finalCoverPath });
              res.json({ success: true, message: `Streaming Administrator Dimulai (ID: ${streamId})` });
          } catch (e) { res.status(500).json({ error: "Engine Error: " + e.message }); }
      });
      return;
  }

  // LOGIC USER BIASA (Pake Limit)
  db.get(`
    SELECT p.allowed_types, p.daily_limit_hours, p.max_active_streams
    FROM users u JOIN plans p ON u.plan_id = p.id 
    WHERE u.id = ?`, [userId], async (err, plan) => {
    
    // 1. Cek Limit Waktu
    if (currentUsage >= plan.daily_limit_hours * 3600) {
        return res.status(403).json({ error: `Batas waktu harian (${plan.daily_limit_hours} jam) sudah habis.` });
    }

    // 2. Cek Limit Jumlah Stream Bersamaan (Multi-Instance)
    const activeStreams = getActiveStreams(userId);
    if (activeStreams.length >= plan.max_active_streams) {
        return res.status(403).json({ error: `Anda mencapai batas ${plan.max_active_streams} stream aktif bersamaan.` });
    }

    // 3. Get Selected Destinations from DB
    const placeholdersDest = destinationIds.map(() => '?').join(',');
    // WARNING: Validate user_id to prevent using other people's destinations
    const destinations = await new Promise((resolve) => {
        db.all(`SELECT name, platform, rtmp_url, stream_key FROM stream_destinations WHERE id IN (${placeholdersDest}) AND user_id = ?`, [...destinationIds, userId], (err, rows) => resolve(rows));
    });

    if (!destinations || destinations.length === 0) return res.status(400).json({ error: "Tujuan streaming tidak valid." });

    const placeholders = ids.map(() => '?').join(',');
    db.all(`SELECT * FROM videos WHERE id IN (${placeholders}) AND user_id = ?`, [...ids, userId], async (err, items) => {
      if (!items || items.length === 0) return res.status(404).json({ error: "Media tidak ditemukan" });

      const audioFiles = items.filter(i => i.type === 'audio');
      const imageFiles = items.filter(i => i.type === 'image');

      if (audioFiles.length === 0) return res.status(400).json({ error: "Pilih setidaknya satu file Audio (MP3)." });

      let playlistPaths = audioFiles.map(a => a.path);
      let finalCoverPath = null;
      if (coverImageId) {
            const cov = await new Promise(r => db.get("SELECT path FROM videos WHERE id=?", [coverImageId], (e,row)=>r(row)));
            if(cov) finalCoverPath = cov.path;
      }
      if (!finalCoverPath && imageFiles.length > 0) finalCoverPath = imageFiles[0].path; 

      try {
          // PASS SELECTED DESTINATIONS TO ENGINE
          // Returns a unique stream ID for this session
          const streamId = await startStream(playlistPaths, destinations, { userId, loop: !!loop, coverImagePath: finalCoverPath });
          res.json({ success: true, message: `Streaming baru dimulai (ID: ${streamId})` });
      } catch (e) { res.status(500).json({ error: "Engine Error: " + e.message }); }
    });
  });
});

router.post('/stream/stop', (req, res) => {
  const { streamId } = req.body;
  const userId = req.session.user.id;
  // If streamId is provided, stops that specific stream. If not, stops all for user.
  const success = stopStream(streamId, userId);
  res.json({ success, message: streamId ? "Stream dihentikan" : "Semua stream dihentikan" });
});

router.get('/settings', (req, res) => {
    const keys = ['landing_title', 'landing_desc', 'landing_btn_reg', 'landing_btn_login'];
    const placeholders = keys.map(()=>'?').join(',');
    db.all(`SELECT key, value FROM stream_settings WHERE key IN (${placeholders})`, keys, (err, rows) => {
        const settings = {};
        if(rows) rows.forEach(r => settings[r.key] = r.value);
        res.json(settings);
    });
});

router.post('/settings', (req, res) => {
    const stmt = db.prepare("INSERT OR REPLACE INTO stream_settings (key, value) VALUES (?, ?)");
    Object.keys(req.body).forEach(key => stmt.run(key, String(req.body[key] || '')));
    stmt.finalize();
    res.json({ success: true });
});

router.put('/profile', async (req, res) => {
    const { username, currentPassword, newPassword } = req.body;
    const userId = req.session.user.id;
    db.get("SELECT * FROM users WHERE id = ?", [userId], async (err, user) => {
        if (err || !user) return res.status(404).json({ error: "User not found" });
        const match = await bcrypt.compare(currentPassword, user.password_hash);
        if (!match) return res.status(400).json({ error: "Password salah." });
        try {
            let query = "UPDATE users SET username = ?";
            let params = [username];
            if (newPassword && newPassword.length >= 6) {
                const newHash = await bcrypt.hash(newPassword, 10);
                query += ", password_hash = ?";
                params.push(newHash);
            }
            query += " WHERE id = ?";
            params.push(userId);
            db.run(query, params, () => {
                req.session.user.username = username;
                res.json({ success: true, message: "Profil diperbarui." });
            });
        } catch (e) { res.status(500).json({ error: "Server Error" }); }
    });
});

module.exports = router;
