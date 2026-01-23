
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

const initDB = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Table for uploaded media files
      db.run(`
        CREATE TABLE IF NOT EXISTS videos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filename TEXT NOT NULL,
          path TEXT NOT NULL,
          size INTEGER,
          duration TEXT,
          type TEXT DEFAULT 'video', -- 'video', 'audio', or 'image'
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Table for stream configurations
      db.run(`
        CREATE TABLE IF NOT EXISTS stream_settings (
          key TEXT PRIMARY KEY,
          value TEXT
        )
      `);

      // Seed default settings if empty
      db.get("SELECT value FROM stream_settings WHERE key = 'rtmp_url'", (err, row) => {
        if (!row) {
          db.run("INSERT INTO stream_settings (key, value) VALUES ('rtmp_url', 'rtmp://a.rtmp.youtube.com/live2/your-key')");
        }
        resolve();
      });
    });
  });
};

const getVideos = () => {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM videos ORDER BY created_at DESC", (err, rows) => {
      if (err) reject(err);
      resolve(rows);
    });
  });
};

const saveVideo = (data) => {
  return new Promise((resolve, reject) => {
    const { filename, path, size, type } = data;
    db.run(
      "INSERT INTO videos (filename, path, size, type) VALUES (?, ?, ?, ?)",
      [filename, path, size, type || 'video'],
      function(err) {
        if (err) reject(err);
        resolve(this.lastID);
      }
    );
  });
};

const deleteVideo = (id) => {
  return new Promise((resolve, reject) => {
    db.run("DELETE FROM videos WHERE id = ?", [id], (err) => {
      if (err) reject(err);
      resolve();
    });
  });
};

module.exports = { initDB, getVideos, saveVideo, deleteVideo, db };
