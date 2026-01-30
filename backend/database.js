
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.on('error', (err) => {
    console.error("CRITICAL SQLITE ERROR:", err);
});

// Helper: Ensure column exists by checking table info first
const ensureColumn = (table, column, definition) => {
    return new Promise((resolve) => {
        db.all(`PRAGMA table_info(${table})`, (err, rows) => {
            if (err) {
                console.error(`Error checking table ${table}:`, err.message);
                return resolve();
            }
            const exists = rows && rows.some(r => r.name === column);
            if (!exists) {
                console.log(`Migrating: Adding ${column} to ${table}...`);
                db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, (err) => {
                    if (err) console.error(`Migration Failed (${table}.${column}):`, err.message);
                    else console.log(`Migration Success: ${column} added.`);
                    resolve();
                });
            } else {
                resolve();
            }
        });
    });
};

const initDB = () => {
  return new Promise(async (resolve, reject) => {
      
      // 1. Create Base Tables
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
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS videos (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, filename TEXT NOT NULL, path TEXT NOT NULL, size INTEGER, type TEXT DEFAULT 'video', folder_id INTEGER DEFAULT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

      db.run(`CREATE TABLE IF NOT EXISTS folders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          name TEXT NOT NULL,
          parent_id INTEGER DEFAULT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS stream_settings (key TEXT PRIMARY KEY, value TEXT)`);

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

      // 2. ROBUST MIGRATION (Ensure Columns Exist)
      // Gunakan setTimeout untuk memberi jeda agar tabel terbentuk sempurna
      await new Promise(r => setTimeout(r, 500));

      await ensureColumn('plans', 'price_text', 'TEXT');
      await ensureColumn('plans', 'features_text', 'TEXT');
      await ensureColumn('plans', 'daily_limit_hours', 'INTEGER DEFAULT 24');
      
      await ensureColumn('users', 'usage_seconds', 'INTEGER DEFAULT 0');
      await ensureColumn('users', 'last_usage_reset', 'TEXT');
      await ensureColumn('users', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
      
      await ensureColumn('videos', 'folder_id', 'INTEGER DEFAULT NULL');

      // 3. SEEDING
      const plans = [
        [1, 'Stream Tester', 100, 'audio', 1, 'Rp 30.000', '10 Day', 24],
        [2, 'Starter Stream', 500, 'audio', 2, 'Rp 50.000', '1 Month', 24],
        [3, 'Pro Streamer', 1024, 'audio', 3, 'Rp 80.000', '1 Month', 24],
        [4, 'Ultra Broadcast', 2048, 'audio', 5, 'Rp 120.000', '1 Month', 24]
      ];
      
      plans.forEach(p => {
        db.run(`INSERT OR REPLACE INTO plans (id, name, max_storage_mb, allowed_types, max_active_streams, price_text, features_text, daily_limit_hours) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, p);
      });

      const defaultSettings = [
        ['landing_title', 'Start Your <br> <span class="text-indigo-400">Radio Station.</span>'],
        ['landing_desc', 'Server streaming audio paling ringan. Upload MP3, pasang cover, dan broadcast 24/7.'],
        ['landing_btn_reg', 'Daftar Sekarang'],
        ['landing_btn_login', 'Login Member']
      ];
      defaultSettings.forEach(s => db.run(`INSERT OR IGNORE INTO stream_settings (key, value) VALUES (?, ?)`, s));

      // 4. Admin Seeding
      const adminUser = 'admin';
      const adminPass = 'admin123';
      const hash = bcrypt.hashSync(adminPass, 10);
      
      db.get("SELECT id FROM users WHERE username = ?", [adminUser], (err, row) => {
          if (row) {
             console.log("Database Ready.");
          } else {
             console.log("Creating Admin User...");
             db.run(`INSERT INTO users (username, password_hash, role, plan_id) VALUES (?, ?, 'admin', 4)`, [adminUser, hash]);
          }
          resolve(); 
      });
  });
};

const getVideos = (userId) => new Promise((res, rej) => db.all("SELECT * FROM videos WHERE user_id = ? ORDER BY created_at DESC", [userId], (err, rows) => err ? rej(err) : res(rows)));
const saveVideo = (data) => new Promise((res, rej) => db.run("INSERT INTO videos (user_id, filename, path, size, type, folder_id) VALUES (?, ?, ?, ?, ?, ?)", [data.user_id, data.filename, data.path, data.size, data.type || 'video', data.folder_id || null], function(err) { err ? rej(err) : res(this.lastID); }));
const deleteVideo = (id) => new Promise((res, rej) => db.run("DELETE FROM videos WHERE id = ?", [id], (err) => err ? rej(err) : res()));

module.exports = { initDB, getVideos, saveVideo, deleteVideo, db, dbPath };
