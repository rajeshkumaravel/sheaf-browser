import { writeFile } from 'node:fs/promises'
import { dialog, ipcMain, nativeTheme } from 'electron'
import type { IpcChannel, IpcChannels, IpcResult } from '@shared/ipc'
import { PUSH_LETTERHEAD, PUSH_SETTINGS } from '@shared/ipc'
import { getState as letterheadGet, setState as letterheadSet } from '@plugins/letterhead/main'
import * as imprint from '@plugins/imprint/main'
import * as mailroom from '@plugins/mailroom/main'
import {
  cancelDownload,
  clearDownloads,
  listDownloads,
  pauseDownload,
  revealDownload
} from './downloads'
import {
  installExtension,
  listExtensions,
  removeExtension,
  setExtensionEnabled
} from './extensions'
import { popupReloadMenu, popupTabContextMenu } from './menus/contextMenu'
import { suggest } from './omnibox/suggest'
import { browserInfo } from './protocols/internal'
import {
  addBookmark,
  findBookmarkByUrl,
  listBookmarks,
  removeBookmark,
  updateBookmark
} from './store/repositories/bookmarks'
import { clearHistory, deleteHistoryEntry, searchHistory } from './store/repositories/history'
import { getAppSettings, setAppSettings } from './store/repositories/settings'
import { factoryReset } from './reset'
import { SheafWindow, allWindows, windowFromWebContents } from './windows/window'

type Handler<K extends IpcChannel> = (
  event: Electron.IpcMainInvokeEvent,
  ...args: IpcChannels[K]['args']
) => IpcChannels[K]['result'] | Promise<IpcChannels[K]['result']>

/** Wraps every handler in the IpcResult envelope so errors cross cleanly. */
function handle<K extends IpcChannel>(channel: K, fn: Handler<K>): void {
  ipcMain.handle(channel, async (event, ...args): Promise<IpcResult<unknown>> => {
    try {
      const data = await fn(event, ...(args as IpcChannels[K]['args']))
      return { ok: true, data }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

/**
 * Reads a favicon into a data URI, from inside the page that owns it (so the
 * request is same-origin and already cached — the user is on that site right
 * now). Returns null on any failure: a missing icon is not worth a request
 * later, and never worth pinging the origin from the bookmarks bar.
 */
async function captureFavicon(wc: Electron.WebContents, iconUrl: string): Promise<string | null> {
  try {
    return (await wc.executeJavaScript(`(async () => {
      try {
        const r = await fetch(${JSON.stringify(iconUrl)}, { cache: 'force-cache' })
        if (!r.ok) return null
        const b = await r.blob()
        if (b.size > 90000) return null   // don't bloat the DB with a huge icon
        return await new Promise((res) => {
          const fr = new FileReader()
          fr.onload = () => res(fr.result)
          fr.onerror = () => res(null)
          fr.readAsDataURL(b)
        })
      } catch { return null }
    })()`)) as string | null
  } catch {
    return null
  }
}

export function registerIpcHandlers(): void {
  handle('settings:get', () => getAppSettings())
  handle('settings:set', (_e, partial) => {
    const next = setAppSettings(partial)
    // Driving nativeTheme makes `prefers-color-scheme` follow the app theme in
    // EVERY already-open page — internal pages and real websites alike — so a
    // toggle re-themes what's on screen instead of only new loads.
    if (partial.theme) nativeTheme.themeSource = next.theme
    // Settings can change from an internal page (sheaf://devices, welcome), not
    // just the chrome. Tell every window, or its cached copy goes stale — e.g.
    // a device added on the devices page wouldn't reach the toolbar dropdown.
    for (const w of allWindows()) {
      if (!w.win.isDestroyed()) w.win.webContents.send(PUSH_SETTINGS, next)
    }
    return next
  })
  handle('browser:info', () => browserInfo())
  handle('app:factoryReset', () => factoryReset())

  // Tab channels resolve the window from the sender, so a renderer can only
  // ever drive its own window's tabs.
  const tabsOf = (e: Electron.IpcMainInvokeEvent) => {
    const w = windowFromWebContents(e.sender)
    if (!w) throw new Error('No window for this request')
    return w.tabs
  }

  handle('tabs:create', (e, url) => tabsOf(e).create(url))
  handle('tabs:close', (e, id) => tabsOf(e).close(id))
  handle('tabs:select', (e, id) => tabsOf(e).select(id))
  handle('tabs:navigate', (e, id, input) => tabsOf(e).navigate(id, input))
  handle('tabs:back', (e, id) => tabsOf(e).back(id))
  handle('tabs:forward', (e, id) => tabsOf(e).forward(id))
  handle('tabs:reload', (e, id, ignoreCache) => tabsOf(e).reload(id, ignoreCache))
  handle('tabs:stop', (e, id) => tabsOf(e).stop(id))
  handle('tabs:devtools', (e, id) => tabsOf(e).toggleDevTools(id))
  handle('tabs:devtoolsSide', (e, side) => tabsOf(e).setDevToolsSide(side))
  handle('devtools:dragStart', (e) => tabsOf(e).splitDragStart())
  handle('devtools:dragMove', (e, x, y) => tabsOf(e).splitDragMove(x, y))
  handle('devtools:dragEnd', (e) => tabsOf(e).splitDragEnd())
  handle('tabs:device', (e, id, deviceId) => tabsOf(e).setDevice(id, deviceId))
  handle('tabs:state', (e) => tabsOf(e).state())

  handle('chrome:height', (e, px) => tabsOf(e).setChromeHeight(px))
  handle('chrome:dockWidth', (e, px) => tabsOf(e).setDockWidth(px))

  handle('window:new', (_e, opts) => {
    new SheafWindow({ private: opts.private })
  })

  handle('tabs:duplicate', (e, id) => tabsOf(e).duplicate(id))
  handle('tabs:contextMenu', (e, id) => {
    const tabs = tabsOf(e)
    popupTabContextMenu(tabs, id, tabs.state().tabs.length)
  })
  handle('tabs:reloadMenu', (e, id) => popupReloadMenu(tabsOf(e), id))
  handle('tabs:zoom', (e, id, direction) => tabsOf(e).zoom(id, direction))

  // ---- omnibox dropdown ----
  const winOf = (e: Electron.IpcMainInvokeEvent) => {
    const w = windowFromWebContents(e.sender)
    if (!w) throw new Error('No window for this request')
    return w
  }

  handle('omnibox:query', (e, query, anchor) => {
    const w = winOf(e)
    const items = suggest(query)
    // selected starts at -1: nothing is chosen until the user chooses it.
    w.omnibox = { query, items, selected: -1 }
    if (items.length === 0) w.overlay.hide()
    else w.overlay.show(w.omnibox, anchor)
  })

  handle('omnibox:move', (e, delta) => {
    const w = winOf(e)
    const n = w.omnibox.items.length
    if (n === 0) return
    const cur = w.omnibox.selected
    // From "nothing selected", Down picks the first and Up picks the last.
    w.omnibox.selected = cur < 0 ? (delta > 0 ? 0 : n - 1) : (cur + delta + n) % n
    w.overlay.push(w.omnibox)
  })

  handle('omnibox:select', (e, index) => {
    const w = winOf(e)
    if (index < 0 || index >= w.omnibox.items.length) return
    w.omnibox.selected = index
    w.overlay.push(w.omnibox)
  })

  handle('omnibox:accept', (e, text, index) => {
    const w = winOf(e)
    w.overlay.hide()
    const tabId = w.tabs.state().activeTabId
    if (!tabId) return

    // `text` wins unless a suggestion was explicitly chosen for *this* text.
    // Suggestions are computed async, so main's state can lag the input by a
    // keystroke — accepting a stale suggestion would navigate somewhere the
    // user never typed. A click passes an explicit index and is always current.
    let target = text
    if (index !== undefined) {
      target = w.omnibox.items[index]?.url ?? text
    } else if (w.omnibox.selected >= 0 && w.omnibox.query === text) {
      target = w.omnibox.items[w.omnibox.selected]?.url ?? text
    }
    w.tabs.navigate(tabId, target)
  })

  handle('omnibox:close', (e) => winOf(e).overlay.hide())

  handle('find:start', (e) => tabsOf(e).startFind())
  handle('find:query', (e, q, forward, findNext) => tabsOf(e).findInPage(q, forward, findNext))
  handle('find:stop', (e) => tabsOf(e).stopFind())

  handle('bookmarks:list', () => listBookmarks())
  handle('bookmarks:add', async (e, input) => {
    // Capture the icon ONCE, now, from the page the user is already looking at
    // — so no new information reaches that origin — and store it as a data URI.
    // Rendering the bookmarks bar then makes zero network requests.
    const w = windowFromWebContents(e.sender)
    let favicon: string | null = null
    const ctx = w?.tabs.activeContext()
    const st = w?.tabs.state()
    const active = st?.tabs.find((t) => t.id === st.activeTabId)
    if (ctx && active?.favicon && active.url === input.url) {
      favicon = await captureFavicon(ctx.wc, active.favicon)
    }
    return addBookmark({ ...input, favicon })
  })
  handle('bookmarks:update', (_e, id, patch) => updateBookmark(id, patch))
  handle('bookmarks:remove', (_e, id) => removeBookmark(id))
  handle('bookmarks:forUrl', (_e, url) => findBookmarkByUrl(url))

  handle('history:search', (_e, query) => searchHistory(query))
  handle('history:delete', (_e, id) => deleteHistoryEntry(id))
  handle('history:clear', () => clearHistory())

  handle('downloads:list', () => listDownloads())
  handle('downloads:cancel', (_e, id) => cancelDownload(id))
  handle('downloads:pause', (_e, id) => pauseDownload(id))
  handle('downloads:reveal', (_e, id) => revealDownload(id))
  handle('downloads:clear', () => clearDownloads())

  handle('letterhead:get', () => letterheadGet())
  handle('letterhead:set', (_e, state) => {
    const next = letterheadSet(state)
    // Rules are global (one row in SQLite), so a change in one window must
    // reach the others — otherwise a second window shows stale rules and a
    // stale badge until restart.
    for (const w of allWindows()) {
      if (!w.win.isDestroyed()) w.win.webContents.send(PUSH_LETTERHEAD, next)
    }
    return next
  })

  // Imprint acts on the requesting window's session + active tab, and every
  // mutation returns a fresh snapshot so the panel never drifts from reality.
  const imprintSnap = (e: Electron.IpcMainInvokeEvent) => {
    const w = winOf(e)
    return imprint.snapshot(w.session, w.tabs.activeContext())
  }
  handle('imprint:snapshot', (e) => imprintSnap(e))
  handle('imprint:setCookie', async (e, cookie) => {
    const ctx = winOf(e).tabs.activeContext()
    if (ctx) await imprint.setCookie(winOf(e).session, ctx.url, cookie)
    return imprintSnap(e)
  })
  handle('imprint:removeCookie', async (e, name) => {
    const ctx = winOf(e).tabs.activeContext()
    if (ctx) await imprint.removeCookie(winOf(e).session, ctx.url, name)
    return imprintSnap(e)
  })
  handle('imprint:setStorage', async (e, area, key, value) => {
    const ctx = winOf(e).tabs.activeContext()
    if (ctx) await imprint.setStorage(ctx.wc, area, key, value)
    return imprintSnap(e)
  })
  handle('imprint:removeStorage', async (e, area, key) => {
    const ctx = winOf(e).tabs.activeContext()
    if (ctx) await imprint.removeStorage(ctx.wc, area, key)
    return imprintSnap(e)
  })
  handle('imprint:clearStorage', async (e, area) => {
    const ctx = winOf(e).tabs.activeContext()
    if (ctx) await imprint.clearStorage(ctx.wc, area)
    return imprintSnap(e)
  })

  const mailroomView = () => ({ state: mailroom.getState(), harCount: mailroom.harCount() })
  handle('mailroom:get', () => mailroomView())
  handle('mailroom:set', (_e, state) => {
    // Starting a recording clears the previous capture, so each session is clean.
    const wasRecording = mailroom.getState().recording
    mailroom.setState(state)
    if (state.recording && !wasRecording) mailroom.clearHar()
    return mailroomView()
  })
  handle('mailroom:clearHar', () => {
    mailroom.clearHar()
    return mailroomView()
  })
  handle('mailroom:exportHar', async (e) => {
    const w = windowFromWebContents(e.sender)
    const opts = {
      title: 'Export HAR',
      defaultPath: `sheaf-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.har`,
      filters: [{ name: 'HAR', extensions: ['har'] }]
    }
    const { canceled, filePath } = w
      ? await dialog.showSaveDialog(w.win, opts)
      : await dialog.showSaveDialog(opts)
    if (canceled || !filePath) return { saved: false }
    await writeFile(filePath, mailroom.buildHar(), 'utf8')
    return { saved: true, path: filePath }
  })

  handle('extensions:list', () => listExtensions())
  handle('extensions:install', async (e) => {
    const w = windowFromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'Add a Chrome extension',
      // A .crx file, or an unpacked extension folder.
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Chrome extension', extensions: ['crx', 'zip'] }]
    }
    const { canceled, filePaths } = w
      ? await dialog.showOpenDialog(w.win, opts)
      : await dialog.showOpenDialog(opts)
    if (canceled || filePaths.length === 0) return { list: listExtensions() }
    try {
      return { list: await installExtension(filePaths[0]) }
    } catch (err) {
      return { list: listExtensions(), error: err instanceof Error ? err.message : String(err) }
    }
  })
  handle('extensions:setEnabled', (_e, id, enabled) => setExtensionEnabled(id, enabled))
  handle('extensions:remove', (_e, id) => removeExtension(id))
}
