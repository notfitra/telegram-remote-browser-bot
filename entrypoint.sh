#!/bin/bash
set -e

rm -f /tmp/.X99-lock

# 1. Jalankan virtual display Xvfb
Xvfb :99 -screen 0 1280x720x24 -ac +extension GLX +render -noreset &
sleep 1

# 2. Jalankan window manager jika terinstall
if command -v fluxbox >/dev/null 2>&1; then
  fluxbox &
fi

# 3. Jalankan x11vnc pada display :99
x11vnc -display :99 -forever -shared -nopw -rfbport 5900 -quiet &

# 4. Jalankan websockify + noVNC di port 6080 (di-proxy oleh Express ke /novnc)
websockify --web=/usr/share/novnc/ 6080 localhost:5900 &

# 5. Jalankan aplikasi Node.js (grammY + Express + Playwright)
exec node dist/index.js
