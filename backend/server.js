
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

// Serving static files dari root (index.html utama)
app.use(express.static(path.join(__dirname, '../')));
// Serving uploads
app.use('/uploads', express.static(uploadDir));

// API Routes
app.use('/api', routes);

// Handle SPA: Pastikan request diarahkan ke index.html utama
app.get('/', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../index.html'));
});

const PORT = process.env.PORT || 3000;

initDB()
  .then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`---------------------------------------------------`);
      console.log(`LiteStream VPS Engine: http://76.13.20.2:${PORT}`);
      console.log(`---------------------------------------------------`);
    });
  })
  .catch(err => {
    console.error("Database initialization failed", err);
  });

io.on('connection', (socket) => {
  console.log('Dashboard connected');
  socket.emit('log', { type: 'info', message: 'Koneksi ke VPS Berhasil' });
});
