export interface WatchSessionDoc {
  _id?: string;
  telegramId: number;
  username?: string;
  targetUrl: string;
  platform: 'twitch' | 'custom';
  channelName?: string;
  status: 'watching' | 'idle' | 'error';
  lastHeartbeatAt: Date;
  startedAt: Date;
  updatedAt: Date;
  lastError?: string;
}

export interface SavedBookmarkDoc {
  _id?: string;
  telegramId: number;
  label: string;
  url: string;
  platform: 'twitch' | 'custom';
  createdAt: Date;
}

export interface BrowserState {
  running: boolean;
  currentUrl: string;
  platform: 'twitch' | 'custom';
  channelName?: string;
  status: 'watching' | 'idle' | 'error';
  startedAt?: Date;
  lastHeartbeatAt?: Date;
  lastError?: string;
}
