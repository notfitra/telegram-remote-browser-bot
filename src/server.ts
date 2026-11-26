import crypto from 'node:crypto';
import path from 'node:path';
import express, { NextFunction, Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { BrowserManager } from './browserManager';
import {
  deleteBookmark,
  getWatchSession,
  listBookmarks,
} from './db';
import { getSystemStats } from './systemStats';

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
}

interface AuthenticatedRequest extends Request {
  tgUser?: TelegramUser;
}

function verifyTelegramInitData(initData: string, botToken: string): TelegramUser | null {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;

    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash !== hash) return null;

    const userRaw = params.get('user');
    if (!userRaw) return null;
    return JSON.parse(userRaw) as TelegramUser;
  } catch {
    return null;
  }
}

export function createServer(
  botToken: string,
  browserManager: BrowserManager,
  allowedIds: number[]
) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());

  const vncProxy = createProxyMiddleware({
    target: 'http://127.0.0.1:6080',
    changeOrigin: true,
    ws: true,
    pathRewrite: { '^/novnc': '' },
  });

  // Proteksi /novnc: tolak akses langsung dari browser luar tanpa referer sah
  app.use('/novnc', (req, res, next) => {
    if (req.headers.upgrade === 'websocket') {
      return next();
    }
    const referer = req.headers.referer || '';
    const host = req.headers.host || '';
    if (!referer.includes(host)) {
      res.status(403).send('Akses ditolak: Komponen ini hanya dapat dimuat melalui Telegram Mini App.');
      return;
    }
    next();
  }, vncProxy);

  const requireTgAuth = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    const initData = req.header('x-telegram-init-data') || '';
    const user = verifyTelegramInitData(initData, botToken);

    if (!user) {
      res.status(401).json({ error: 'Sesi Telegram Mini App tidak valid' });
      return;
    }

    if (allowedIds.length > 0 && !allowedIds.includes(user.id)) {
      res.status(403).json({ error: 'Akses Telegram ID dibatasi' });
      return;
    }

    req.tgUser = user;
    next();
  };

  app.get('/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.get('/api/system', requireTgAuth, async (_req: AuthenticatedRequest, res) => {
    const system = await getSystemStats(browserManager.getActiveSessionCount());
    res.json({ system });
  });

  app.get('/api/status', requireTgAuth, async (req: AuthenticatedRequest, res) => {
    const tgId = req.tgUser!.id;
    const live = browserManager.getState(tgId);
    const [dbSession, bookmarks, system] = await Promise.all([
      getWatchSession(tgId),
      listBookmarks(tgId),
      getSystemStats(browserManager.getActiveSessionCount()),
    ]);

    res.json({
      live,
      dbSession,
      bookmarks,
      system,
    });
  });

  app.post('/api/navigate', requireTgAuth, async (req: AuthenticatedRequest, res) => {
    const { url, watchInBackground, label } = req.body as {
      url?: string;
      watchInBackground?: boolean;
      label?: string;
    };

    if (!url || !url.trim()) {
      res.status(400).json({ error: 'URL wajib diisi' });
      return;
    }

    try {
      const state = await browserManager.openUrl(req.tgUser!.id, url.trim(), {
        username: req.tgUser!.username,
        watchInBackground: Boolean(watchInBackground),
        label,
      });
      res.json({ ok: true, state });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal membuka URL',
      });
    }
  });

  app.post('/api/twitch/watch', requireTgAuth, async (req: AuthenticatedRequest, res) => {
    const { channel } = req.body as { channel?: string };
    if (!channel || !channel.trim()) {
      res.status(400).json({ error: 'Nama channel Twitch wajib diisi' });
      return;
    }

    try {
      const state = await browserManager.watchTwitchChannel(
        req.tgUser!.id,
        channel,
        req.tgUser!.username
      );
      res.json({ ok: true, state });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal membuka channel Twitch',
      });
    }
  });

  app.post('/api/twitch/token', requireTgAuth, async (req: AuthenticatedRequest, res) => {
    const { token } = req.body as { token?: string };
    if (!token || !token.trim()) {
      res.status(400).json({ error: 'Token login Twitch wajib diisi' });
      return;
    }

    try {
      const state = await browserManager.setTwitchAuthToken(req.tgUser!.id, token.trim());
      res.json({ ok: true, state });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal menyetel auth-token Twitch',
      });
    }
  });

  app.post('/api/stop', requireTgAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const state = await browserManager.stopWatching(req.tgUser!.id);
      res.json({ ok: true, state });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal menghentikan sesi',
      });
    }
  });

  app.post('/api/logout', requireTgAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { includeBookmarks = true } = (req.body || {}) as {
        includeBookmarks?: boolean;
      };
      const result = await browserManager.logoutAndPurge(
        req.tgUser!.id,
        Boolean(includeBookmarks)
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal melakukan logout',
      });
    }
  });

  app.delete('/api/bookmarks', requireTgAuth, async (req: AuthenticatedRequest, res) => {
    const { url } = req.body as { url?: string };
    if (!url) {
      res.status(400).json({ error: 'URL wajib diisi' });
      return;
    }
    await deleteBookmark(req.tgUser!.id, url);
    res.json({ ok: true });
  });

  app.use(express.static(path.join(process.cwd(), 'public')));

  return { app, vncProxy };
}
