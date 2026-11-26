import 'dotenv/config';
import http from 'node:http';
import net from 'node:net';
import { DisplayManager } from './displayManager';
import { BrowserManager } from './browserManager';
import { createBot } from './bot';
import { closeDb, connectDb } from './db';
import { createServer, extractTelegramIdFromRequest } from './server';

function getRequiredEnv(name: string): string {
  const val = process.env[name]?.trim();
  if (!val) {
    throw new Error(`Environment variable ${name} wajib diisi.`);
  }
  return val;
}

async function main() {
  const botToken = getRequiredEnv('BOT_TOKEN');
  const mongoUri = getRequiredEnv('MONGODB_URI');
  const webAppUrl = getRequiredEnv('WEBAPP_URL');
  const portStr = getRequiredEnv('PORT');
  const port = Number(portStr);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Environment variable PORT '${portStr}' tidak valid.`);
  }
  const profilesDir = process.env.BROWSER_PROFILES_DIR || '/data/profiles';

  const allowedIds = (process.env.ALLOWED_TELEGRAM_IDS || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (allowedIds.length === 0) {
    throw new Error(
      'FATAL KEAMANAN: ALLOWED_TELEGRAM_IDS wajib diisi di .env! Masukkan Telegram ID Anda untuk mencegah orang asing mengakses browser Anda.'
    );
  }

  await connectDb(mongoUri);

  const displayManager = new DisplayManager(allowedIds);
  const browserManager = new BrowserManager(profilesDir, displayManager);
  await browserManager.resumeActiveSessions();

  const { app, vncProxy } = createServer(botToken, browserManager, displayManager, allowedIds);
  const server = http.createServer(app);

  // Dukung upgrade WebSocket untuk noVNC (/novnc/websockify) terisolasi per Telegram ID
  server.on('upgrade', async (req, clientSocket, head) => {
    if (req.url?.startsWith('/novnc')) {
      const tgId = extractTelegramIdFromRequest(req, botToken, allowedIds);
      if (!tgId) {
        console.warn(`[noVNC WebSocket] Ditolak: Akses tidak sah (${req.url})`);
        clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        clientSocket.destroy();
        return;
      }

      try {
        await displayManager.ensureDisplay(tgId);
        const config = displayManager.getUserDisplayConfig(tgId);

        const targetSocket = net.connect(config.wsPort, '127.0.0.1', () => {
          const rewrittenUrl = req.url?.replace(/^\/novnc/, '') || '/';
          let rawReq = `${req.method} ${rewrittenUrl} HTTP/${req.httpVersion}\r\n`;
          for (let i = 0; i < req.rawHeaders.length; i += 2) {
            rawReq += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
          }
          rawReq += '\r\n';
          targetSocket.write(rawReq);
          if (head && head.length > 0) {
            targetSocket.write(head);
          }
          targetSocket.pipe(clientSocket);
          clientSocket.pipe(targetSocket);
        });

        targetSocket.on('error', (err) => {
          console.error(`[WebSocket Proxy Error] port ${config.wsPort}:`, err.message);
          clientSocket.destroy();
        });
        clientSocket.on('error', () => {
          targetSocket.destroy();
        });
      } catch (err) {
        console.error('[WebSocket Upgrade Error]', err);
        clientSocket.destroy();
      }
    }
  });

  server.listen(port, () => {
    console.log(`[Server] Mini App & API berjalan di port ${port}`);
  });

  const bot = createBot(botToken, webAppUrl, browserManager, allowedIds);
  bot.start({
    onStart: (botInfo) => {
      console.log(`[Bot] @${botInfo.username} aktif (long polling)`);
    },
  });

  const shutdown = async () => {
    console.log('[System] Mematikan layanan...');
    await bot.stop();
    await browserManager.closeAll();
    displayManager.stopAll();
    await closeDb();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[Fatal]', err);
  process.exit(1);
});
