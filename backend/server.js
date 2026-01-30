
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
const { initDB, db, dbPath } = require('./database');

// PREVENT CRASH ON STARTUP ERRORS
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason);
});

console.log("Starting LiteStream Server...");

dotenv.config();

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

global.io = io;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: __dirname }),
  secret: 'litestream_vps_super_secret_saas',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.user) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

// === FACTORY RESET ROUTE ===
app.get('/api/factory-reset', (req, res) => {
    try {
        const sessionFile = path.join(__dirname, 'sessions.sqlite');
        
        if (fs.existsSync(dbPath)) {
            db.close(() => {
                try {
                    fs.unlinkSync(dbPath);
                    console.log("Database deleted.");
                } catch(e) { console.error("Del DB Fail", e); }
            });
        }

        if (fs.existsSync(sessionFile)) {
            try {
                fs.unlinkSync(sessionFile);
                console.log("Sessions deleted.");
            } catch(e) { console.error("Del Session Fail", e); }
        }

        res.send(`<h1>FACTORY RESET SUCCESS</h1><script>setTimeout(() => { window.location.href = '/' }, 5000);</script>`);
        setTimeout(() => { process.exit(0); }, 2000);

    } catch (e) {
        res.send("Reset Error: " + e.message);
    }
});

// === DEBUG ROUTE TO SEE USERS ===
app.get('/api/debug-users', (req, res) => {
    // Gunakan SELECT * agar tidak error jika kolom spesifik hilang
    db.all("SELECT * FROM users", (err, rows) => {
        if (err) return res.json({ error: err.message });
        res.json({ users: rows, admin_hint: "Try 'admin' / 'admin123'" });
    });
});

app.post('/api/login', (req, res) => {
  let { username, password } = req.body;
  
  if (!username || !password) {
      return res.status(400).json({ success: false, error: "Username/Password wajib" });
  }

  username = username.toString().trim();
  password = password.toString().trim();
  
  console.log(`Login Request: [${username}]`);

  // 1. ABSOLUTE ADMIN BYPASS (Database-Free)
  if (username === 'admin' && password === 'admin123') {
      console.log(">> SUPER ADMIN BYPASS LOGIN <<");
      req.session.user = { 
          id: 1, 
          username: 'admin', 
          role: 'admin',
          plan_id: 4,
          plan_name: 'Administrator',
          max_storage_mb: 999999,
          allowed_types: 'audio,video,image',
          created_at: new Date().toISOString()
      };

      return req.session.save((err) => {
          if (err) {
              console.error("Session Save Error:", err);
              return res.status(500).json({ success: false, error: 'Session Write Failed' });
          }
          res.json({ success: true, message: "Welcome Admin (Bypass Mode)" });
      });
  }

  // 2. Normal User Login
  // Gunakan SELECT * untuk menghindari error kolom hilang
  const query = `
    SELECT u.*, p.name as plan_name, p.max_storage_mb, p.allowed_types 
    FROM users u 
    LEFT JOIN plans p ON u.plan_id = p.id 
    WHERE u.username = ?`;

  db.get(query, [username], async (err, user) => {
    if (err) {
        console.error("DB Login Error:", err);
        return res.status(500).json({ success: false, error: 'Server Database Error' });
    }
    
    if (!user) {
        return res.status(401).json({ success: false, error: 'Username tidak ditemukan.' });
    }

    try {
      if (!user.password_hash) {
           return res.status(500).json({ success: false, error: 'User data corrupt' });
      }

      const match = await bcrypt.compare(password, user.password_hash);
      
      if (match) {
        console.log(`Login Success: ${username}`);
        
        let finalPlanName = user.plan_name || 'Standard Plan';
        let finalMaxStorage = user.max_storage_mb || 500;
        let finalAllowedTypes = user.allowed_types || 'audio';
        
        if (user.role === 'admin') {
            finalPlanName = 'Administrator';
            finalMaxStorage = 999999; 
            finalAllowedTypes = 'audio,video,image';
        }

        req.session.user = { 
          id: user.id, 
          username: user.username, 
          role: user.role,
          plan_id: user.plan_id || 1,
          plan_name: finalPlanName,
          max_storage_mb: finalMaxStorage,
          allowed_types: finalAllowedTypes,
          created_at: user.created_at || new Date().toISOString()
        };

        return req.session.save((err) => {
          if (err) return res.status(500).json({ success: false, error: 'Session Error' });
          res.json({ success: true });
        });
      } else {
          return res.status(401).json({ success: false, error: 'Password Salah.' });
      }
    } catch (e) {
        console.error("Bcrypt Error:", e);
        res.status(500).json({ success: false, error: 'Auth Processing Error' });
    }
  });
});

app.post('/api/register', async (req, res) => {
  const { username, password, plan_id } = req.body; // Ambil plan_id dari request
  if (!username || !password) return res.status(400).json({ success: false, error: "Isi semua data" });
  
  // Validasi plan_id, default ke 1 jika tidak ada
  const finalPlanId = plan_id ? parseInt(plan_id) : 1;
  
  const hash = await bcrypt.hash(password, 10);
  // Gunakan finalPlanId, bukan hardcode 1
  db.run("INSERT INTO users (username, password_hash, role, plan_id) VALUES (?, ?, ?, ?)", [username, hash, 'user', finalPlanId], function(err) {
    if (err) return res.status(400).json({ success: false, error: 'Username sudah dipakai' });
    res.json({ success: true, message: 'Registrasi Berhasil' });
  });
});

app.get('/api/check-auth', (req, res) => {
  if (!req.session.user) return res.json({ authenticated: false });
  
  // FIX: Menggunakan SELECT * (wildcard) lebih aman jika kolom created_at hilang di DB
  // Data sesi diutamakan, DB hanya untuk refresh data usage/plan
  const query = "SELECT * FROM users WHERE id = ?";
  
  db.get(query, [req.session.user.id], (err, row) => {
    if (err) {
        // Jika error, log tapi jangan crash. Return session user yg ada.
        console.error("Check Auth DB Error (Ignored):", err.message);
        return res.json({ authenticated: true, user: req.session.user });
    }

    if (row) {
      db.get("SELECT name as plan_name, max_storage_mb, allowed_types FROM plans WHERE id = ?", [row.plan_id], (err, p) => {
        let fullUser = { 
          ...req.session.user, 
          storage_used: row.storage_used, 
          plan_id: row.plan_id, 
          // Pakai fallback jika created_at hilang di DB
          created_at: row.created_at || req.session.user.created_at || new Date().toISOString(),
          plan_name: p ? p.plan_name : req.session.user.plan_name,
          max_storage_mb: p ? p.max_storage_mb : req.session.user.max_storage_mb,
          allowed_types: p ? p.allowed_types : req.session.user.allowed_types
        };
        
        if (req.session.user.role === 'admin' || row.role === 'admin') {
            fullUser.plan_name = 'Administrator';
            fullUser.max_storage_mb = 999999;
            fullUser.daily_limit_hours = 24;
        }

        res.json({ authenticated: true, user: fullUser });
      });
    } else {
        // User di session ada, tapi di DB hilang (mungkin DB ke-reset)
        req.session.destroy();
        res.json({ authenticated: false });
    }
  });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));

const routes = require('./routes');
app.use('/api', (req, res, next) => {
  if (['/login', '/register', '/check-auth', '/plans-public', '/landing-content', '/factory-reset', '/debug-users'].includes(req.path)) return next();
  return isAuthenticated(req, res, next);
}, routes);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../index.html')));
app.use(express.static(path.join(__dirname, '../')));

initDB().then(() => {
  server.listen(3000, '0.0.0.0', () => console.log("LITESTREAM READY: Port 3000"));
}).catch(err => {
    console.error("DB INIT FAILED:", err);
    server.listen(3000, '0.0.0.0', () => console.log("LITESTREAM STARTED (DB ERROR MODE): Port 3000"));
});
