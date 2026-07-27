import type { Suggestion } from '@shared/types'
import { getDb } from '../store/sqlite'
import { getAppSettings } from '../store/repositories/settings'
import { toUrl } from '../tabs/url'

const LOOKS_LIKE_URL = /^([a-z]+:\/\/|localhost|\d{1,3}(\.\d{1,3}){3})|^[^\s/?#]+\.[a-z]{2,}/i

interface HistRow {
  url: string
  title: string | null
  visits: number
  last: number
}

interface BmRow {
  id: string
  url: string
  title: string
}

/**
 * Ranks history by frequency *and* recency together. Frequency alone keeps
 * surfacing something you visited 50 times last year; recency alone loses the
 * site you open every morning.
 */
function scoreHistory(row: HistRow, now: number): number {
  const days = (now - row.last) / 86_400_000
  const recency = 1 / (1 + days)
  return Math.log2(1 + row.visits) * 2 + recency * 6
}

export function suggest(query: string, limit = 8): Suggestion[] {
  const q = query.trim()
  if (!q) return []

  const db = getDb()
  const like = `%${q}%`
  const now = Date.now()
  const out: Suggestion[] = []
  const seen = new Set<string>()

  const push = (s: Suggestion) => {
    const key = s.kind === 'search' ? `search:${s.title}` : s.url
    if (seen.has(key)) return
    seen.add(key)
    out.push(s)
  }

  // 1. If it parses as an address, offer it first — typing a URL and pressing
  //    Enter must never be hijacked by a suggestion.
  if (LOOKS_LIKE_URL.test(q)) {
    const url = toUrl(q, getAppSettings().searchTemplate)
    if (!url.startsWith('http') || url.includes(encodeURIComponent(q))) {
      // toUrl fell through to search — not actually an address.
    } else {
      push({ kind: 'url', title: q, url, score: 100 })
    }
  }

  // 2. Bookmarks — deliberately outrank history: an explicit save beats a visit.
  const bms = db
    .prepare('SELECT id, url, title FROM bookmarks WHERE kind = ? AND (title LIKE ? OR url LIKE ?) LIMIT 20')
    .all('bookmark', like, like) as BmRow[]
  for (const b of bms) {
    if (b.url) push({ kind: 'bookmark', title: b.title || b.url, url: b.url, score: 50 })
  }

  // 3. History, ranked.
  const rows = db
    .prepare(
      `SELECT url, MAX(title) AS title, COUNT(*) AS visits, MAX(visited_at) AS last
       FROM history WHERE url LIKE ? OR title LIKE ?
       GROUP BY url ORDER BY last DESC LIMIT 40`
    )
    .all(like, like) as HistRow[]
  const scored = rows
    .map((r) => ({ r, s: scoreHistory(r, now) }))
    .sort((a, b) => b.s - a.s)
  for (const { r, s } of scored) {
    push({ kind: 'history', title: r.title || r.url, url: r.url, score: s })
  }

  // 4. Always offer the search, always last — it's the fallback, not the answer.
  const searchUrl = getAppSettings().searchTemplate.replace('%s', encodeURIComponent(q))
  const trimmed = out.slice(0, limit - 1)
  trimmed.push({ kind: 'search', title: q, url: searchUrl, score: -1 })
  return trimmed
}
