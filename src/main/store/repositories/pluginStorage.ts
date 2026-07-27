import { getDb } from '../sqlite'

/**
 * Namespaced key/value store handed to each plugin. Scoped by plugin id so one
 * plugin can never read or clobber another's state.
 */
export function pluginGet<T>(pluginId: string, key: string): T | null {
  const row = getDb()
    .prepare('SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?')
    .get(pluginId, key) as { value: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.value) as T
  } catch {
    return null
  }
}

export function pluginSet(pluginId: string, key: string, value: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO plugin_storage (plugin_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT (plugin_id, key) DO UPDATE SET value = excluded.value`
    )
    .run(pluginId, key, JSON.stringify(value))
}
