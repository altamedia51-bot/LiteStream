
# LiteStream VPS Dashboard

Aplikasi streaming ringan untuk VPS spesifikasi rendah (1 Core, 1GB RAM).

## Alur Deployment

### 1. Persiapan di VPS (Ubuntu/Debian)
Jalankan perintah ini satu kali untuk menginstall dependensi sistem:
```bash
# Update sistem
sudo apt update && sudo apt upgrade -y

# Install FFmpeg (Mesin Utama Streaming)
sudo apt install ffmpeg -y

# Install Node.js 20 (LTS - Versi Stabil Terbaru)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2 (Process Manager agar aplikasi jalan terus di background)
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
# Menjalankan server menggunakan PM2
pm2 start server.js --name "litestream"

# Pastikan PM2 otomatis jalan saat VPS reboot
pm2 save
pm2 startup
```

### 4. Update Kode di Kemudian Hari
Jika Anda melakukan perubahan kode di AI Studio dan sudah push ke GitHub, cukup jalankan ini di VPS:
```bash
cd litestream
git pull
pm2 restart litestream
```

## Fitur Utama
- **Ultra-Low CPU**: Menggunakan mode `-c copy` untuk video sehingga VPS 1 Core tetap dingin.
- **Audio-to-Video Engine**: Streaming MP3 dengan background gambar diam (hanya 2 FPS) untuk menghemat tenaga CPU.
- **SQLite Database**: Tidak perlu install MySQL/PostgreSQL yang memakan banyak RAM.
- **Real-time Monitoring**: Dashboard berbasis Socket.io untuk melihat log FFmpeg secara langsung.

## Catatan Penting
- Pastikan Port `3000` di firewall VPS Anda sudah dibuka.
- Jika ingin menggunakan domain (misal: `stream.anda.com`), gunakan Nginx sebagai reverse proxy.
