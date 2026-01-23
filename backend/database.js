
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

const initDB = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 1. Aktifkan Foreign Keys
      db.run("PRAGMA foreign_keys = ON");

      // 2. Buat Tabel Dasar jika belum ada
      db.run(`CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        name TEXT UNIQUE, 
        max_storage_mb INTEGER, 
        allowed_types TEXT, 
        max_active_streams INTEGER,
        price_text TEXT,
        features_text TEXT
      )`);

      // 3. MIGRASI: Tambahkan kolom baru jika belum ada (Menghindari SQLITE_ERROR)
      db.all("PRAGMA table_info(plans)", (err, columns) => {
        if (err || !columns) return;
        const hasPrice = columns.some(c => c.name === 'price_text');
        const hasFeatures = columns.some(c => c.name === 'features_text');
        
        if (!hasPrice) {
          db.run("ALTER TABLE plans ADD COLUMN price_text TEXT");
        }
        if (!hasFeatures) {
          db.run("ALTER TABLE plans ADD COLUMN features_text TEXT");
        }
      });

      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        username TEXT UNIQUE, 
        password_hash TEXT, 
        role TEXT DEFAULT 'user',
        plan_id INTEGER DEFAULT 1,
        storage_used INTEGER DEFAULT 0,
        FOREIGN KEY(plan_id) REFERENCES plans(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS videos (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, filename TEXT NOT NULL, path TEXT NOT NULL, size INTEGER, type TEXT DEFAULT 'video', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      db.run(`CREATE TABLE IF NOT EXISTS stream_settings (key TEXT PRIMARY KEY, value TEXT)`);
      
      db.run(`CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        user_id INTEGER,
        media_ids TEXT, 
        rtmp_url TEXT, 
        cover_image_id INTEGER, 
        loop_playlist INTEGER DEFAULT 1, 
        scheduled_at DATETIME, 
        status TEXT DEFAULT 'pending'
      )`);

      // 4. Seeding Master Data Plans
      const plans = [
        [1, 'Paket Basic (Pemula)', 2048, 'video,audio', 1, 'Rp 50.000', 'Max 720p, 12 Jam/hari, Auto Reconnect'],
        [2, 'Paket Pro (Creator)', 10240, 'video,audio', 2, 'Rp 100.000', 'Max 1080p, 24 Jam Non-stop, Multi-Target'],
        [3, 'Paket Radio 24/7', 5120, 'audio', 1, 'Rp 75.000', 'Khusus Radio MP3, Visualisasi Cover, Shuffle Playlist'],
        [4, 'Paket Sultan (Private)', 25600, 'video,audio', 5, 'Rp 250.000', 'Dedicated VPS, Unlimited Platform, Setup Dibantu Full']
      ];
      
      plans.forEach(p => {
        // Hanya insert jika belum ada id tersebut agar manual edit tidak hilang
        db.run(`INSERT OR IGNORE INTO plans (id, name, max_storage_mb, allowed_types, max_active_streams, price_text, features_text) 
                VALUES (?, ?, ?, ?, ?, ?, ?)`, p);
      });

      // 5. Seeding Default Settings (Landing Page Content)
      const defaultSettings = [
        ['landing_title', 'Broadcast Anywhere <br> from <span class="text-indigo-400">Any VPS.</span>'],
        ['landing_desc', 'Server streaming paling ringan di dunia. Dirancang khusus untuk VPS 1GB RAM.'],
        ['landing_btn_reg', 'Daftar Sekarang'],
        ['landing_btn_login', 'Login Member']
      ];

      defaultSettings.forEach(s => {
         db.run(`INSERT OR IGNORE INTO stream_settings (key, value) VALUES (?, ?)`, s);
      });

      // 6. Seeding Admin
      const adminUser = 'admin';
      const adminPass = 'admin123';
      const hash = bcrypt.hashSync(adminPass, 10);
      
      // Cek apakah admin sudah ada
      db.get("SELECT id FROM users WHERE username = ?", [adminUser], (err, row) => {
        if (!row) {
          db.run(`INSERT INTO users (username, password_hash, role, plan_id) VALUES (?, ?, 'admin', 4)`, [adminUser, hash], (err) => {
            if (!err) console.log("DB: Initial Admin Created (admin/admin123)");
          });
        }
        resolve();
      });
    });
  });
};

const getVideos = (userId) => new Promise((res, rej) => db.all("SELECT * FROM videos WHERE user_id = ? ORDER BY created_at DESC", [userId], (err, rows) => err ? rej(err) : res(rows)));
const saveVideo = (data) => new Promise((res, rej) => db.run("INSERT INTO videos (user_id, filename, path, size, type) VALUES (?, ?, ?, ?, ?)", [data.user_id, data.filename, data.path, data.size, data.type || 'video'], function(err) { err ? rej(err) : res(this.lastID); }));
const deleteVideo = (id) => new Promise((res, rej) => db.run("DELETE FROM videos WHERE id = ?", [id], (err) => err ? rej(err) : res()));

module.exports = { initDB, getVideos, saveVideo, deleteVideo, db, dbPath };
