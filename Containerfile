FROM mcr.microsoft.com/playwright:v1.55.1-noble

ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:99
# Cegah npm install mendownload ulang browser (hemat 1 GB+ disk)
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

COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY entrypoint.sh ./entrypoint.sh

RUN npm run build && chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
