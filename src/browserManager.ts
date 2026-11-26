import fs from 'node:fs';
import path from 'node:path';
import { BrowserContext, Page, chromium } from 'playwright';
import {
  addBookmark,
  deleteUserData,
  getActiveWatchSessions,
  updateSessionHeartbeat,
  upsertWatchSession,
} from './db';
import { BrowserState } from './types';

interface ManagedSession {
  telegramId: number;
  context: BrowserContext;
  page: Page;
  state: BrowserState;
  heartbeatTimer?: NodeJS.Timeout;
}

export class BrowserManager {
  private sessions = new Map<number, ManagedSession>();
  private profilesDir: string;

  constructor(profilesDir: string) {
    this.profilesDir = profilesDir;
    fs.mkdirSync(this.profilesDir, { recursive: true });
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  private getProfilePath(telegramId: number): string {
    return path.join(this.profilesDir, String(telegramId));
  }

  private async ensureContext(telegramId: number): Promise<ManagedSession> {
    const existing = this.sessions.get(telegramId);
    if (existing) {
      return existing;
    }

    const userDataDir = this.getProfilePath(telegramId);
    fs.mkdirSync(userDataDir, { recursive: true });

    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chrome',
      headless: false,
      viewport: { width: 1280, height: 720 },
      ignoreDefaultArgs: ['--enable-automation'],
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      locale: 'id-ID',
      timezoneId: 'Asia/Jakarta',
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--autoplay-policy=no-user-gesture-required',
        '--mute-audio',
        '--window-position=0,0',
        '--window-size=1280,720',
      ],
    });

    // Anti-bot & Stealth injection agar Twitch mengenali sebagai Google Chrome asli
    await context.addInitScript(() => {
      // 1. Hapus flag navigator.webdriver
      try {
        delete (Object.getPrototypeOf(navigator) as any).webdriver;
      } catch {}
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // 2. Mock window.chrome runtime
      (window as any).chrome = {
        app: { isInstalled: false },
        runtime: {},
        loadTimes: function () {},
        csi: function () {},
      };

      // 3. Mock navigator.plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      // 4. Mock navigator.languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['id-ID', 'id', 'en-US', 'en'],
      });
    });

    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    const managed: ManagedSession = {
      telegramId,
      context,
      page,
      state: {
        running: true,
        currentUrl: page.url() || 'about:blank',
        platform: 'custom',
        status: 'idle',
      },
    };

    context.on('close', () => {
      if (managed.heartbeatTimer) clearInterval(managed.heartbeatTimer);
      this.sessions.delete(telegramId);
    });

    this.sessions.set(telegramId, managed);
    return managed;
  }

  async openUrl(
    telegramId: number,
    url: string,
    options?: {
      username?: string;
      platform?: 'twitch' | 'custom';
      channelName?: string;
      watchInBackground?: boolean;
      label?: string;
    }
  ): Promise<BrowserState> {
    const managed = await this.ensureContext(telegramId);
    const normalizedUrl = url.startsWith('http://') || url.startsWith('https://')
      ? url
      : `https://${url}`;

    const platform =
      options?.platform ??
      (normalizedUrl.includes('twitch.tv') ? 'twitch' : 'custom');

    await managed.page.goto(normalizedUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    const now = new Date();
    managed.state = {
      running: true,
      currentUrl: normalizedUrl,
      platform,
      channelName: options?.channelName,
      status: options?.watchInBackground ? 'watching' : 'idle',
      startedAt: now,
      lastHeartbeatAt: now,
    };

    if (options?.watchInBackground) {
      await upsertWatchSession({
        telegramId,
        username: options.username,
        targetUrl: normalizedUrl,
        platform,
        channelName: options.channelName,
        status: 'watching',
        startedAt: now,
        lastHeartbeatAt: now,
      });

      await addBookmark(
        telegramId,
        options.label || options.channelName || normalizedUrl,
        normalizedUrl,
        platform
      );

      this.startHeartbeat(managed);
    } else {
      this.stopHeartbeat(managed);
      await upsertWatchSession({
        telegramId,
        username: options?.username,
        targetUrl: normalizedUrl,
        platform,
        channelName: options?.channelName,
        status: 'idle',
        startedAt: now,
        lastHeartbeatAt: now,
      });
    }

    return managed.state;
  }

  async setTwitchAuthToken(telegramId: number, token: string): Promise<BrowserState> {
    const session = await this.ensureContext(telegramId);
    const cleanToken = token.trim().replace(/^oauth:/, '');
    await session.context.addCookies([
      {
        name: 'auth-token',
        value: cleanToken,
        domain: '.twitch.tv',
        path: '/',
        secure: true,
        httpOnly: false,
        sameSite: 'Lax',
      },
    ]);
    return await this.openUrl(telegramId, 'https://www.twitch.tv', {
      platform: 'twitch',
      label: 'Twitch (Logged In)',
      watchInBackground: false,
    });
  }

  async watchTwitchChannel(
    telegramId: number,
    channelInput: string,
    username?: string
  ): Promise<BrowserState> {
    const cleanChannel = channelInput
      .trim()
      .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase();

    if (!cleanChannel) {
      throw new Error('Nama channel Twitch tidak valid');
    }

    const twitchUrl = `https://www.twitch.tv/${cleanChannel}`;
    const state = await this.openUrl(telegramId, twitchUrl, {
      username,
      platform: 'twitch',
      channelName: cleanChannel,
      watchInBackground: true,
      label: `Twitch: ${cleanChannel}`,
    });

    this.trySetTwitchLowestQuality(telegramId).catch(() => {});
    return state;
  }

  private async trySetTwitchLowestQuality(telegramId: number): Promise<void> {
    const managed = this.sessions.get(telegramId);
    if (!managed) return;

    try {
      await managed.page.waitForTimeout(5000);
      await managed.page.evaluate(() => {
        localStorage.setItem('video-quality', '{"default":"160p30"}');
      });
    } catch {
      // Abaikan jika halaman belum siap atau storage diblokir
    }
  }

  private startHeartbeat(managed: ManagedSession): void {
    this.stopHeartbeat(managed);

    managed.heartbeatTimer = setInterval(async () => {
      try {
        await managed.page.evaluate(() => {
          const video = document.querySelector('video');
          if (video && video.paused) {
            video.play().catch(() => {});
          }
        });

        const currentUrl = managed.page.url();
        managed.state.currentUrl = currentUrl;
        managed.state.lastHeartbeatAt = new Date();
        managed.state.status = 'watching';

        await updateSessionHeartbeat(
          managed.telegramId,
          'watching',
          currentUrl
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        managed.state.status = 'error';
        managed.state.lastError = msg;
        await updateSessionHeartbeat(
          managed.telegramId,
          'error',
          managed.state.currentUrl,
          msg
        ).catch(() => {});
      }
    }, 45_000);
  }

  private stopHeartbeat(managed: ManagedSession): void {
    if (managed.heartbeatTimer) {
      clearInterval(managed.heartbeatTimer);
      managed.heartbeatTimer = undefined;
    }
  }

  async stopWatching(telegramId: number): Promise<BrowserState> {
    const managed = this.sessions.get(telegramId);
    if (!managed) {
      await updateSessionHeartbeat(telegramId, 'idle', 'about:blank');
      return {
        running: false,
        currentUrl: 'about:blank',
        platform: 'custom',
        status: 'idle',
      };
    }

    this.stopHeartbeat(managed);
    await managed.page.goto('about:blank', { waitUntil: 'domcontentloaded' });
    managed.state.status = 'idle';
    managed.state.currentUrl = 'about:blank';
    managed.state.channelName = undefined;

    await updateSessionHeartbeat(telegramId, 'idle', 'about:blank');
    return managed.state;
  }

  async logoutAndPurge(
    telegramId: number,
    includeBookmarks = true
  ): Promise<{ deletedSessions: number; deletedBookmarks: number }> {
    const managed = this.sessions.get(telegramId);
    if (managed) {
      this.stopHeartbeat(managed);
      await managed.context.close().catch(() => {});
      this.sessions.delete(telegramId);
    }

    const userDataDir = this.getProfilePath(telegramId);
    await fs.promises.rm(userDataDir, { recursive: true, force: true });

    return deleteUserData(telegramId, includeBookmarks);
  }

  getState(telegramId: number): BrowserState {
    const managed = this.sessions.get(telegramId);
    if (!managed) {
      return {
        running: false,
        currentUrl: 'about:blank',
        platform: 'custom',
        status: 'idle',
      };
    }
    return {
      ...managed.state,
      currentUrl: managed.page.url() || managed.state.currentUrl,
    };
  }

  async resumeActiveSessions(): Promise<void> {
    const active = await getActiveWatchSessions();
    if (active.length === 0) return;

    console.log(`[BrowserManager] Melanjutkan ${active.length} sesi aktif dari MongoDB...`);
    for (const session of active) {
      try {
        await this.openUrl(session.telegramId, session.targetUrl, {
          username: session.username,
          platform: session.platform,
          channelName: session.channelName,
          watchInBackground: true,
        });
      } catch (err) {
        console.error(
          `[BrowserManager] Gagal melanjutkan sesi ${session.telegramId}:`,
          err
        );
      }
    }
  }

  async closeAll(): Promise<void> {
    for (const managed of this.sessions.values()) {
      this.stopHeartbeat(managed);
      await managed.context.close().catch(() => {});
    }
    this.sessions.clear();
  }
}
