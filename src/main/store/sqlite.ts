import { join } from 'node:path'
import Database from 'better-sqlite3'

let db: Database.Database | null = null

export function initStore(userDataPath: string): void {
  db = new Database(join(userDataPath, 'sheaf.db'))
  db.pragma('journal_mode = WAL')
  migrate(db)
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Store not initialised')
  return db
}

export function closeStore(): void {
  db?.close()
  db = null
}

function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS history (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      url      TEXT NOT NULL,
      title    TEXT,
      visited_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS history_visited_at ON history (visited_at DESC);
    CREATE INDEX IF NOT EXISTS history_url ON history (url);

    -- Namespaced per-plugin state. Scoped by plugin_id so plugins can't read
    -- or clobber each other.
    CREATE TABLE IF NOT EXISTS plugin_storage (
      plugin_id TEXT NOT NULL,
      key       TEXT NOT NULL,
      value     TEXT NOT NULL,
      PRIMARY KEY (plugin_id, key)
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id         TEXT PRIMARY KEY,
      parent_id  TEXT,
      kind       TEXT NOT NULL DEFAULT 'bookmark',
      title      TEXT NOT NULL,
      url        TEXT,
      -- data: URI captured at bookmark time; never a remote URL. See
      -- BookmarksBar: rendering must not ping every bookmarked origin.
      favicon    TEXT,
      position   INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS bookmarks_parent ON bookmarks (parent_id, position);
    CREATE INDEX IF NOT EXISTS bookmarks_url ON bookmarks (url);

    CREATE TABLE IF NOT EXISTS downloads (
      id         TEXT PRIMARY KEY,
      url        TEXT NOT NULL,
      filename   TEXT NOT NULL,
      save_path  TEXT NOT NULL,
      state      TEXT NOT NULL,
      received   INTEGER NOT NULL DEFAULT 0,
      total      INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS downloads_started ON downloads (started_at DESC);
  `)
}
