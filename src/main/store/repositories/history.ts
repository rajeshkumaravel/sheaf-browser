import type { HistoryEntry } from '@shared/types'
import { getDb } from '../sqlite'

interface Row {
  id: number
  url: string
  title: string | null
  visited_at: number
}

const toEntry = (r: Row): HistoryEntry => ({
  id: r.id,
  url: r.url,
  title: r.title,
  visitedAt: r.visited_at
})

/**
 * Most recent first, one row per URL (the newest visit wins) so the list isn't
 * dominated by a page someone reloaded twenty times.
 */
export function searchHistory(query: string, limit = 200): HistoryEntry[] {
  const db = getDb()
  const q = `%${query.trim()}%`
  const rows = (
    query.trim()
      ? db
          .prepare(
            `SELECT id, url, title, MAX(visited_at) AS visited_at FROM history
             WHERE url LIKE ? OR title LIKE ?
             GROUP BY url ORDER BY visited_at DESC LIMIT ?`
          )
          .all(q, q, limit)
      : db
          .prepare(
            `SELECT id, url, title, MAX(visited_at) AS visited_at FROM history
             GROUP BY url ORDER BY visited_at DESC LIMIT ?`
          )
          .all(limit)
  ) as Row[]
  return rows.map(toEntry)
}

export function deleteHistoryEntry(id: number): void {
  getDb().prepare('DELETE FROM history WHERE id = ?').run(id)
}

export function clearHistory(): void {
  getDb().prepare('DELETE FROM history').run()
}
