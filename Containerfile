FROM mcr.microsoft.com/playwright:v1.55.1-noble

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Asia/Jakarta
ENV DISPLAY=:99
# Cegah npm install mendownload ulang browser bawaan
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install && npm cache clean --force

# 1. Install Google Chrome resmi (H.264 & AAC codec) untuk streaming lancar
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0 npx playwright install --with-deps chrome \
    && apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# 2. Hapus browser bawaan yang tidak digunakan (Firefox, WebKit, Chromium lama)
# Menghemat sekitar 1.2 GB - 1.5 GB ruang disk
RUN rm -rf /ms-playwright/firefox-* /ms-playwright/webkit-* /ms-playwright/chromium-*

COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY entrypoint.sh ./entrypoint.sh

# 3. Build TypeScript dan pangkas devDependencies (menghemat 100+ MB lagi)
RUN npm run build \
    && npm prune --omit=dev \
    && npm cache clean --force \
    && chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
