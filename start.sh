#!/bin/bash
set -e

# Pindah ke direktori tempat script ini berada
cd "$(dirname "$0")"

echo "=========================================="
echo "🚀 Starting Telegram Remote Browser Bot..."
echo "=========================================="

if [ ! -f .env ]; then
  echo "⚠️  File .env tidak ditemukan! Silakan salin dari .env.example terlebih dahulu:"
  echo "    cp .env.example .env"
  exit 1
fi

# 1. Pull image terbaru dari Docker Hub
echo "⬇️  Pulling image terbaru dari Docker Hub..."
podman-compose pull

# 2. Nyalakan container di background
echo "▶️  Menjalankan container..."
podman-compose up -d

echo ""
echo "=========================================="
echo "✅ Bot & Database berhasil dinyalakan!"
echo "=========================================="
podman ps --filter "name=tg-remote-browser"

echo ""
echo "💡 Untuk melihat live log, jalankan:"
echo "   podman logs -f tg-remote-browser-bot"
echo "=========================================="
