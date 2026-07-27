import type { AppSettings, ThemeMode } from '@shared/types'
import { DEFAULT_HOME, DEFAULT_SEARCH } from '@shared/types'
import type { DevicePreset } from '@shared/devices'
import { setCustomDevices } from '@shared/devices'
import { getDb } from '../sqlite'

const THEMES: ThemeMode[] = ['dark', 'light', 'system']

function get(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row ? row.value : null
}

function set(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
    )
    .run(key, value)
}

export function getAppSettings(): AppSettings {
  const theme = get('theme') as ThemeMode | null
  return {
    theme: theme && THEMES.includes(theme) ? theme : 'system',
    userName: get('userName') || null,
    onboarded: get('onboarded') === '1',
    homePage: get('homePage') || DEFAULT_HOME,
    searchTemplate: get('searchTemplate') || DEFAULT_SEARCH,
    customDevices: readCustomDevices()
  }
}

function readCustomDevices(): DevicePreset[] {
  try {
    const raw = get('customDevices')
    return raw ? (JSON.parse(raw) as DevicePreset[]) : []
  } catch {
    return []
  }
}

export function setAppSettings(partial: Partial<AppSettings>): AppSettings {
  if (partial.theme) set('theme', partial.theme)
  if (partial.userName !== undefined) set('userName', partial.userName ?? '')
  if (partial.onboarded !== undefined) set('onboarded', partial.onboarded ? '1' : '0')
  if (partial.homePage) set('homePage', partial.homePage)
  if (partial.searchTemplate) set('searchTemplate', partial.searchTemplate)
  if (partial.customDevices) set('customDevices', JSON.stringify(partial.customDevices))
  const next = getAppSettings()
  // Keep the resolver in sync so a custom id emulates instead of falling back.
  setCustomDevices(next.customDevices)
  return next
}

export function recordVisit(url: string, title: string | null): void {
  // Internal pages aren't browsing history.
  if (url.startsWith('sheaf://') || url === 'about:blank') return
  getDb()
    .prepare('INSERT INTO history (url, title, visited_at) VALUES (?, ?, ?)')
    .run(url, title, Date.now())
}
