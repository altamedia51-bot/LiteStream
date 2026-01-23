
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

const initDB = () => {
  return new Promise((resolve, reject) => {
    db.serialize(async () => {
      // Buat Tabel
      db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, role TEXT DEFAULT 'admin')`);
      db.run(`CREATE TABLE IF NOT EXISTS videos (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, path TEXT NOT NULL, size INTEGER, type TEXT DEFAULT 'video', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      db.run(`CREATE TABLE IF NOT EXISTS stream_settings (key TEXT PRIMARY KEY, value TEXT)`);
      
      // Tabel baru untuk Penjadwalan
      db.run(`CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        media_ids TEXT, 
        rtmp_url TEXT, 
        cover_image_id INTEGER, 
        loop_playlist INTEGER DEFAULT 1, 
        scheduled_at DATETIME, 
        status TEXT DEFAULT 'pending'
      )`);

      // Seeding User Admin
      const defaultUser = 'admin';
      const defaultPass = 'admin123';
      
      db.get("SELECT * FROM users WHERE username = ?", [defaultUser], async (err, user) => {
        if (err) return reject(err);
        
        const hash = await bcrypt.hash(defaultPass, 10);
        
        if (!user) {
          console.log("DB: Seeding admin baru...");
          db.run("INSERT INTO users (username, password_hash) VALUES (?, ?)", [defaultUser, hash], (err) => {
            if (err) reject(err);
            else {
              console.log("DB: Admin created: admin / admin123");
              resolve();
            }
          });
        } else {
          const isMatch = await bcrypt.compare(defaultPass, user.password_hash);
          if (!isMatch) {
            console.log("DB: Password mismatch, mereset...");
            db.run("UPDATE users SET password_hash = ? WHERE username = ?", [hash, defaultUser], (err) => {
              if (err) reject(err);
              else resolve();
            });
          } else {
            resolve();
          }
        }
      });
    });
  });
};

const getVideos = () => new Promise((res, rej) => db.all("SELECT * FROM videos ORDER BY created_at DESC", (err, rows) => err ? rej(err) : res(rows)));
const saveVideo = (data) => new Promise((res, rej) => db.run("INSERT INTO videos (filename, path, size, type) VALUES (?, ?, ?, ?)", [data.filename, data.path, data.size, data.type || 'video'], function(err) { err ? rej(err) : res(this.lastID); }));
const deleteVideo = (id) => new Promise((res, rej) => db.run("DELETE FROM videos WHERE id = ?", [id], (err) => err ? rej(err) : res()));

module.exports = { initDB, getVideos, saveVideo, deleteVideo, db, dbPath };
