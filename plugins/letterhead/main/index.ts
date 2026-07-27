import { randomUUID } from 'node:crypto'
import type { HeaderProfile, HeaderRule, LetterheadState } from '@shared/plugins'
import { emptyRule, matchesUrlFilter } from '@shared/plugins'
import type { HeaderMap, RequestContext } from '../../../src/main/plugin-host'
import { pluginHost } from '../../../src/main/plugin-host'
import { pluginGet, pluginSet } from '../../../src/main/store/repositories/pluginStorage'

const PLUGIN_ID = 'letterhead'
const KEY = 'state'

/**
 * The plugin owns its own first-run state. Handing the UI an empty
 * `{profiles: []}` and expecting it to seed itself just moves the problem into
 * every consumer — and the panel then has to distinguish "not loaded yet" from
 * "loaded and genuinely empty".
 */
function defaultState(): LetterheadState {
  const profile: HeaderProfile = {
    id: randomUUID(),
    name: 'Default',
    enabled: true,
    rules: [emptyRule()]
  }
  return { profiles: [profile], activeProfileId: profile.id }
}

/**
 * Cached so the webRequest hook — which runs on every single request — never
 * touches SQLite. Invalidated on write.
 */
let cache: LetterheadState | null = null

export function getState(): LetterheadState {
  if (!cache) {
    const stored = pluginGet<LetterheadState>(PLUGIN_ID, KEY)
    cache = stored && stored.profiles.length > 0 ? stored : defaultState()
  }
  return cache
}

export function setState(next: LetterheadState): LetterheadState {
  cache = next
  pluginSet(PLUGIN_ID, KEY, next)
  return next
}

/** Regex, glob or substring — see matchesUrlFilter. Empty = every URL. */
const matchesUrl = (filter: string, url: string): boolean => matchesUrlFilter(filter, url, true)

function activeProfile(): HeaderProfile | null {
  const s = getState()
  const p = s.profiles.find((x) => x.id === s.activeProfileId)
  return p && p.enabled ? p : null
}

/** Header names are case-insensitive; find the real key before mutating. */
function findKey(headers: HeaderMap, name: string): string | undefined {
  const lower = name.toLowerCase()
  return Object.keys(headers).find((k) => k.toLowerCase() === lower)
}

/**
 * How an appended value joins the existing one. Request headers must end up a
 * single string (Electron's requestHeaders is Record<string,string>), so the
 * separator matters:
 *   user-agent → space  (RFC 9110: whitespace-separated product tokens)
 *   cookie     → "; "
 *   everything else → ", "  (the standard list-header separator)
 */
function appendSeparator(name: string): string {
  const n = name.toLowerCase()
  if (n === 'user-agent') return ' '
  if (n === 'cookie') return '; '
  return ', '
}

function applyRule(headers: HeaderMap, rule: HeaderRule, target: HeaderRule['target']): HeaderMap {
  const name = rule.name.trim()
  if (!name) return headers
  const existing = findKey(headers, name)

  switch (rule.op) {
    case 'remove':
      if (existing) delete headers[existing]
      return headers

    case 'set':
      if (existing && existing !== name) delete headers[existing]
      headers[name] = rule.value
      return headers

    case 'append': {
      if (!existing) {
        headers[name] = rule.value
        return headers
      }
      const cur = headers[existing]
      if (target === 'response') {
        // Response headers legitimately repeat — Electron takes string[] here.
        headers[existing] = Array.isArray(cur) ? [...cur, rule.value] : [String(cur), rule.value]
      } else {
        // Request headers must stay a single string. Returning an array here is
        // what silently dropped the header entirely.
        const flat = Array.isArray(cur) ? cur.join(appendSeparator(name)) : String(cur)
        headers[existing] = flat ? flat + appendSeparator(name) + rule.value : rule.value
      }
      return headers
    }
  }
}

// ---- "a rule just fired" signal, for the live ripple in the UI ----

let notifyFired: ((ids: string[]) => void) | null = null
const firedIds = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

export function setFireListener(fn: (ids: string[]) => void): void {
  notifyFired = fn
}

/**
 * Called from the webRequest hot path — every request on the page goes through
 * here — so ids are coalesced and flushed on a timer rather than sent per
 * request. A page load would otherwise fire dozens of IPC messages.
 */
function markFired(id: string): void {
  firedIds.add(id)
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    const ids = [...firedIds]
    firedIds.clear()
    flushTimer = null
    if (ids.length) notifyFired?.(ids)
  }, 150)
}

function applyRules(headers: HeaderMap, ctx: RequestContext, target: HeaderRule['target']): HeaderMap {
  const profile = activeProfile()
  if (!profile) return headers
  for (const rule of profile.rules) {
    if (!rule.enabled || rule.target !== target) continue
    if (!rule.name.trim()) continue
    if (!matchesUrl(rule.urlFilter, ctx.url)) continue
    headers = applyRule(headers, rule, target)
    markFired(rule.id)
  }
  return headers
}

/**
 * Registers with the plugin host, never with session.webRequest directly —
 * Electron allows only one listener per event per session, so direct
 * registration would silently clobber every other plugin.
 */
export function register(): void {
  pluginHost.onBeforeSendHeaders((headers, ctx) => applyRules(headers, ctx, 'request'))
  pluginHost.onHeadersReceived((headers, ctx) => applyRules(headers, ctx, 'response'))
}
