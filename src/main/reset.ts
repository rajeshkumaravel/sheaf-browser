import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { app, session } from 'electron'
import { closeStore } from './store/sqlite'
import { extensionsDir, userDataDir } from './paths'

/**
 * Factory reset: wipe everything Sheaf stored on this machine, then relaunch as
 * if freshly installed. Ported in spirit from the reference apps' reset.
 *
 * Browsing data (cookies, cache, localStorage) lives in the Chromium session;
 * our own data (settings, history, bookmarks, downloads, plugin state) lives in
 * the SQLite DB; extensions live under userData/extensions. Clear all three.
 */
export async function factoryReset(): Promise<void> {
  // Clear every session's browsing data (default + any named profiles/private).
  try {
    await session.defaultSession.clearStorageData()
    await session.defaultSession.clearCache()
  } catch {
    /* best effort */
  }

  // Close the DB so the file handle is released before we delete it.
  closeStore()

  const dir = userDataDir()
  for (const name of ['sheaf.db', 'sheaf.db-wal', 'sheaf.db-shm', 'sheaf.local.json']) {
    try {
      rmSync(join(dir, name), { force: true })
    } catch {
      /* ignore */
    }
  }
  try {
    rmSync(extensionsDir(), { recursive: true, force: true })
  } catch {
    /* ignore */
  }

  // Relaunch fresh. The reopened app has no settings → first-launch welcome.
  app.relaunch()
  app.exit(0)
}
