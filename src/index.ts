import 'dotenv/config';
import http from 'node:http';
import { BrowserManager } from './browserManager';
import { createBot } from './bot';
import { closeDb, connectDb } from './db';
import { createServer } from './server';

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

  await connectDb(mongoUri);

  const browserManager = new BrowserManager(profilesDir);
  await browserManager.resumeActiveSessions();

  const { app, vncProxy } = createServer(botToken, browserManager, allowedIds);
  const server = http.createServer(app);

  // Dukung upgrade WebSocket untuk noVNC (/novnc/websockify)
  server.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/novnc')) {
      (vncProxy.upgrade as any)(req, socket, head);
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
