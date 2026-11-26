#!/bin/bash

# Pindah ke direktori tempat script ini berada
cd "$(dirname "$0")"

echo "=========================================="
echo "🧹 Cleaning Telegram Remote Browser Bot..."
echo "=========================================="

# 1. Hentikan & hapus container project ini
echo "1. Menghapus container bot & database..."
podman rm -f tg-remote-browser-bot tg-remote-browser-mongo 2>/dev/null || true

# 2. Hapus image bot lama agar saat start berikutnya mendownload yang benar-benar baru
echo "2. Menghapus image bot lama..."
podman rmi docker.io/fitra17/tg-remote-browser-bot:latest 2>/dev/null || true

# 3. Bersihkan sisa network atau cache build sementara
echo "3. Membersihkan cache Podman yang tidak terpakai..."
podman system prune -f

echo ""
echo "=========================================="
echo "✨ Status Podman saat ini:"
echo "=========================================="
podman system df

echo ""
echo "✅ Pembersihan selesai! Data profil & database MongoDB di volume tetap AMAN."
echo "   Untuk menjalankan ulang, cukup jalankan: ./start.sh"
echo "=========================================="
