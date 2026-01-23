
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const dotenv = require('dotenv');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const { initDB, db } = require('./database');

dotenv.config();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// PENTING: Set global.io agar streamEngine dan routes bisa kirim log
global.io = io;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Setup
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: __dirname }),
  secret: 'litestream_vps_super_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.user) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

// Login Route
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username dan password wajib diisi' });
  }

  db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
    if (err) return res.status(500).json({ success: false, error: 'Kesalahan Database' });
    
    if (user && await bcrypt.compare(password, user.password_hash)) {
      req.session.user = { id: user.id, username: user.username };
      return req.session.save(() => res.json({ success: true }));
    }
    
    res.status(401).json({ success: false, error: 'Username atau Password salah' });
  });
});

// Register Route
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username dan Password wajib diisi' });
  }

  if (password.length < 6) {
    return res.status(400).json({ success: false, error: 'Password minimal 6 karakter' });
  }

  // Cek apakah user sudah ada
  db.get("SELECT id FROM users WHERE username = ?", [username], async (err, row) => {
    if (err) return res.status(500).json({ success: false, error: 'Kesalahan Database' });
    if (row) return res.status(400).json({ success: false, error: 'Username sudah digunakan' });

    try {
      const hash = await bcrypt.hash(password, 10);
      db.run("INSERT INTO users (username, password_hash) VALUES (?, ?)", [username, hash], function(err) {
        if (err) return res.status(500).json({ success: false, error: 'Gagal mendaftarkan user' });
        res.json({ success: true, message: 'Registrasi berhasil! Silakan login.' });
      });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Kesalahan Server' });
    }
  });
});

app.get('/api/check-auth', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.user), user: req.session ? req.session.user : null });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// Load Routes
const routes = require('./routes');
app.use('/api', (req, res, next) => {
  // Pengecualian middleware auth untuk login dan register
  if (['/login', '/register', '/check-auth'].includes(req.path)) return next();
  return isAuthenticated(req, res, next);
}, routes);

app.use('/uploads', isAuthenticated, express.static(path.join(__dirname, 'uploads')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../index.html')));
app.use(express.static(path.join(__dirname, '../')));

initDB().then(() => {
  server.listen(3000, '0.0.0.0', () => {
    console.log("LITESTREAM SERVER AKTIF: Port 3000");
  });
});
