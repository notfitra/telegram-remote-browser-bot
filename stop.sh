#!/bin/bash

# Pindah ke direktori tempat script ini berada
cd "$(dirname "$0")"

echo "=========================================="
echo "🛑 Stopping Telegram Remote Browser Bot..."
echo "=========================================="

# Hentikan container lewat compose
if command -v podman-compose >/dev/null 2>&1; then
  podman-compose down
else
  podman stop tg-remote-browser-bot tg-remote-browser-mongo 2>/dev/null || true
  podman rm tg-remote-browser-bot tg-remote-browser-mongo 2>/dev/null || true
fi

echo "✅ Container bot dan database telah dihentikan."
echo "=========================================="
