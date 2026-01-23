
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const dotenv = require('dotenv');
const { initDB } = require('./database');
const routes = require('./routes');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Pastikan folder uploads tersedia
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global IO untuk streamEngine
global.io = io;

/**
 * SERVING FILES:
 * Kita menyajikan file dari root folder agar index.html dan index.tsx bisa diakses langsung.
 */
app.use(express.static(path.join(__dirname, '../')));
app.use('/uploads', express.static(uploadDir));

// API Routes
app.use('/api', routes);

// Handle SPA: Semua request non-API diarahkan ke index.html di root
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.includes('.')) {
    res.sendFile(path.resolve(__dirname, '../index.html'));
  }
});

const PORT = process.env.PORT || 3000;

initDB()
  .then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`---------------------------------------------------`);
      console.log(`LiteStream VPS Engine: http://localhost:${PORT}`);
      console.log(`---------------------------------------------------`);
    });
  })
  .catch(err => {
    console.error("Database initialization failed", err);
  });

io.on('connection', (socket) => {
  console.log('Client connected');
  socket.emit('log', { type: 'info', message: 'Dashboard connected to VPS Engine' });
});
