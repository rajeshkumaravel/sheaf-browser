import type { Session } from 'electron'

export interface RequestContext {
  /** Stable per-request id, for correlating events (used by HAR capture). */
  id: number
  url: string
  method: string
  resourceType: string
  /** -1 when the request has no owning tab (service workers, favicons…). */
  webContentsId: number
}

export type HeaderMap = Record<string, string | string[]>

/**
 * A plugin's chance to rewrite headers. Return the (possibly mutated) map.
 * Handlers run in registration order and each sees the previous one's output.
 */
export type HeaderHandler = (headers: HeaderMap, ctx: RequestContext) => HeaderMap

/** Redirect, cancel, or pass through. May be async (that's how delay works). */
export type BeforeRequestAction = { cancel: true } | { redirectURL: string } | undefined
export type BeforeRequestHandler = (
  ctx: RequestContext
) => BeforeRequestAction | Promise<BeforeRequestAction>

export interface CompletedInfo {
  id: number
  url: string
  method: string
  resourceType: string
  statusCode: number
  responseHeaders: Record<string, string[]>
  fromCache: boolean
}
export type CompletedHandler = (info: CompletedInfo) => void

/**
 * Owns the session's webRequest listeners and fans them out to plugins.
 *
 * THIS EXISTS FOR ONE REASON: Electron allows exactly **one** listener per
 * webRequest event per session. `session.webRequest.onBeforeSendHeaders(fn)`
 * replaces any previous listener silently — no error, no warning. If plugins
 * registered directly, the last one to load would win and the rest would
 * mysteriously stop working.
 *
 * So: plugins never touch session.webRequest. They register here.
 */
class PluginHost {
  private readonly beforeSendHeaders: HeaderHandler[] = []
  private readonly headersReceived: HeaderHandler[] = []
  private readonly beforeRequest: BeforeRequestHandler[] = []
  private readonly completed: CompletedHandler[] = []
  private readonly attached = new WeakSet<Session>()

  onBeforeSendHeaders(fn: HeaderHandler): void {
    this.beforeSendHeaders.push(fn)
  }

  onHeadersReceived(fn: HeaderHandler): void {
    this.headersReceived.push(fn)
  }

  /** Blocking: first handler to return an action (redirect/cancel) wins. */
  onBeforeRequest(fn: BeforeRequestHandler): void {
    this.beforeRequest.push(fn)
  }

  /** Informational: fires after each request finishes (used for HAR). */
  onCompleted(fn: CompletedHandler): void {
    this.completed.push(fn)
  }

  /**
   * Wire the host into one session. Every session that can host a tab needs
   * this — including each private window's throwaway session.
   */
  attach(ses: Session): void {
    if (this.attached.has(ses)) return
    this.attached.add(ses)

    ses.webRequest.onBeforeRequest(async (details, callback) => {
      if (this.beforeRequest.length === 0) {
        callback({})
        return
      }
      const ctx = this.ctx(details)
      for (const fn of this.beforeRequest) {
        try {
          const action = await fn(ctx)
          if (action) {
            callback(action)
            return
          }
        } catch {
          // A broken rule must never wedge navigation.
        }
      }
      callback({})
    })

    ses.webRequest.onCompleted((details) => {
      if (this.completed.length === 0) return
      const info: CompletedInfo = {
        id: details.id,
        url: details.url,
        method: details.method,
        resourceType: details.resourceType,
        statusCode: details.statusCode,
        responseHeaders: (details.responseHeaders as Record<string, string[]>) ?? {},
        fromCache: details.fromCache
      }
      for (const fn of this.completed) {
        try {
          fn(info)
        } catch {
          /* ignore */
        }
      }
    })

    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      if (this.beforeSendHeaders.length === 0) {
        callback({ requestHeaders: details.requestHeaders })
        return
      }
      const ctx = this.ctx(details)
      let headers: HeaderMap = { ...details.requestHeaders }
      for (const fn of this.beforeSendHeaders) {
        try {
          headers = fn(headers, ctx)
        } catch {
          // A broken plugin must never break browsing.
        }
      }
      callback({ requestHeaders: headers as Record<string, string> })
    })

    ses.webRequest.onHeadersReceived((details, callback) => {
      if (this.headersReceived.length === 0) {
        callback({ responseHeaders: details.responseHeaders ?? undefined })
        return
      }
      const ctx = this.ctx(details)
      let headers: HeaderMap = { ...(details.responseHeaders ?? {}) }
      for (const fn of this.headersReceived) {
        try {
          headers = fn(headers, ctx)
        } catch {
          /* ignore */
        }
      }
      callback({ responseHeaders: headers as Record<string, string[]> })
    })
  }

  private ctx(details: {
    id: number
    url: string
    method: string
    resourceType: string
    webContentsId?: number
  }): RequestContext {
    return {
      id: details.id,
      url: details.url,
      method: details.method,
      resourceType: details.resourceType,
      webContentsId: details.webContentsId ?? -1
    }
  }
}

export const pluginHost = new PluginHost()
