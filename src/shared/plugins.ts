/** Plugin identity + the contract panels are registered under. */

export interface PluginManifest {
  id: string
  /** Brand name, e.g. "Letterhead". */
  name: string
  /** Function, e.g. "HTTP headers". Shown next to the name so the dock self-teaches. */
  descriptor: string
  version: string
}

// ---- Letterhead ----

export type HeaderTarget = 'request' | 'response'
export type HeaderOp = 'set' | 'append' | 'remove'

export interface HeaderRule {
  id: string
  enabled: boolean
  target: HeaderTarget
  op: HeaderOp
  name: string
  value: string
  /**
   * Matched against the full URL: substring, `*` glob, a bare regex, or an
   * explicit /regex/flags — see matchesUrlFilter. Empty = every URL.
   * Stored as text so the UI round-trips exactly what the user typed.
   */
  urlFilter: string
  comment: string
}

export interface HeaderProfile {
  id: string
  name: string
  enabled: boolean
  rules: HeaderRule[]
}

export interface LetterheadState {
  profiles: HeaderProfile[]
  activeProfileId: string | null
}

export function emptyRule(): HeaderRule {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    target: 'request',
    // Append by default: adding to a header is the common case; Set replaces it.
    op: 'append',
    name: '',
    value: '',
    urlFilter: '',
    comment: ''
  }
}

/**
 * True when an un-delimited filter is written in regular-expression syntax
 * rather than as a plain substring or a `*` glob — e.g. `.*://host:8080/.*`,
 * `api\.example\.com`, `backend-(dev|ppe)\.example\.com`. This lets users paste
 * regexes copied from other tooling without wrapping them in `/.../ `.
 *
 * Deliberately narrow: it must NOT catch ordinary hostnames
 * or globs (`example.com/*`), so it keys off regex-only constructs — a dot
 * quantifier (`.*`/`.+`), a backslash escape (URLs never contain `\`), a
 * character class, a group, a `{n,m}` quantifier, or an anchor/alternation.
 */
function looksLikeRegex(f: string): boolean {
  return (
    /\.[*+]/.test(f) || // dot-quantifier: `.*` or `.+`
    /\\[\w.\\/]/.test(f) || // an escape sequence: `\.`, `\d`, `\/`
    /\[.+\]/.test(f) || // a character class: `[12]`
    /\(.+\)/.test(f) || // a group: `(dev|ppe)`
    /\{\d+(?:,\d*)?\}/.test(f) || // a quantifier: `{2}`, `{1,3}`
    /[|^$]/.test(f) // alternation or an anchor
  )
}

/**
 * URL-filter matching, shared by Letterhead and Mailroom so the two can't drift.
 * Four forms, most specific first:
 *   `/regex/flags` → a regular expression (explicit, honours flags)
 *   bare regex     → an un-delimited regex, detected by syntax: `.*://host/.*`
 *   contains `*`   → a glob: `example.com/*` matches any path, query or fragment
 *   otherwise      → case-insensitive substring
 *
 * `emptyMatches` differs by plugin: an empty Letterhead filter means "every
 * URL", but an empty Mailroom filter must match nothing — never mock the world.
 */
export function matchesUrlFilter(filter: string, url: string, emptyMatches: boolean): boolean {
  const f = filter.trim()
  if (!f) return emptyMatches

  const re = /^\/(.*)\/([gimsuy]*)$/.exec(f)
  if (re) {
    try {
      return new RegExp(re[1], re[2]).test(url)
    } catch {
      // A half-typed regex must not silently match everything.
      return false
    }
  }

  // A bare regular expression.
  // Checked before the glob branch because a glob would escape the `.` in `.*`
  // and never match. Once we've decided it's a regex, an invalid one matches
  // nothing rather than falling through to a broad glob.
  if (looksLikeRegex(f)) {
    try {
      return new RegExp(f, 'i').test(url)
    } catch {
      return false
    }
  }

  if (f.includes('*')) {
    try {
      // Escape every regex metachar except `*`, then `*` → `.*`. Unanchored, so
      // `example.com/*` matches `https://example.com/a/b?c=1`.
      const escaped = f.replace(/[.+?^${}()|[\]\\]/g, '\\$&').split('*').join('.*')
      return new RegExp(escaped, 'i').test(url)
    } catch {
      return false
    }
  }

  return url.toLowerCase().includes(f.toLowerCase())
}

/**
 * Rules that apply to `url` right now — i.e. which rules are *live* for the page
 * you're looking at.
 *
 * Deliberately derived from the URL rather than from "a request just fired":
 * request events are bursty (a page loads, then goes quiet), so a fire-driven
 * indicator flashes once and dies while the rule is still very much in effect.
 * This stays lit for as long as you're on a page the rule touches.
 */
export function liveRuleIds(state: LetterheadState, url: string | null): string[] {
  if (!url) return []
  const p = state.profiles.find((x) => x.id === state.activeProfileId)
  if (!p || !p.enabled) return []
  return p.rules
    .filter((r) => r.enabled && r.name.trim() && matchesUrlFilter(r.urlFilter, url, true))
    .map((r) => r.id)
}

/** Count of rules that will actually fire — what the toolbar badge shows. */
export function activeRuleCount(state: LetterheadState): number {
  const p = state.profiles.find((x) => x.id === state.activeProfileId)
  if (!p || !p.enabled) return 0
  return p.rules.filter((r) => r.enabled && r.name.trim()).length
}

// ---- Mailroom ----

export type MockAction = 'redirect' | 'block' | 'delay' | 'stub'

export interface MockRule {
  id: string
  enabled: boolean
  /** Substring, `*` glob, bare regex or /regex/ against the full URL. */
  urlFilter: string
  action: MockAction
  /** redirect → destination URL */
  redirectTo: string
  /** delay → milliseconds */
  delayMs: number
  /** stub → response body + content type (served as a 200 via a data: URL) */
  stubBody: string
  stubContentType: string
  comment: string
}

export interface MailroomState {
  rules: MockRule[]
  /** Whether network capture (HAR) is currently recording. */
  recording: boolean
}

export function emptyMockRule(): MockRule {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    urlFilter: '',
    action: 'redirect',
    redirectTo: '',
    delayMs: 1000,
    stubBody: '{}',
    stubContentType: 'application/json',
    comment: ''
  }
}

export function activeMockCount(state: MailroomState): number {
  return state.rules.filter((r) => r.enabled && r.urlFilter.trim()).length
}
