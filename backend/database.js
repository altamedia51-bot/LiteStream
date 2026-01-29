
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

// Prevents crash on unhandled DB errors
db.on('error', (err) => {
    console.error("CRITICAL SQLITE ERROR:", err);
});

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
      )`, (err) => { if(err) console.error("Error creating plans table:", err); });

      db.all("PRAGMA table_info(plans)", (err, columns) => {
        if (err || !columns) return;
        const hasPrice = columns.some(c => c.name === 'price_text');
        const hasFeatures = columns.some(c => c.name === 'features_text');
        const hasLimit = columns.some(c => c.name === 'daily_limit_hours');
        
        if (!hasPrice) db.run("ALTER TABLE plans ADD COLUMN price_text TEXT", (e)=>e&&console.error(e));
        if (!hasFeatures) db.run("ALTER TABLE plans ADD COLUMN features_text TEXT", (e)=>e&&console.error(e));
        if (!hasLimit) db.run("ALTER TABLE plans ADD COLUMN daily_limit_hours INTEGER DEFAULT 24", (e)=>e&&console.error(e));
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(plan_id) REFERENCES plans(id)
      )`, (err) => { if(err) console.error("Error creating users table:", err); });

      db.all("PRAGMA table_info(users)", (err, columns) => {
        if (err || !columns) return;
        const hasUsage = columns.some(c => c.name === 'usage_seconds');
        const hasReset = columns.some(c => c.name === 'last_usage_reset');
        const hasCreated = columns.some(c => c.name === 'created_at'); 
        
        if (!hasUsage) db.run("ALTER TABLE users ADD COLUMN usage_seconds INTEGER DEFAULT 0", (e)=>e&&console.error(e));
        if (!hasReset) db.run("ALTER TABLE users ADD COLUMN last_usage_reset TEXT", (e)=>e&&console.error(e));
        if (!hasCreated) db.run("ALTER TABLE users ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP", (e)=>e&&console.error("Migration Error created_at:", e));
      });

      // 3. Update Tabel Videos & Create Folders
      db.run(`CREATE TABLE IF NOT EXISTS videos (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, filename TEXT NOT NULL, path TEXT NOT NULL, size INTEGER, type TEXT DEFAULT 'video', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      
      // Add folder_id to videos if not exists
      db.all("PRAGMA table_info(videos)", (err, columns) => {
          if (!columns.some(c => c.name === 'folder_id')) {
              db.run("ALTER TABLE videos ADD COLUMN folder_id INTEGER DEFAULT NULL", (e)=>e&&console.error(e));
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

      // 4. Seeding Data Plans
      const plans = [
        [1, 'Stream Tester', 100, 'audio', 1, 'Rp 30.000', '10 Day', 24],
        [2, 'Starter Stream', 500, 'audio', 2, 'Rp 50.000', '1 Month', 24],
        [3, 'Pro Streamer', 1024, 'audio', 3, 'Rp 80.000', '1 Month', 24],
        [4, 'Ultra Broadcast', 2048, 'audio', 5, 'Rp 120.000', '1 Month', 24]
      ];
      
      plans.forEach(p => {
        db.run(`INSERT OR REPLACE INTO plans (id, name, max_storage_mb, allowed_types, max_active_streams, price_text, features_text, daily_limit_hours) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, p, (e) => { if(e) console.error("Plan seed error:", e); });
      });

      // Seeding Default Settings
      const defaultSettings = [
        ['landing_title', 'Start Your <br> <span class="text-indigo-400">Radio Station.</span>'],
        ['landing_desc', 'Server streaming audio paling ringan. Upload MP3, pasang cover, dan broadcast 24/7.'],
        ['landing_btn_reg', 'Daftar Sekarang'],
        ['landing_btn_login', 'Login Member']
      ];
      defaultSettings.forEach(s => db.run(`INSERT OR IGNORE INTO stream_settings (key, value) VALUES (?, ?)`, s));

      // Seeding Admin (ROBUST VERSION)
      const adminUser = 'admin';
      const adminPass = 'admin123';
      const hash = bcrypt.hashSync(adminPass, 10);
      
      db.get("SELECT id FROM users WHERE username = ?", [adminUser], (err, row) => {
        if (err) {
            console.error("Error checking admin user:", err);
            resolve(); // Resolve anyway to start server
            return;
        }

        if (row) {
           console.log("Resetting Admin Password...");
           db.run("UPDATE users SET password_hash = ?, role = 'admin', plan_id = 4 WHERE id = ?", [hash, row.id], (err) => {
               if(err) console.error("Failed to update admin:", err);
               else console.log(">> Admin Access: Username 'admin', Password 'admin123'");
               resolve();
           });
        } else {
           console.log("Creating Admin User...");
           db.run(`INSERT INTO users (username, password_hash, role, plan_id) VALUES (?, ?, 'admin', 4)`, [adminUser, hash], (err) => {
               if(err) console.error("Failed to create admin:", err);
               else console.log(">> Admin Access: Username 'admin', Password 'admin123'");
               resolve();
           });
        }
      });
    });
  });
};

const getVideos = (userId) => new Promise((res, rej) => db.all("SELECT * FROM videos WHERE user_id = ? ORDER BY created_at DESC", [userId], (err, rows) => err ? rej(err) : res(rows)));
const saveVideo = (data) => new Promise((res, rej) => db.run("INSERT INTO videos (user_id, filename, path, size, type, folder_id) VALUES (?, ?, ?, ?, ?, ?)", [data.user_id, data.filename, data.path, data.size, data.type || 'video', data.folder_id || null], function(err) { err ? rej(err) : res(this.lastID); }));
const deleteVideo = (id) => new Promise((res, rej) => db.run("DELETE FROM videos WHERE id = ?", [id], (err) => err ? rej(err) : res()));

module.exports = { initDB, getVideos, saveVideo, deleteVideo, db, dbPath };
