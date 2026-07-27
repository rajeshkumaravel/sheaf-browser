import type { Session } from 'electron'
import type { MailroomState, MockRule } from '@shared/plugins'
import { matchesUrlFilter } from '@shared/plugins'
import type { BeforeRequestAction, CompletedInfo, RequestContext } from '../../../src/main/plugin-host'
import { pluginHost } from '../../../src/main/plugin-host'
import { pluginGet, pluginSet } from '../../../src/main/store/repositories/pluginStorage'

const PLUGIN_ID = 'mailroom'
const KEY = 'state'

const DEFAULT: MailroomState = { rules: [], recording: false }

/** Cached: the onBeforeRequest hook runs on every request; never hit SQLite there. */
let cache: MailroomState | null = null

export function getState(): MailroomState {
  if (!cache) cache = pluginGet<MailroomState>(PLUGIN_ID, KEY) ?? DEFAULT
  return cache
}

export function setState(next: MailroomState): MailroomState {
  cache = next
  pluginSet(PLUGIN_ID, KEY, next)
  return next
}

/** Regex, glob or substring. Empty matches nothing — never mock everything. */
const matchesUrl = (filter: string, url: string): boolean => matchesUrlFilter(filter, url, false)

function firstMatch(url: string): MockRule | null {
  for (const r of getState().rules) {
    if (r.enabled && matchesUrl(r.urlFilter, url)) return r
  }
  return null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function evaluate(ctx: RequestContext): Promise<BeforeRequestAction> {
  const rule = firstMatch(ctx.url)
  if (!rule) return undefined
  switch (rule.action) {
    case 'block':
      return { cancel: true }
    case 'redirect':
      return rule.redirectTo.trim() ? { redirectURL: rule.redirectTo.trim() } : undefined
    case 'stub':
      // Redirect to our own scheme rather than a data: URL — Chromium blocks
      // top-level navigation to data: URLs, and won't let fetch follow a
      // redirect into one. A registered standard scheme has neither limit.
      return { redirectURL: `sheaf-stub://s/${rule.id}` }
    case 'delay':
      await sleep(Math.max(0, rule.delayMs))
      return undefined // delayed, then continues normally
  }
}

/**
 * Serves stub responses. Registered per session (like sheaf://), because the
 * `protocol` module only configures the default session and tabs run in named
 * partitions.
 */
export function registerStubProtocol(ses: Session): void {
  if (ses.protocol.isProtocolHandled('sheaf-stub')) return
  ses.protocol.handle('sheaf-stub', (request) => {
    const id = new URL(request.url).pathname.replace(/^\//, '')
    const rule = getState().rules.find((r) => r.id === id)
    if (!rule) return new Response('stub not found', { status: 404 })
    return new Response(rule.stubBody, {
      status: 200,
      headers: {
        'content-type': rule.stubContentType || 'application/json',
        'access-control-allow-origin': '*'
      }
    })
  })
}

// ---- HAR capture ----

interface HarEntry {
  startedDateTime: string
  time: number
  request: { method: string; url: string; headers: { name: string; value: string }[] }
  response: { status: number; headers: { name: string; value: string }[]; _fromCache: boolean }
  _resourceType: string
}

const pending = new Map<number, { start: number; method: string; url: string; headers: HarEntry['request']['headers'] }>()
let entries: HarEntry[] = []

function toHeaderList(h: Record<string, string | string[]>): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = []
  for (const [name, v] of Object.entries(h)) {
    for (const value of Array.isArray(v) ? v : [v]) out.push({ name, value: String(value) })
  }
  return out
}

function onSendHeaders(headers: Record<string, string | string[]>, ctx: RequestContext) {
  if (!getState().recording) return headers
  pending.set(ctx.id, { start: Date.now(), method: ctx.method, url: ctx.url, headers: toHeaderList(headers) })
  return headers
}

function onCompleted(info: CompletedInfo) {
  if (!getState().recording) return
  const p = pending.get(info.id)
  pending.delete(info.id)
  const start = p?.start ?? Date.now()
  entries.push({
    startedDateTime: new Date(start).toISOString(),
    time: Date.now() - start,
    request: { method: info.method, url: info.url, headers: p?.headers ?? [] },
    response: { status: info.statusCode, headers: toHeaderList(info.responseHeaders), _fromCache: info.fromCache },
    _resourceType: info.resourceType
  })
}

export function harCount(): number {
  return entries.length
}

export function clearHar(): void {
  entries = []
  pending.clear()
}

/** A spec-shaped HAR 1.2 log, ready to write to disk. */
export function buildHar(): string {
  return JSON.stringify(
    {
      log: {
        version: '1.2',
        creator: { name: 'Sheaf Mailroom', version: '0.1.0' },
        entries: entries.map((e) => ({
          startedDateTime: e.startedDateTime,
          time: e.time,
          request: { method: e.request.method, url: e.request.url, headers: e.request.headers, queryString: [], cookies: [], headersSize: -1, bodySize: -1, httpVersion: 'HTTP/1.1' },
          response: { status: e.response.status, statusText: '', headers: e.response.headers, cookies: [], content: { size: -1, mimeType: '' }, redirectURL: '', headersSize: -1, bodySize: -1, httpVersion: 'HTTP/1.1' },
          cache: {},
          timings: { send: 0, wait: e.time, receive: 0 },
          _resourceType: e._resourceType
        }))
      }
    },
    null,
    2
  )
}

/** Called once at startup, before any window exists. */
export function register(): void {
  pluginHost.onBeforeRequest(evaluate)
  pluginHost.onBeforeSendHeaders(onSendHeaders)
  pluginHost.onCompleted(onCompleted)
}
