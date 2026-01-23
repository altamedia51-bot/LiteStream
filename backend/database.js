
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

const initDB = () => {
  return new Promise((resolve, reject) => {
    db.serialize(async () => {
      // 1. Buat Tabel Utama
      db.run(`CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        name TEXT, 
        max_storage_mb INTEGER, 
        allowed_types TEXT, 
        max_active_streams INTEGER
      )`);

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

      // 2. Seeding Plans secara sekuensial
      db.get("SELECT count(*) as count FROM plans", async (err, row) => {
        if (row && row.count === 0) {
          console.log("DB: Seeding Default Plans...");
          const stmt = db.prepare("INSERT INTO plans (name, max_storage_mb, allowed_types, max_active_streams) VALUES (?, ?, ?, ?)");
          stmt.run('Free Trial', 500, 'audio', 1);
          stmt.run('Radio Station', 5120, 'audio', 1);
          stmt.run('Content Creator', 10240, 'video,audio', 2);
          stmt.finalize();
        }

        // 3. Seeding User Admin (Dijalankan SETELAH plans dipastikan ada/dicek)
        const defaultUser = 'admin';
        const defaultPass = 'admin123';
        const hash = await bcrypt.hash(defaultPass, 10);
        
        db.get("SELECT * FROM users WHERE username = ?", [defaultUser], (err, user) => {
          if (!user) {
            console.log("DB: Seeding Admin Account...");
            db.run("INSERT INTO users (username, password_hash, role, plan_id) VALUES (?, ?, ?, ?)", [defaultUser, hash, 'admin', 3], (err) => {
              if (err) console.error("DB Error Seeding Admin:", err);
              resolve();
            });
          } else {
            resolve();
          }
        });
      });
    });
  });
};

const getVideos = (userId) => new Promise((res, rej) => db.all("SELECT * FROM videos WHERE user_id = ? ORDER BY created_at DESC", [userId], (err, rows) => err ? rej(err) : res(rows)));
const saveVideo = (data) => new Promise((res, rej) => db.run("INSERT INTO videos (user_id, filename, path, size, type) VALUES (?, ?, ?, ?, ?)", [data.user_id, data.filename, data.path, data.size, data.type || 'video'], function(err) { err ? rej(err) : res(this.lastID); }));
const deleteVideo = (id) => new Promise((res, rej) => db.run("DELETE FROM videos WHERE id = ?", [id], (err) => err ? rej(err) : res()));

module.exports = { initDB, getVideos, saveVideo, deleteVideo, db, dbPath };
