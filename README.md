
# LiteStream VPS Dashboard

Aplikasi streaming ringan untuk VPS spesifikasi rendah (1 Core, 1GB RAM).

## Alur Deployment

### 1. Persiapan di VPS (Ubuntu/Debian)
Jalankan perintah ini satu kali:
```bash
# Update sistem
sudo apt update && sudo apt upgrade -y

# Install FFmpeg (Mesin Streaming)
sudo apt install ffmpeg -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2 (Process Manager)
sudo npm install pm2 -g
```

### 2. Clone dari GitHub
```bash
git clone https://github.com/USERNAME/REPO_NAME.git litestream
cd litestream/backend
npm install
```

### 3. Jalankan Aplikasi
```bash
pm2 start server.js --name "litestream"
pm2 save
pm2 startup
```

### 4. Update Kode di Kemudian Hari
Jika Anda melakukan perubahan di AI Studio dan sudah push ke GitHub, cukup jalankan ini di VPS:
```bash
cd litestream
git pull
pm2 restart litestream
```

## Fitur Utama
- **Video Copy**: Streaming video tanpa re-encode (CPU 0%).
- **MP3 Background**: Streaming audio dengan cover image (Low CPU).
- **SQLite**: Database ringan tanpa perlu install MySQL/PostgreSQL.
