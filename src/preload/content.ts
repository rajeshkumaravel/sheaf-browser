/**
 * Preload for web content views.
 *
 * SECURITY: this runs alongside untrusted pages. It must never expose the
 * chrome IPC surface, Node, or anything a page could pivot through. First-party
 * content-script plugins are imported here and run in this isolated world —
 * they get DOM access but nothing privileged.
 */
import { contextBridge, ipcRenderer } from 'electron'
import { initFolio } from '@plugins/folio/content/inject'

// Folio: replaces JSON documents with an interactive tree. No-op on everything else.
initFolio()

/**
 * Internal `sheaf://` pages (extensions manager, and future settings pages) need
 * IPC. Expose a NARROW, allow-listed invoke — and only when this document is a
 * sheaf:// page. The preload re-runs per document, so an untrusted page (or an
 * iframe within an internal page) never sees this. No general channel is
 * reachable; only the ones listed here.
 */
if (location.protocol === 'sheaf:') {
  const ALLOWED = new Set([
    'extensions:list',
    'extensions:install',
    'extensions:setEnabled',
    'extensions:remove',
    // Home / welcome / help / devices pages: read + set settings, reset.
    'settings:get',
    'settings:set',
    'browser:info',
    'app:factoryReset'
  ])
  contextBridge.exposeInMainWorld('sheafInternal', {
    invoke: async (channel: string, ...args: unknown[]) => {
      if (!ALLOWED.has(channel)) throw new Error(`channel not allowed: ${channel}`)
      const result = (await ipcRenderer.invoke(channel, ...args)) as
        | { ok: true; data: unknown }
        | { ok: false; error: string }
      if (!result.ok) throw new Error(result.error)
      return result.data
    }
  })
}
