
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
    // Keep alive if possible, but logging is critical
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

        res.send(`<h1>FACTORY RESET SUCCESS</h1><script>setTimeout(() => { window.location.href = '/' }, 10000);</script>`);
        setTimeout(() => { process.exit(0); }, 2000);

    } catch (e) {
        res.send("Reset Error: " + e.message);
    }
});

app.post('/api/login', (req, res) => {
  let { username, password } = req.body;
  
  // 1. Bersihkan Input
  username = (username || '').trim();
  password = (password || '').trim();
  
  console.log(`Login Attempt: User [${username}]`);

  // 2. EMERGENCY BACKDOOR FOR ADMIN
  // Ini menjamin admin bisa masuk meski database korup atau hash salah
  if (username === 'admin' && password === 'admin123') {
      console.log("!! ADMIN EMERGENCY LOGIN TRIGGERED !!");
      
      db.get("SELECT * FROM users WHERE username = 'admin'", (err, user) => {
          // Jika user admin entah kenapa tidak ada di DB, kita buatkan data session sementara
          // (initDB seharusnya sudah membuatnya, tapi ini fail-safe)
          const adminSession = { 
            id: user ? user.id : 1, 
            username: 'admin', 
            role: 'admin',
            plan_id: 4,
            plan_name: 'Administrator',
            max_storage_mb: 999999,
            allowed_types: 'audio,video,image',
            created_at: user ? user.created_at : new Date().toISOString()
          };

          req.session.user = adminSession;
          return req.session.save(() => res.json({ success: true }));
      });
      return; 
  }

  // 3. Normal User Login Flow
  const query = `
    SELECT u.*, p.name as plan_name, p.max_storage_mb, p.allowed_types 
    FROM users u 
    LEFT JOIN plans p ON u.plan_id = p.id 
    WHERE u.username = ?`;

  db.get(query, [username], async (err, user) => {
    if (err) {
        console.error("DB Error during login:", err);
        return res.status(500).json({ success: false, error: 'Database Error' });
    }
    
    if (!user) {
        console.log(`Login Failed: User '${username}' not found in DB.`);
        return res.status(401).json({ success: false, error: 'Username tidak ditemukan.' });
    }

    try {
      if (!user.password_hash) {
          // Jika user tidak punya password (error db lama), tolak
          return res.status(500).json({ success: false, error: 'Corrupt User Data' });
      }

      const match = await bcrypt.compare(password, user.password_hash);
      
      if (match) {
        console.log(`Login Success: ${username}`);
        
        let finalPlanName = user.plan_name || 'Standard Plan';
        let finalMaxStorage = user.max_storage_mb || 500;
        let finalAllowedTypes = user.allowed_types || 'audio';
        
        // Ensure admin gets admin perks even in normal login
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
          created_at: user.created_at
        };

        return req.session.save((err) => {
          if (err) return res.status(500).json({ success: false, error: 'Session Error' });
          res.json({ success: true });
        });
      } else {
          console.log(`Login Failed: Wrong Password for '${username}'`);
          return res.status(401).json({ success: false, error: 'Password Salah.' });
      }
    } catch (e) {
        console.error("Bcrypt Error:", e);
        res.status(500).json({ success: false, error: 'Auth Error' });
    }
  });
});

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  db.run("INSERT INTO users (username, password_hash, role, plan_id) VALUES (?, ?, ?, ?)", [username, hash, 'user', 1], function(err) {
    if (err) return res.status(400).json({ success: false, error: 'User sudah ada' });
    res.json({ success: true, message: 'Registrasi Berhasil' });
  });
});

app.get('/api/check-auth', (req, res) => {
  if (!req.session.user) return res.json({ authenticated: false });
  
  // Safe query to avoid crash if created_at missing
  const query = "SELECT storage_used, plan_id, role, created_at FROM users WHERE id = ?";
  
  db.get(query, [req.session.user.id], (err, row) => {
    if (err) {
        console.error("Check Auth DB Error:", err);
        return res.json({ authenticated: false }); // Fallback
    }

    if (row) {
      db.get("SELECT name as plan_name, max_storage_mb, allowed_types FROM plans WHERE id = ?", [row.plan_id], (err, p) => {
        let fullUser = { 
          ...req.session.user, 
          storage_used: row.storage_used, 
          plan_id: row.plan_id, 
          created_at: row.created_at, 
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
        req.session.destroy();
        res.json({ authenticated: false });
    }
  });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));

const routes = require('./routes');
app.use('/api', (req, res, next) => {
  if (['/login', '/register', '/check-auth', '/plans-public', '/landing-content', '/factory-reset'].includes(req.path)) return next();
  return isAuthenticated(req, res, next);
}, routes);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../index.html')));
app.use(express.static(path.join(__dirname, '../')));

initDB().then(() => {
  server.listen(3000, '0.0.0.0', () => console.log("LITESTREAM READY: Port 3000"));
}).catch(err => {
    console.error("DB INIT FAILED:", err);
    // Try starting anyway for debug
    server.listen(3000, '0.0.0.0', () => console.log("LITESTREAM STARTED (DB ERROR MODE): Port 3000"));
});
