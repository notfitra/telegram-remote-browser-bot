import { Collection, Db, MongoClient } from 'mongodb';
import { SavedBookmarkDoc, WatchSessionDoc } from './types';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectDb(uri: string): Promise<Db> {
  if (db) return db;

  client = new MongoClient(uri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000,
  });

  await client.connect();
  db = client.db();

  await db.collection<WatchSessionDoc>('watch_sessions').createIndex(
    { telegramId: 1 },
    { unique: true }
  );
  await db.collection<SavedBookmarkDoc>('saved_bookmarks').createIndex(
    { telegramId: 1, url: 1 },
    { unique: true }
  );

  console.log('[MongoDB] Terhubung ke database:', db.databaseName);
  return db;
}

export function getSessionsCollection(): Collection<WatchSessionDoc> {
  if (!db) throw new Error('Database belum terhubung');
  return db.collection<WatchSessionDoc>('watch_sessions');
}

export function getBookmarksCollection(): Collection<SavedBookmarkDoc> {
  if (!db) throw new Error('Database belum terhubung');
  return db.collection<SavedBookmarkDoc>('saved_bookmarks');
}

export async function upsertWatchSession(
  doc: Omit<WatchSessionDoc, '_id' | 'updatedAt'>
): Promise<void> {
  const col = getSessionsCollection();
  await col.updateOne(
    { telegramId: doc.telegramId },
    {
      $set: {
        ...doc,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );
}

export async function updateSessionHeartbeat(
  telegramId: number,
  status: WatchSessionDoc['status'],
  targetUrl: string,
  lastError?: string
): Promise<void> {
  const col = getSessionsCollection();
  await col.updateOne(
    { telegramId },
    {
      $set: {
        status,
        targetUrl,
        lastHeartbeatAt: new Date(),
        updatedAt: new Date(),
        ...(lastError ? { lastError } : { lastError: undefined }),
      },
    }
  );
}

export async function getWatchSession(telegramId: number): Promise<WatchSessionDoc | null> {
  return getSessionsCollection().findOne({ telegramId });
}

export async function getActiveWatchSessions(): Promise<WatchSessionDoc[]> {
  return getSessionsCollection().find({ status: 'watching' }).toArray();
}

export async function deleteUserData(
  telegramId: number,
  includeBookmarks = true
): Promise<{ deletedSessions: number; deletedBookmarks: number }> {
  const sessionRes = await getSessionsCollection().deleteMany({ telegramId });
  let deletedBookmarks = 0;

  if (includeBookmarks) {
    const bookmarkRes = await getBookmarksCollection().deleteMany({ telegramId });
    deletedBookmarks = bookmarkRes.deletedCount;
  }

  return {
    deletedSessions: sessionRes.deletedCount,
    deletedBookmarks,
  };
}

export async function addBookmark(
  telegramId: number,
  label: string,
  url: string,
  platform: 'twitch' | 'custom'
): Promise<void> {
  const col = getBookmarksCollection();
  await col.updateOne(
    { telegramId, url },
    {
      $set: { label, platform },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );
}

export async function listBookmarks(telegramId: number): Promise<SavedBookmarkDoc[]> {
  return getBookmarksCollection()
    .find({ telegramId })
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();
}

export async function deleteBookmark(telegramId: number, url: string): Promise<void> {
  await getBookmarksCollection().deleteOne({ telegramId, url });
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
