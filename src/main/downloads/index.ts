import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { extname, join, dirname, basename } from 'node:path'
import type { Session } from 'electron'
import { app, shell } from 'electron'
import type { DownloadItem, DownloadState } from '@shared/types'
import { getDb } from '../store/sqlite'

/** `report.pdf` → `report (1).pdf` when taken, like every browser. */
function uniquePath(target: string): string {
  if (!existsSync(target)) return target
  const dir = dirname(target)
  const ext = extname(target)
  const stem = basename(target, ext)
  for (let i = 1; i < 1000; i++) {
    const candidate = join(dir, `${stem} (${i})${ext}`)
    if (!existsSync(candidate)) return candidate
  }
  return target
}

interface Row {
  id: string
  url: string
  filename: string
  save_path: string
  state: string
  received: number
  total: number
  started_at: number
}

const toItem = (r: Row): DownloadItem => ({
  id: r.id,
  url: r.url,
  filename: r.filename,
  savePath: r.save_path,
  state: r.state as DownloadState,
  receivedBytes: r.received,
  totalBytes: r.total,
  startedAt: r.started_at
})

/** Live handles, so pause/cancel can reach the in-flight Electron item. */
const live = new Map<string, Electron.DownloadItem>()

const attached = new WeakSet<Session>()

export function attachDownloads(ses: Session, isPrivate: boolean, onChange: () => void): void {
  if (attached.has(ses)) return
  attached.add(ses)

  ses.on('will-download', (_event, item) => {
    const id = randomUUID()
    live.set(id, item)

    // Save to the OS Downloads folder without prompting — Chrome's default.
    // (Without setSavePath, Electron opens a modal save dialog every time.)
    // Never clobber: uniquify the name the way browsers do.
    item.setSavePath(uniquePath(join(app.getPath('downloads'), item.getFilename())))

    const record = () => {
      // Private downloads leave no trace on disk, same as history.
      if (isPrivate) return
      getDb()
        .prepare(
          `INSERT INTO downloads (id, url, filename, save_path, state, received, total, started_at)
           VALUES (@id, @url, @filename, @save_path, @state, @received, @total, @started_at)
           ON CONFLICT (id) DO UPDATE SET
             state = excluded.state, received = excluded.received,
             total = excluded.total, save_path = excluded.save_path`
        )
        .run({
          id,
          url: item.getURL(),
          filename: item.getFilename(),
          save_path: item.getSavePath(),
          state: item.isPaused() ? 'paused' : item.getState(),
          received: item.getReceivedBytes(),
          total: item.getTotalBytes(),
          started_at: Date.now()
        })
    }

    record()
    onChange()

    item.on('updated', () => {
      record()
      onChange()
    })

    item.once('done', (_e, state) => {
      live.delete(id)
      if (!isPrivate) {
        getDb()
          .prepare('UPDATE downloads SET state = ?, received = ?, save_path = ? WHERE id = ?')
          .run(state, item.getReceivedBytes(), item.getSavePath(), id)
      }
      onChange()
    })
  })
}

export function listDownloads(limit = 100): DownloadItem[] {
  const rows = getDb()
    .prepare('SELECT * FROM downloads ORDER BY started_at DESC LIMIT ?')
    .all(limit) as Row[]
  return rows.map(toItem)
}

export function cancelDownload(id: string): void {
  live.get(id)?.cancel()
}

export function pauseDownload(id: string): void {
  const item = live.get(id)
  if (!item) return
  item.isPaused() ? item.resume() : item.pause()
}

export function revealDownload(id: string): void {
  const row = getDb().prepare('SELECT save_path FROM downloads WHERE id = ?').get(id) as
    | { save_path: string }
    | undefined
  if (row?.save_path) shell.showItemInFolder(row.save_path)
}

export function clearDownloads(): void {
  getDb().prepare("DELETE FROM downloads WHERE state != 'progressing'").run()
}
