import type { Session, WebContents } from 'electron'
import type { CookieItem, ImprintSnapshot, StorageArea } from '@shared/types'

/**
 * Imprint reads and writes live browser state — it holds nothing of its own.
 * Cookies come from the window's Session; local/sessionStorage from the active
 * tab's page, read through executeJavaScript.
 *
 * All values are round-tripped through JSON.stringify before being spliced into
 * page script, so a cookie value can never inject code into the page.
 */

function originOf(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin
    return null
  } catch {
    return null
  }
}

async function readStorage(wc: WebContents, area: StorageArea): Promise<Record<string, string>> {
  const store = area === 'local' ? 'localStorage' : 'sessionStorage'
  try {
    const json = (await wc.executeJavaScript(
      `(() => { try {
         const s = window.${store}; const o = {};
         for (let i = 0; i < s.length; i++) { const k = s.key(i); o[k] = s.getItem(k); }
         return JSON.stringify(o);
       } catch { return '{}'; } })()`
    )) as string
    return JSON.parse(json) as Record<string, string>
  } catch {
    return {}
  }
}

export async function snapshot(session: Session, ctx: { url: string; wc: WebContents } | null): Promise<ImprintSnapshot> {
  if (!ctx) return { origin: null, url: '', cookies: [], local: {}, session: {} }
  const origin = originOf(ctx.url)

  const raw = origin ? await session.cookies.get({ url: ctx.url }) : []
  const cookies: CookieItem[] = raw.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain ?? '',
    path: c.path ?? '/',
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
    expirationDate: c.expirationDate ? Math.round(c.expirationDate) : null,
    sameSite: c.sameSite ?? 'unspecified'
  }))

  const [local, sessionStore] = origin
    ? await Promise.all([readStorage(ctx.wc, 'local'), readStorage(ctx.wc, 'session')])
    : [{}, {}]

  return { origin, url: ctx.url, cookies, local, session: sessionStore }
}

export async function setCookie(session: Session, url: string, cookie: Partial<CookieItem> & { name: string; value: string }): Promise<void> {
  await session.cookies.set({
    url,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    expirationDate: cookie.expirationDate ?? undefined,
    sameSite: cookie.sameSite
  })
}

export async function removeCookie(session: Session, url: string, name: string): Promise<void> {
  await session.cookies.remove(url, name)
}

export async function setStorage(wc: WebContents, area: StorageArea, key: string, value: string): Promise<void> {
  const store = area === 'local' ? 'localStorage' : 'sessionStorage'
  // JSON.stringify makes both args safe JS string literals — no injection.
  await wc.executeJavaScript(`window.${store}.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`)
}

export async function removeStorage(wc: WebContents, area: StorageArea, key: string): Promise<void> {
  const store = area === 'local' ? 'localStorage' : 'sessionStorage'
  await wc.executeJavaScript(`window.${store}.removeItem(${JSON.stringify(key)})`)
}

export async function clearStorage(wc: WebContents, area: StorageArea): Promise<void> {
  const store = area === 'local' ? 'localStorage' : 'sessionStorage'
  await wc.executeJavaScript(`window.${store}.clear()`)
}
