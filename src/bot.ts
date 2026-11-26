import { Bot, InlineKeyboard } from 'grammy';
import { BrowserManager } from './browserManager';
import { getWatchSession } from './db';
import { formatUptime, getSystemStats } from './systemStats';

export function createBot(
  token: string,
  webAppUrl: string,
  browserManager: BrowserManager,
  allowedIds: number[]
): Bot {
  const bot = new Bot(token);

  bot.use(async (ctx, next) => {
    if (allowedIds.length > 0 && ctx.from && !allowedIds.includes(ctx.from.id)) {
      await ctx.reply('Akses ditolak. Akun Telegram Anda belum terdaftar di whitelist.');
      return;
    }
    await next();
  });

  bot.command('start', async (ctx) => {
    const keyboard = new InlineKeyboard().webApp(
      'Buka Remote Browser & Twitch',
      webAppUrl
    );

    await ctx.reply(
      [
        '<b>Remote Browser & Twitch Drops Bot</b>',
        '',
        'Gunakan Mini App untuk:',
        '1. Login ke Twitch atau situs web lain langsung di browser server (mendukung 2FA & CAPTCHA).',
        '2. Memilih channel Twitch atau situs lain lalu menutup Mini App — browser server tetap berjalan di background.',
        '',
        'Perintah cepat:',
        '• /watch &lt;channel&gt; — Tonton channel Twitch di background',
        '• /open &lt;url&gt; — Buka situs web bebas di background 24/7',
        '• /token &lt;auth_token&gt; — Login instan Twitch via cookie (bebas blokir)',
        '• /status — Cek status sesi aktif Anda',
        '• /usage — Cek pemakaian RAM &amp; CPU server real-time',
        '• /stop — Hentikan sesi tonton (profil login tetap tersimpan)',
        '• /logout — Logout penuh &amp; hapus profil browser + data di MongoDB',
      ].join('\n'),
      {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      }
    );
  });

  bot.command('watch', async (ctx) => {
    if (!ctx.from) return;
    const channel = ctx.match?.trim();
    if (!channel) {
      await ctx.reply('Contoh penggunaan: <code>/watch shroud</code>', {
        parse_mode: 'HTML',
      });
      return;
    }

    await ctx.reply(`Membuka channel Twitch <b>${channel}</b> di background...`, {
      parse_mode: 'HTML',
    });

    try {
      const state = await browserManager.watchTwitchChannel(
        ctx.from.id,
        channel,
        ctx.from.username
      );
      await ctx.reply(
        `Berhasil! Browser server kini menonton <b>${state.channelName}</b>.\nAnda dapat menutup Telegram dan progres tontonan tetap berjalan.`,
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`Gagal membuka channel: ${msg}`);
    }
  });

  bot.command('token', async (ctx) => {
    if (!ctx.from) return;
    const token = ctx.match?.trim();
    if (!token) {
      await ctx.reply(
        'Format perintah:\n<code>/token &lt;auth-token_twitch&gt;</code>\n\n<i>Contoh: Salin nilai cookie "auth-token" dari twitch.tv di browser Anda lalu kirim ke sini.</i>',
        { parse_mode: 'HTML' }
      );
      return;
    }

    await ctx.reply('Memasang token login Twitch ke browser server...');
    try {
      await browserManager.setTwitchAuthToken(ctx.from.id, token);
      await ctx.reply(
        '✅ <b>Berhasil Login ke Twitch!</b>\nBrowser Anda sekarang sudah masuk ke akun Twitch Anda.',
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`Gagal login via token: ${msg}`);
    }
  });

  bot.command('open', async (ctx) => {
    if (!ctx.from) return;
    const url = ctx.match?.trim();
    if (!url) {
      await ctx.reply('Contoh penggunaan: <code>/open https://kick.com/nama</code>', {
        parse_mode: 'HTML',
      });
      return;
    }

    await ctx.reply(`Membuka <code>${url}</code> di background...`, {
      parse_mode: 'HTML',
    });

    try {
      const state = await browserManager.openUrl(ctx.from.id, url, {
        username: ctx.from.username,
        watchInBackground: true,
      });
      await ctx.reply(
        `Berhasil! Browser server kini menjalankan <code>${state.currentUrl}</code> di background.`,
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`Gagal membuka URL: ${msg}`);
    }
  });

  bot.command('status', async (ctx) => {
    if (!ctx.from) return;
    const live = browserManager.getState(ctx.from.id);
    const dbDoc = await getWatchSession(ctx.from.id);

    const statusText = [
      '<b>Status Browser Server</b>',
      `• Status: <b>${live.status.toUpperCase()}</b>`,
      `• URL Aktif: <code>${live.currentUrl}</code>`,
      live.channelName ? `• Channel: <b>${live.channelName}</b>` : null,
      dbDoc?.lastHeartbeatAt
        ? `• Heartbeat terakhir: ${dbDoc.lastHeartbeatAt.toLocaleString('id-ID')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');

    const keyboard = new InlineKeyboard().webApp('Buka Mini App', webAppUrl);
    await ctx.reply(statusText, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  });

  bot.command(['usage', 'stats'], async (ctx) => {
    const stats = await getSystemStats(browserManager.getActiveSessionCount());
    const msg = [
      '<b>Monitor Resource Server</b>',
      `• CPU: <b>${stats.cpuUsagePercent}%</b> (${stats.cpuCores} core, load 1m: ${stats.loadAvg1m})`,
      `• RAM Terpakai: <b>${stats.memUsedMB} MB / ${stats.memTotalMB} MB</b> (${stats.memUsagePercent}%)`,
      `• RAM Tersisa: <b>${stats.memFreeMB} MB</b>`,
      `• Proses Node.js (RSS): <b>${stats.processRssMB} MB</b>`,
      `• Browser Aktif: <b>${stats.activeBrowserSessions} sesi</b>`,
      `• Uptime Bot: <b>${formatUptime(stats.uptimeSeconds)}</b>`,
    ].join('\n');

    await ctx.reply(msg, { parse_mode: 'HTML' });
  });

  bot.command('stop', async (ctx) => {
    if (!ctx.from) return;
    await browserManager.stopWatching(ctx.from.id);
    await ctx.reply('Sesi tonton dihentikan. Profil login Anda tetap tersimpan di server.');
  });

  bot.command('logout', async (ctx) => {
    if (!ctx.from) return;
    const result = await browserManager.logoutAndPurge(ctx.from.id, true);
    await ctx.reply(
      [
        '<b>Logout berhasil.</b>',
        '• Browser ditutup &amp; cookie/profil login dihapus dari server.',
        `• Data MongoDB dihapus: ${result.deletedSessions} sesi, ${result.deletedBookmarks} bookmark.`,
      ].join('\n'),
      { parse_mode: 'HTML' }
    );
  });

  bot.catch((err) => {
    console.error('[grammY Error]', err);
  });

  return bot;
}
