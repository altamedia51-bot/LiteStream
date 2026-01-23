
# LiteStream VPS Dashboard

Aplikasi streaming ringan untuk VPS spesifikasi rendah (1 Core, 1GB RAM).

## Alur Deployment Baru

### 1. Persiapan di VPS
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install ffmpeg -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install pm2 -g
```

### 2. Instalasi Pertama
```bash
git clone https://github.com/USERNAME/REPO_NAME.git litestream
cd litestream/backend
npm install
pm2 start server.js --name "litestream"
```

### 3. CARA UPDATE KODE (Sangat Penting)
Jika Anda sudah melakukan perubahan di AI Studio dan ingin menerapkannya di VPS:
```bash
# Pastikan Anda berada di folder utama (bukan di dalam folder backend)
cd ~/litestream

# Tarik perubahan
git pull origin main

# Restart server PM2
pm2 restart litestream
```

## Tips Troubleshooting
- **Cek Port**: `sudo ss -tulpn | grep :3000`
- **Cek Log Real-time**: `pm2 logs litestream`
- **Cek RAM**: `free -h`
- **Jika Layar Blank**: Pastikan file `index.html` dan `index.tsx` ada di folder root (utama), bukan tersembunyi di folder lain. Server sudah dikonfigurasi untuk mencari file tersebut di root.

## Fitur Utama
- **Ultra-Low CPU**: Menggunakan mode `-c copy` untuk video.
- **Audio-to-Video Engine**: Streaming MP3 dengan background gambar diam (hanya 2 FPS).
- **SQLite Database**: Ringan & tanpa setup rumit.
