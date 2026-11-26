import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';

export interface UserDisplayConfig {
  displayNum: number;
  displayStr: string;
  rfbPort: number;
  wsPort: number;
}

interface UserDisplaySession extends UserDisplayConfig {
  telegramId: number;
  xvfbProcess?: ChildProcess;
  vncProcess?: ChildProcess;
  wsProcess?: ChildProcess;
}

export class DisplayManager {
  private sessions = new Map<number, UserDisplaySession>();
  private allowedIds: number[];

  constructor(allowedIds: number[]) {
    this.allowedIds = allowedIds;
  }

  private getSlot(telegramId: number): number {
    const idx = this.allowedIds.indexOf(telegramId);
    return idx >= 0 ? idx : Math.abs(telegramId) % 100;
  }

  getUserDisplayConfig(telegramId: number): UserDisplayConfig {
    const slot = this.getSlot(telegramId);
    const displayNum = 100 + slot; // Display X11 virtual: :100, :101, :102...
    const rfbPort = 5900 + slot;   // Port internal x11vnc: 5900, 5901, 5902...
    const wsPort = 6080 + slot;    // Port internal websockify: 6080, 6081, 6082...
    return {
      displayNum,
      displayStr: `:${displayNum}`,
      rfbPort,
      wsPort,
    };
  }

  async ensureDisplay(telegramId: number): Promise<UserDisplaySession> {
    const existing = this.sessions.get(telegramId);
    const isHealthy =
      existing &&
      existing.xvfbProcess && !existing.xvfbProcess.killed && existing.xvfbProcess.exitCode === null &&
      existing.vncProcess && !existing.vncProcess.killed && existing.vncProcess.exitCode === null &&
      existing.wsProcess && !existing.wsProcess.killed && existing.wsProcess.exitCode === null;

    if (isHealthy) {
      return existing;
    }

    // Jika salah satu proses mati/terputus setelah berjam-jam, bersihkan sisa sebelum restart
    if (existing) {
      this.stopDisplay(telegramId);
    }

    const config = this.getUserDisplayConfig(telegramId);
    const lockFile = `/tmp/.X${config.displayNum}-lock`;
    const socketFile = `/tmp/.X11-unix/X${config.displayNum}`;
    try {
      if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
      if (fs.existsSync(socketFile)) fs.unlinkSync(socketFile);
    } catch {}

    // 1. Jalankan Xvfb virtual monitor independen untuk user ini
    const xvfb = spawn(
      'Xvfb',
      [
        config.displayStr,
        '-screen',
        '0',
        '1280x720x24',
        '-ac',
        '+extension',
        'GLX',
        '+render',
        '-noreset',
      ],
      {
        stdio: 'ignore',
        detached: true,
      }
    );
    xvfb.on('error', (err) => {
      console.error(`[DisplayManager] Xvfb error (${config.displayStr}):`, err.message);
    });
    xvfb.unref();

    // Beri jeda agar socket X11 siap
    await new Promise((r) => setTimeout(r, 600));

    // 2. Jalankan x11vnc independen khusus monitor virtual user ini
    const vnc = spawn(
      'x11vnc',
      [
        '-display',
        config.displayStr,
        '-forever',
        '-shared',
        '-nopw',
        '-rfbport',
        String(config.rfbPort),
        '-quiet',
      ],
      {
        stdio: 'ignore',
        detached: true,
      }
    );
    vnc.on('error', (err) => {
      console.error(`[DisplayManager] x11vnc error (${config.rfbPort}):`, err.message);
    });
    vnc.unref();

    await new Promise((r) => setTimeout(r, 400));

    // 3. Jalankan websockify noVNC independen pada port user ini
    const ws = spawn(
      'websockify',
      [
        '--web=/usr/share/novnc/',
        String(config.wsPort),
        `localhost:${config.rfbPort}`,
      ],
      {
        stdio: 'ignore',
        detached: true,
      }
    );
    ws.on('error', (err) => {
      console.error(`[DisplayManager] websockify error (${config.wsPort}):`, err.message);
    });
    ws.unref();

    await new Promise((r) => setTimeout(r, 300));

    const session: UserDisplaySession = {
      telegramId,
      ...config,
      xvfbProcess: xvfb,
      vncProcess: vnc,
      wsProcess: ws,
    };

    this.sessions.set(telegramId, session);
    console.log(
      `[DisplayManager] Display ${config.displayStr} (VNC:${config.rfbPort}, WS:${config.wsPort}) aktif terisolasi untuk Telegram ID: ${telegramId}`
    );
    return session;
  }

  stopDisplay(telegramId: number): void {
    const s = this.sessions.get(telegramId);
    if (!s) return;

    try { s.wsProcess?.kill(); } catch {}
    try { s.vncProcess?.kill(); } catch {}
    try { s.xvfbProcess?.kill(); } catch {}

    const lockFile = `/tmp/.X${s.displayNum}-lock`;
    const socketFile = `/tmp/.X11-unix/X${s.displayNum}`;
    try {
      if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
      if (fs.existsSync(socketFile)) fs.unlinkSync(socketFile);
    } catch {}

    this.sessions.delete(telegramId);
    console.log(`[DisplayManager] Display ${s.displayStr} dimatikan untuk Telegram ID: ${telegramId}`);
  }

  stopAll(): void {
    for (const id of Array.from(this.sessions.keys())) {
      this.stopDisplay(id);
    }
  }
}
