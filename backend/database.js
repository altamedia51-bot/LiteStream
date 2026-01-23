
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

      // 2. Buat Tabel
      db.run(`CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        name TEXT UNIQUE, 
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

      // 3. Force Seed Plans (Menggunakan INSERT OR IGNORE)
      console.log("DB: Checking/Seeding Plans...");
      db.run("INSERT OR IGNORE INTO plans (id, name, max_storage_mb, allowed_types, max_active_streams) VALUES (1, 'Free Trial', 500, 'audio', 1)");
      db.run("INSERT OR IGNORE INTO plans (id, name, max_storage_mb, allowed_types, max_active_streams) VALUES (2, 'Radio Station', 5120, 'audio', 1)");
      db.run("INSERT OR IGNORE INTO plans (id, name, max_storage_mb, allowed_types, max_active_streams) VALUES (3, 'Content Creator', 10240, 'video,audio', 2)");

      // 4. Force Seed Admin (Gunakan hashSync agar pasti selesai sebelum lanjut)
      const adminUser = 'admin';
      const adminPass = 'admin123';
      const hash = bcrypt.hashSync(adminPass, 10);
      
      console.log("DB: Checking/Seeding Admin Account...");
      // Kita gunakan REPLACE jika role-nya admin untuk memastikan password/plan selalu benar saat inisialisasi
      db.run(`INSERT OR IGNORE INTO users (username, password_hash, role, plan_id) VALUES (?, ?, 'admin', 3)`, [adminUser, hash], (err) => {
        if (err) {
          console.error("DB Error Seeding Admin:", err);
          reject(err);
        } else {
          console.log("DB: Database Initialized & Secured.");
          resolve();
        }
      });
    });
  });
};

const getVideos = (userId) => new Promise((res, rej) => db.all("SELECT * FROM videos WHERE user_id = ? ORDER BY created_at DESC", [userId], (err, rows) => err ? rej(err) : res(rows)));
const saveVideo = (data) => new Promise((res, rej) => db.run("INSERT INTO videos (user_id, filename, path, size, type) VALUES (?, ?, ?, ?, ?)", [data.user_id, data.filename, data.path, data.size, data.type || 'video'], function(err) { err ? rej(err) : res(this.lastID); }));
const deleteVideo = (id) => new Promise((res, rej) => db.run("DELETE FROM videos WHERE id = ?", [id], (err) => err ? rej(err) : res()));

module.exports = { initDB, getVideos, saveVideo, deleteVideo, db, dbPath };
