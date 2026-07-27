/** Schemes a user may navigate to by typing them. Deliberately short. */
const NAVIGABLE = /^(https?|file|sheaf):\/\//i
const IPV4_HOST = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#]|$)/
const LOCALHOST = /^localhost(:\d+)?([/?#]|$)/i
const DOMAINISH = /^[^\s/?#]+\.[a-z]{2,}(:\d+)?([/?#]|$)/i

/**
 * Omnibox input → a URL to load.
 *
 * Anything not recognised as an address becomes a search. That is also the
 * security boundary: `javascript:` and `data:` are never navigable by typing,
 * they fall through to search — same as Chrome.
 */
export function toUrl(input: string, searchTemplate: string): string {
  const text = input.trim()
  if (!text) return 'about:blank'

  if (NAVIGABLE.test(text)) return text
  if (LOCALHOST.test(text) || IPV4_HOST.test(text)) return `http://${text}`
  if (DOMAINISH.test(text)) return `https://${text}`

  return searchTemplate.replace('%s', encodeURIComponent(text))
}

/** Trims the scheme/trailing slash for display in the omnibox. */
export function prettyUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.protocol === 'sheaf:') return url
    const host = u.host.replace(/^www\./, '')
    const rest = u.pathname === '/' && !u.search && !u.hash ? '' : u.pathname + u.search + u.hash
    return host + rest
  } catch {
    return url
  }
}
