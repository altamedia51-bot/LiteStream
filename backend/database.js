
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

const initDB = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run("PRAGMA foreign_keys = ON");

      // 1. Buat Tabel Plans
      db.run(`CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        name TEXT UNIQUE, 
        max_storage_mb INTEGER, 
        allowed_types TEXT, 
        max_active_streams INTEGER,
        price_text TEXT,
        features_text TEXT,
        daily_limit_hours INTEGER DEFAULT 24
      )`);

      db.all("PRAGMA table_info(plans)", (err, columns) => {
        if (err || !columns) return;
        const hasPrice = columns.some(c => c.name === 'price_text');
        const hasFeatures = columns.some(c => c.name === 'features_text');
        const hasLimit = columns.some(c => c.name === 'daily_limit_hours');
        
        if (!hasPrice) db.run("ALTER TABLE plans ADD COLUMN price_text TEXT");
        if (!hasFeatures) db.run("ALTER TABLE plans ADD COLUMN features_text TEXT");
        if (!hasLimit) db.run("ALTER TABLE plans ADD COLUMN daily_limit_hours INTEGER DEFAULT 24");
      });

      // 2. Buat Tabel Users
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        username TEXT UNIQUE, 
        password_hash TEXT, 
        role TEXT DEFAULT 'user',
        plan_id INTEGER DEFAULT 1,
        storage_used INTEGER DEFAULT 0,
        usage_seconds INTEGER DEFAULT 0,
        last_usage_reset TEXT,
        FOREIGN KEY(plan_id) REFERENCES plans(id)
      )`);

      db.all("PRAGMA table_info(users)", (err, columns) => {
        if (err || !columns) return;
        const hasUsage = columns.some(c => c.name === 'usage_seconds');
        const hasReset = columns.some(c => c.name === 'last_usage_reset');
        if (!hasUsage) db.run("ALTER TABLE users ADD COLUMN usage_seconds INTEGER DEFAULT 0");
        if (!hasReset) db.run("ALTER TABLE users ADD COLUMN last_usage_reset TEXT");
      });

      // 3. Update Tabel Videos & Create Folders
      db.run(`CREATE TABLE IF NOT EXISTS videos (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, filename TEXT NOT NULL, path TEXT NOT NULL, size INTEGER, type TEXT DEFAULT 'video', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      
      // Add folder_id to videos if not exists
      db.all("PRAGMA table_info(videos)", (err, columns) => {
          if (!columns.some(c => c.name === 'folder_id')) {
              db.run("ALTER TABLE videos ADD COLUMN folder_id INTEGER DEFAULT NULL");
          }
      });

      // Create Folders Table
      db.run(`CREATE TABLE IF NOT EXISTS folders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          name TEXT NOT NULL,
          parent_id INTEGER DEFAULT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS stream_settings (key TEXT PRIMARY KEY, value TEXT)`);

      // 3. TABLE BARU: stream_destinations untuk Multi-Stream
      db.run(`CREATE TABLE IF NOT EXISTS stream_destinations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT,
        platform TEXT,
        rtmp_url TEXT,
        stream_key TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )`);

      // 4. Seeding Data Plans (UPDATED TO MATCH IMAGE)
      // Format: [ID, Name, Storage(MB), Types, Streams, Price, Duration_Text, HoursLimit]
      const plans = [
        [1, 'Stream Tester', 100, 'audio', 1, 'Rp 30.000', '10 Day', 24],
        [2, 'Starter Stream', 500, 'audio', 2, 'Rp 50.000', '1 Month', 24],
        [3, 'Pro Streamer', 1024, 'audio', 3, 'Rp 80.000', '1 Month', 24],
        [4, 'Ultra Broadcast', 2048, 'audio', 5, 'Rp 120.000', '1 Month', 24]
      ];
      
      plans.forEach(p => {
        // Gunakan INSERT OR REPLACE agar jika paket sudah ada, datanya terupdate sesuai gambar baru
        db.run(`INSERT OR REPLACE INTO plans (id, name, max_storage_mb, allowed_types, max_active_streams, price_text, features_text, daily_limit_hours) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, p);
      });

      // Seeding Default Settings
      const defaultSettings = [
        ['landing_title', 'Start Your <br> <span class="text-indigo-400">Radio Station.</span>'],
        ['landing_desc', 'Server streaming audio paling ringan. Upload MP3, pasang cover, dan broadcast 24/7.'],
        ['landing_btn_reg', 'Daftar Sekarang'],
        ['landing_btn_login', 'Login Member']
      ];
      defaultSettings.forEach(s => db.run(`INSERT OR IGNORE INTO stream_settings (key, value) VALUES (?, ?)`, s));

      // Seeding Admin
      const adminUser = 'admin';
      const adminPass = 'admin123';
      const hash = bcrypt.hashSync(adminPass, 10);
      
      db.get("SELECT id FROM users WHERE username = ?", [adminUser], (err, row) => {
        if (row) {
           // Ensure admin has the highest plan (Ultra - ID 4) or strict admin privileges
           db.run("UPDATE users SET password_hash = ?, role = 'admin', plan_id = 4 WHERE id = ?", [hash, row.id]);
        } else {
           db.run(`INSERT INTO users (username, password_hash, role, plan_id) VALUES (?, ?, 'admin', 4)`, [adminUser, hash]);
        }
        resolve();
      });
    });
  });
};

const getVideos = (userId) => new Promise((res, rej) => db.all("SELECT * FROM videos WHERE user_id = ? ORDER BY created_at DESC", [userId], (err, rows) => err ? rej(err) : res(rows)));
const saveVideo = (data) => new Promise((res, rej) => db.run("INSERT INTO videos (user_id, filename, path, size, type, folder_id) VALUES (?, ?, ?, ?, ?, ?)", [data.user_id, data.filename, data.path, data.size, data.type || 'video', data.folder_id || null], function(err) { err ? rej(err) : res(this.lastID); }));
const deleteVideo = (id) => new Promise((res, rej) => db.run("DELETE FROM videos WHERE id = ?", [id], (err) => err ? rej(err) : res()));

module.exports = { initDB, getVideos, saveVideo, deleteVideo, db, dbPath };
