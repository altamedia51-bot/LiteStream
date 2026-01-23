
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

// Setup folder uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Global IO
global.io = io;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routing API
app.use('/api', routes);

// Static uploads
app.use('/uploads', express.static(uploadDir));

// Sajikan index.html dari root folder
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

// Support static files dari root (misal socket.io.js)
app.use(express.static(path.join(__dirname, '../')));

const PORT = process.env.PORT || 3000;

initDB().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`LiteStream Engine Aktif di Port: ${PORT}`);
  });
});

io.on('connection', (socket) => {
  console.log('Client dashboard connected');
});
