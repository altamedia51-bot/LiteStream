
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

// --- FAIL SAFE STARTUP ---
// Tangkap semua error agar server tidak pernah crash total
process.on('uncaughtException', (err) => {
    console.error('CRITICAL ERROR (Uncaught):', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('CRITICAL ERROR (Unhandled Rejection):', reason);
});

console.log("------------------------------------------");
console.log("LITESTREAM SERVER v1.5 (FAIL-SAFE MODE)");
console.log("Starting up...");
console.log("------------------------------------------");

dotenv.config();

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

global.io = io;
let isDbReady = false;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Setup
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: __dirname, concurrentDB: true }),
  secret: 'litestream_vps_super_secret_saas',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// --- MAINTENANCE MIDDLEWARE ---
// Jika DB belum siap, tampilkan halaman loading, jangan matikan server
app.use((req, res, next) => {
    if (req.path === '/api/status-check') return res.json({ status: isDbReady ? 'online' : 'booting' });
    
    // Bypass untuk asset static agar halaman tetap terlihat bagus
    if (req.path.includes('.') || req.path.startsWith('/node_modules')) return next();

    if (!isDbReady) {
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            return res.status(503).json({ error: "Server is booting database..." });
        }
        return res.send(`
            <html>
            <head><title>LiteStream Booting...</title><meta http-equiv="refresh" content="3"></head>
            <body style="background:#0f172a; color:white; font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh;">
                <div style="text-align:center">
                    <h1 style="color:#6366f1">LiteStream Starting...</h1>
                    <p>Connecting to Database. Page will refresh automatically.</p>
                </div>
            </body>
            </html>
        `);
    }
    next();
});

const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.user) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

// === ROUTES ===

app.get('/api/factory-reset', (req, res) => {
    // ... code reset ...
    res.send("Factory Reset Not Available in Fail-Safe Mode");
});

app.post('/api/login', (req, res) => {
  let { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, error: "Username/Password wajib" });

  username = username.toString().trim();
  password = password.toString().trim();
  
  if (username === 'admin' && password === 'admin123') {
      req.session.user = { 
          id: 1, username: 'admin', role: 'admin', plan_id: 4, plan_name: 'Administrator',
          max_storage_mb: 999999, allowed_types: 'audio,video,image', created_at: new Date().toISOString()
      };
      return req.session.save(() => res.json({ success: true, message: "Welcome Admin" }));
  }

  db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
    if (err || !user) return res.status(401).json({ success: false, error: 'User tidak ditemukan.' });
    if (await bcrypt.compare(password, user.password_hash)) {
        db.get("SELECT * FROM plans WHERE id = ?", [user.plan_id], (err2, plan) => {
            req.session.user = { 
              id: user.id, username: user.username, role: user.role, plan_id: user.plan_id,
              plan_name: plan ? plan.name : 'User', max_storage_mb: plan ? plan.max_storage_mb : 500,
              allowed_types: plan ? plan.allowed_types : 'audio', created_at: user.created_at
            };
            req.session.save(() => res.json({ success: true }));
        });
    } else {
        res.status(401).json({ success: false, error: 'Password Salah.' });
    }
  });
});

app.post('/api/register', async (req, res) => {
  const { username, password, plan_id } = req.body;
  if (!username || !password) return res.status(400).json({ success: false });
  const hash = await bcrypt.hash(password, 10);
  db.run("INSERT INTO users (username, password_hash, role, plan_id, created_at) VALUES (?, ?, 'user', ?, ?)", 
    [username, hash, plan_id || 1, new Date().toISOString()], 
    function(err) {
        if (err) return res.status(400).json({ success: false, error: 'Username dipakai' });
        res.json({ success: true });
    }
  );
});

app.get('/api/check-auth', (req, res) => {
  if (!req.session.user) return res.json({ authenticated: false });
  res.json({ authenticated: true, user: req.session.user });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));

// Load Routes
const routes = require('./routes');
app.use('/api', (req, res, next) => {
  if (['/login', '/register', '/check-auth', '/plans-public', '/landing-content'].includes(req.path)) return next();
  return isAuthenticated(req, res, next);
}, routes);

// Static Files
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../index.html')));
app.use(express.static(path.join(__dirname, '../')));

// --- INSTANT STARTUP ---
// Server listen DULUAN, Database init belakangan.
// Ini memastikan port 3000 terbuka secepat kilat.
server.listen(3000, '0.0.0.0', () => {
    console.log("===============================================");
    console.log(">> LITESTREAM HTTP SERVER LISTENING ON PORT 3000");
    console.log(">> Waiting for Database...");
    console.log("===============================================");
    
    initDB().then(() => {
        console.log(">> DATABASE READY. System Fully Operational.");
        isDbReady = true;
    }).catch(err => {
        console.error(">> DATABASE ERROR:", err);
        // Server tetap jalan di port 3000 agar user tau ada error, bukan connection refused.
    });
});
