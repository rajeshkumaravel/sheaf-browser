import { randomUUID } from 'node:crypto'
import type { Bookmark } from '@shared/types'
import { getDb } from '../sqlite'

interface Row {
  id: string
  parent_id: string | null
  kind: string
  title: string
  url: string | null
  favicon: string | null
  position: number
  created_at: number
}

const toBookmark = (r: Row): Bookmark => ({
  id: r.id,
  parentId: r.parent_id,
  kind: r.kind as Bookmark['kind'],
  title: r.title,
  url: r.url,
  favicon: r.favicon,
  position: r.position,
  createdAt: r.created_at
})

export function listBookmarks(): Bookmark[] {
  const rows = getDb()
    .prepare('SELECT * FROM bookmarks ORDER BY position ASC, created_at ASC')
    .all() as Row[]
  return rows.map(toBookmark)
}

/** The bookmark for this exact URL, if any — drives the star's filled state. */
export function findBookmarkByUrl(url: string): Bookmark | null {
  const row = getDb().prepare('SELECT * FROM bookmarks WHERE url = ? LIMIT 1').get(url) as
    | Row
    | undefined
  return row ? toBookmark(row) : null
}

export function addBookmark(input: {
  title: string
  url: string | null
  parentId?: string | null
  kind?: Bookmark['kind']
  favicon?: string | null
}): Bookmark {
  const parentId = input.parentId ?? null
  const next = getDb()
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM bookmarks WHERE parent_id IS ?')
    .get(parentId) as { p: number }

  const bm: Bookmark = {
    id: randomUUID(),
    parentId,
    kind: input.kind ?? 'bookmark',
    title: input.title,
    url: input.url,
    favicon: input.favicon ?? null,
    position: next.p,
    createdAt: Date.now()
  }
  getDb()
    .prepare(
      `INSERT INTO bookmarks (id, parent_id, kind, title, url, favicon, position, created_at)
       VALUES (@id, @parentId, @kind, @title, @url, @favicon, @position, @createdAt)`
    )
    .run(bm)
  return bm
}

export function updateBookmark(id: string, patch: Partial<Pick<Bookmark, 'title' | 'url'>>): void {
  if (patch.title !== undefined) {
    getDb().prepare('UPDATE bookmarks SET title = ? WHERE id = ?').run(patch.title, id)
  }
  if (patch.url !== undefined) {
    getDb().prepare('UPDATE bookmarks SET url = ? WHERE id = ?').run(patch.url, id)
  }
}

export function removeBookmark(id: string): void {
  // Folders take their contents with them.
  getDb().prepare('DELETE FROM bookmarks WHERE id = ? OR parent_id = ?').run(id, id)
}
