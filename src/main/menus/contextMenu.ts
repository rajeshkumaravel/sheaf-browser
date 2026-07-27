import { Menu, MenuItem, clipboard, shell } from 'electron'
import type { WebContents } from 'electron'
import type { TabManager } from '../tabs/manager'

/**
 * Page context menu. Built per-invocation from the click context, the way every
 * browser does it — a static menu would offer "Copy link" on a paragraph.
 */
export function attachPageContextMenu(wc: WebContents, tabs: TabManager, tabId: string): void {
  wc.on('context-menu', (_event, params) => {
    const menu = new Menu()
    const add = (opts: Electron.MenuItemConstructorOptions) => menu.append(new MenuItem(opts))

    if (params.linkURL) {
      add({ label: 'Open link in new tab', click: () => tabs.create(params.linkURL) })
      add({
        label: 'Open link in default browser',
        click: () => void shell.openExternal(params.linkURL)
      })
      add({ label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) })
      add({ type: 'separator' })
    }

    if (params.mediaType === 'image' && params.srcURL) {
      add({ label: 'Open image in new tab', click: () => tabs.create(params.srcURL) })
      add({ label: 'Copy image address', click: () => clipboard.writeText(params.srcURL) })
      add({ label: 'Save image as…', click: () => wc.downloadURL(params.srcURL) })
      add({ type: 'separator' })
    }

    if (params.isEditable) {
      add({ role: 'undo' })
      add({ role: 'redo' })
      add({ type: 'separator' })
      add({ role: 'cut' })
      add({ role: 'copy' })
      add({ role: 'paste' })
      add({ role: 'selectAll' })
      add({ type: 'separator' })
    } else if (params.selectionText) {
      add({ role: 'copy' })
      add({
        label: `Search for "${truncate(params.selectionText)}"`,
        click: () => tabs.create(params.selectionText)
      })
      add({ type: 'separator' })
    }

    if (!params.linkURL && !params.isEditable && !params.selectionText) {
      add({ label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => tabs.back(tabId) })
      add({
        label: 'Forward',
        enabled: wc.navigationHistory.canGoForward(),
        click: () => tabs.forward(tabId)
      })
      add({ label: 'Reload', click: () => tabs.reload(tabId) })
      add({ type: 'separator' })
    }

    add({
      label: 'Inspect element',
      click: () => wc.inspectElement(params.x, params.y)
    })

    menu.popup()
  })
}

/** Tab strip context menu. Popped from main so it can overlay the native views. */
/**
 * Reload-button context menu — Chrome's three-way. Accelerators mirror the View
 * menu's Reload / Force Reload (display-only here); the empty-cache variant is
 * menu-only, so there's no accelerator to show.
 */
export function popupReloadMenu(tabs: TabManager, tabId: string): void {
  const menu = Menu.buildFromTemplate([
    { label: 'Normal Reload', accelerator: 'CmdOrCtrl+R', click: () => tabs.reload(tabId) },
    { label: 'Hard Reload', accelerator: 'CmdOrCtrl+Shift+R', click: () => tabs.reload(tabId, true) },
    { label: 'Empty Cache and Hard Reload', click: () => void tabs.emptyCacheAndReload(tabId) }
  ])
  menu.popup()
}

export function popupTabContextMenu(tabs: TabManager, tabId: string, tabCount: number): void {
  const menu = Menu.buildFromTemplate([
    { label: 'Reload', click: () => tabs.reload(tabId) },
    { label: 'Duplicate', click: () => tabs.duplicate(tabId) },
    { type: 'separator' },
    { label: 'Close tab', click: () => tabs.close(tabId) },
    {
      label: 'Close other tabs',
      enabled: tabCount > 1,
      click: () => tabs.closeOthers(tabId)
    }
  ])
  menu.popup()
}

function truncate(s: string, n = 24): string {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.length > n ? `${t.slice(0, n)}…` : t
}
