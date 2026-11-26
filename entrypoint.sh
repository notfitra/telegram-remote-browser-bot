#!/bin/bash
set -e

# Bersihkan sisa lock display X lama jika container direstart
rm -f /tmp/.X*-lock /tmp/.X11-unix/X* 2>/dev/null || true

# Jalankan aplikasi Node.js (Display Xvfb, x11vnc, dan websockify dikelola on-demand terisolasi per user oleh DisplayManager)
exec node dist/index.js
