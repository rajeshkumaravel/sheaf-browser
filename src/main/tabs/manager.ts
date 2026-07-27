import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { BrowserWindow, Session } from 'electron'
import { WebContentsView } from 'electron'
import type { DevToolsSide, FindState, TabState, WindowState } from '@shared/types'
import { findDevice } from '@shared/devices'
import { attachPageContextMenu } from '../menus/contextMenu'
import { getAppSettings, recordVisit } from '../store/repositories/settings'
import { prettyUrl, toUrl } from './url'

interface Tab {
  id: string
  view: WebContentsView
  title: string
  favicon: string | null
  error: string | null
  /** DevTools host view, lazily created when first opened. */
  devtools?: WebContentsView
  devtoolsOpen: boolean
  /** Active device-simulation preset id, or null. */
  deviceId: string | null
}

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

/**
 * Owns one WebContentsView per tab and composites them into the window.
 *
 * Layering note: these are native views stacked *above* the chrome renderer,
 * so they ignore DOM z-index. Everything below `chromeHeight` belongs to the
 * page; anything the chrome UI needs to draw over the page (menus, omnibox
 * suggestions) cannot simply be a DOM element — see docs/overlay.md.
 */
export class TabManager {
  private readonly tabs = new Map<string, Tab>()
  private order: string[] = []
  private activeId: string | null = null
  private chromeHeight = 76
  private dockWidth = 0
  private disposed = false
  private find: FindState | null = null
  private devtoolsSide: DevToolsSide = 'bottom'
  /** Fraction of the page area the docked DevTools occupy. User-draggable. */
  private devtoolsFraction = 0.45
  /** The draggable divider; only exists while DevTools are docked. */
  private splitter: WebContentsView | null = null
  private splitterAttached = false
  private draggingSplit = false

  constructor(
    private readonly win: BrowserWindow,
    private readonly session: Session,
    private readonly isPrivate: boolean
  ) {
    this.win.on('resize', () => this.layout())
  }

  // ---- lifecycle ----

  create(input?: string): string {
    const settings = getAppSettings()
    const id = randomUUID()
    const view = new WebContentsView({
      webPreferences: {
        session: this.session,
        preload: join(__dirname, '../preload/content.js'),
        // Web content is hostile by default. None of this is negotiable.
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false
      }
    })

    const tab: Tab = {
      id,
      view,
      title: 'New tab',
      favicon: null,
      error: null,
      devtoolsOpen: false,
      deviceId: null
    }
    this.tabs.set(id, tab)
    this.order.push(id)
    this.win.contentView.addChildView(view)
    this.wire(tab)
    this.select(id)

    const target = input ? toUrl(input, settings.searchTemplate) : settings.homePage
    void view.webContents.loadURL(target).catch(() => {
      /* surfaced via did-fail-load */
    })
    return id
  }

  close(id: string): void {
    const tab = this.tabs.get(id)
    if (!tab) return

    // The tab's DevTools host is a sibling view — it must go with the tab.
    this.closeDevToolsFor(tab)

    this.tabs.delete(id)
    this.order = this.order.filter((t) => t !== id)
    this.win.contentView.removeChildView(tab.view)
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()

    if (this.activeId === id) {
      this.activeId = null
      const next = this.order[this.order.length - 1]
      if (next) this.select(next)
    }
    // Last tab closed = window closed, same as every other browser.
    if (this.order.length === 0) {
      this.win.close()
      return
    }
    this.emit()
  }

  select(id: string): void {
    if (!this.tabs.has(id)) return
    this.activeId = id
    this.layout()
    this.emit()
  }

  dispose(): void {
    this.disposed = true
    if (this.splitter && !this.splitter.webContents.isDestroyed()) this.splitter.webContents.close()
    this.splitter = null
    for (const tab of this.tabs.values()) {
      if (tab.devtools && !tab.devtools.webContents.isDestroyed()) tab.devtools.webContents.close()
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    }
    this.tabs.clear()
    this.order = []
    this.activeId = null
  }

  // ---- navigation ----

  navigate(id: string, input: string): void {
    const wc = this.wc(id)
    if (!wc) return
    void wc.loadURL(toUrl(input, getAppSettings().searchTemplate)).catch(() => {})
  }

  back(id: string): void {
    const wc = this.wc(id)
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }

  forward(id: string): void {
    const wc = this.wc(id)
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  }

  reload(id: string, ignoreCache = false): void {
    const wc = this.wc(id)
    if (!wc) return
    ignoreCache ? wc.reloadIgnoringCache() : wc.reload()
  }

  /** Chrome's "Empty Cache and Hard Reload": drop the session cache, then reload
   *  ignoring what's left. Async because clearing the cache is. */
  async emptyCacheAndReload(id: string): Promise<void> {
    const wc = this.wc(id)
    if (!wc) return
    await wc.session.clearCache()
    wc.reloadIgnoringCache()
  }

  stop(id: string): void {
    this.wc(id)?.stop()
  }

  // ---- docked DevTools ----

  /**
   * DevTools are hosted in a WebContentsView we position ourselves, rather than
   * Electron's built-in `mode: 'bottom'`. The built-in docking is relative to the
   * native window and knows nothing about our chrome height or plugin dock, so it
   * cannot compose with our layout. `setDevToolsWebContents` renders the DevTools
   * UI into our own view; `layout()` then splits the page area.
   *
   * The panels themselves — Console, Sources, Elements, Network, Application —
   * are Chrome's own, complete. We are only docking them.
   */
  toggleDevTools(id: string): void {
    const tab = this.tabs.get(id)
    const wc = this.wc(id)
    if (!tab || !wc) return
    if (tab.devtoolsOpen) this.closeDevToolsFor(tab)
    else this.openDevToolsFor(tab, wc)
    this.layout()
    this.emit()
  }

  setDevToolsSide(side: DevToolsSide): void {
    this.devtoolsSide = side
    this.layout()
    this.emit()
  }

  private openDevToolsFor(tab: Tab, wc: Electron.WebContents): void {
    if (!tab.devtools) {
      tab.devtools = new WebContentsView()
      this.win.contentView.addChildView(tab.devtools)
    }
    wc.setDevToolsWebContents(tab.devtools.webContents)
    // 'detach' tells Chromium not to manage docking itself — we do.
    wc.openDevTools({ mode: 'detach' })
    tab.devtoolsOpen = true
  }

  // ---- DevTools divider drag ----

  private ensureSplitter(): WebContentsView {
    if (this.splitter) return this.splitter
    const v = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/chrome.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    v.setBackgroundColor('#00000000')
    if (process.env['ELECTRON_RENDERER_URL']) {
      void v.webContents.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/splitter.html`)
    } else {
      void v.webContents.loadFile(join(__dirname, '../renderer/splitter.html'))
    }
    this.splitter = v
    return v
  }

  splitDragStart(): void {
    if (!this.splitter) return
    this.draggingSplit = true
    // Expand the divider over the whole content area so it keeps receiving
    // mousemove once the pointer leaves the thin handle. It's transparent.
    const { width, height } = this.win.getContentBounds()
    this.splitter.setBounds({
      x: 0,
      y: this.chromeHeight,
      width: Math.max(0, width - this.dockWidth),
      height: Math.max(0, height - this.chromeHeight)
    })
  }

  splitDragMove(x: number, y: number): void {
    if (!this.draggingSplit) return
    const { width, height } = this.win.getContentBounds()
    const areaW = Math.max(1, width - this.dockWidth)
    const areaH = Math.max(1, height - this.chromeHeight)
    // While dragging, the splitter covers the content area, so x/y are already
    // relative to its top-left.
    const fraction =
      this.devtoolsSide === 'bottom' ? (areaH - y) / areaH : (areaW - x) / areaW
    // Clamp: never let either pane collapse to nothing.
    this.devtoolsFraction = Math.min(0.85, Math.max(0.15, fraction))
    this.layout()
  }

  splitDragEnd(): void {
    this.draggingSplit = false
    this.layout()
    this.emit()
  }

  private closeDevToolsFor(tab: Tab): void {
    const wc = tab.view.webContents
    if (!wc.isDestroyed() && wc.isDevToolsOpened()) wc.closeDevTools()
    if (tab.devtools) {
      this.win.contentView.removeChildView(tab.devtools)
      if (!tab.devtools.webContents.isDestroyed()) tab.devtools.webContents.close()
      tab.devtools = undefined
    }
    tab.devtoolsOpen = false
  }

  // ---- device simulation ----

  /**
   * Uses `enableDeviceEmulation` + `setUserAgent`, NOT the CDP debugger.
   * `webContents.debugger` can't attach while DevTools is open (one debugger per
   * webContents), so a CDP-based emulator would break DevTools and vice versa.
   * This path coexists with docked DevTools.
   *
   * Finer controls — network throttling, touch events, geolocation — need CDP,
   * so they stay in DevTools' own device toolbar.
   */
  setDevice(id: string, deviceId: string | null): void {
    const tab = this.tabs.get(id)
    const wc = this.wc(id)
    if (!tab || !wc) return

    const device = findDevice(deviceId)
    tab.deviceId = device ? device.id : null

    if (!device) {
      wc.disableDeviceEmulation()
      wc.setUserAgent(this.defaultUserAgent())
    } else {
      wc.enableDeviceEmulation({
        screenPosition: device.mobile ? 'mobile' : 'desktop',
        screenSize: { width: device.width, height: device.height },
        viewSize: { width: device.width, height: device.height },
        deviceScaleFactor: device.deviceScaleFactor,
        viewPosition: { x: 0, y: 0 },
        scale: 1
      })
      wc.setUserAgent(device.userAgent)
    }
    // The page must re-evaluate media queries and re-request with the new UA.
    wc.reload()
    this.layout()
    this.emit()
  }

  private defaultUserAgent(): string {
    return this.session.getUserAgent()
  }

  duplicate(id: string): void {
    const wc = this.wc(id)
    if (wc) this.create(wc.getURL())
  }

  closeOthers(id: string): void {
    for (const other of [...this.order]) if (other !== id) this.close(other)
  }

  // ---- zoom ----

  private zoomOf(id: string | null): number {
    if (!id) return 1
    const wc = this.wc(id)
    return wc ? wc.getZoomFactor() : 1
  }

  zoom(id: string, direction: 'in' | 'out' | 'reset'): void {
    const wc = this.wc(id)
    if (!wc) return
    if (direction === 'reset') {
      wc.setZoomFactor(1)
      this.emit()
      return
    }
    // Snap to the nearest standard step rather than multiplying, so zoom
    // levels stay on the values every other browser uses.
    const cur = wc.getZoomFactor()
    const idx = ZOOM_STEPS.reduce(
      (best, v, i) => (Math.abs(v - cur) < Math.abs(ZOOM_STEPS[best] - cur) ? i : best),
      0
    )
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, idx + (direction === 'in' ? 1 : -1)))]
    wc.setZoomFactor(next)
    this.emit()
  }

  // ---- find in page ----

  startFind(): void {
    if (!this.find) this.find = { query: '', activeMatch: 0, totalMatches: 0 }
    this.emit()
  }

  findInPage(query: string, forward = true, findNext = false): void {
    if (!this.activeId) return
    const wc = this.wc(this.activeId)
    if (!wc) return
    if (!query) {
      wc.stopFindInPage('clearSelection')
      this.find = { query: '', activeMatch: 0, totalMatches: 0 }
      this.emit()
      return
    }
    this.find = { ...(this.find ?? { activeMatch: 0, totalMatches: 0 }), query }

    // ELECTRON QUIRK: passing `findNext: false` explicitly makes findInPage
    // never emit `found-in-page` — the search silently returns nothing. Omitting
    // the key works, even though the docs say it defaults to false. So only ever
    // pass it when it's true. Verified on Electron 43.1.1:
    //   findInPage(q)                            -> 2 matches
    //   findInPage(q, {forward:true})            -> 2 matches
    //   findInPage(q, {forward:true, findNext:true})  -> 2 matches
    //   findInPage(q, {forward:true, findNext:false}) -> no event at all
    wc.findInPage(query, findNext ? { forward, findNext: true } : { forward })
  }

  stopFind(): void {
    if (this.activeId) this.wc(this.activeId)?.stopFindInPage('clearSelection')
    this.find = null
    this.emit()
  }

  // ---- layout ----

  setChromeHeight(px: number): void {
    const next = Math.max(0, Math.round(px))
    if (next === this.chromeHeight) return
    this.chromeHeight = next
    this.layout()
  }

  /**
   * The plugin dock shrinks the page rather than floating over it. That's a
   * deliberate choice: these are native views that ignore DOM stacking, so a
   * floating panel would need its own overlay view. Shrinking is both simpler
   * and what browsers' side panels actually do.
   */
  setDockWidth(px: number): void {
    const next = Math.max(0, Math.round(px))
    if (next === this.dockWidth) return
    this.dockWidth = next
    this.layout()
  }

  /**
   * Composes three things, in order: the plugin dock takes width, docked
   * DevTools take a strip of what's left, and device emulation letterboxes the
   * page inside the remainder. All three can be active at once.
   */
  private layout(): void {
    // The resize handler can fire mid-close, before dispose() runs — guard the
    // destroyed window too, not just our own flag.
    if (this.disposed || this.win.isDestroyed()) return
    const { width, height } = this.win.getContentBounds()

    for (const [id, tab] of this.tabs) {
      const active = id === this.activeId
      tab.view.setVisible(active)
      tab.devtools?.setVisible(active && tab.devtoolsOpen)
      if (!active) continue

      // 1. Content area = window minus chrome minus the plugin dock.
      let x = 0
      let y = this.chromeHeight
      let w = Math.max(0, width - this.dockWidth)
      let h = Math.max(0, height - this.chromeHeight)

      // 2. Docked DevTools carve off a strip, with a draggable divider at the
      //    seam. The divider is added last so it sits above both panes.
      if (tab.devtoolsOpen && tab.devtools) {
        const split = this.ensureSplitter()
        if (!this.splitterAttached) {
          this.win.contentView.addChildView(split)
          this.splitterAttached = true
        }
        split.setVisible(true)

        const GRIP = 6
        if (this.devtoolsSide === 'bottom') {
          const dh = Math.round(h * this.devtoolsFraction)
          tab.devtools.setBounds({ x, y: y + h - dh, width: w, height: dh })
          if (!this.draggingSplit) {
            split.setBounds({ x, y: y + h - dh - GRIP / 2, width: w, height: GRIP })
          }
          h = Math.max(0, h - dh)
        } else {
          const dw = Math.round(w * this.devtoolsFraction)
          tab.devtools.setBounds({ x: x + w - dw, y, width: dw, height: h })
          if (!this.draggingSplit) {
            split.setBounds({ x: x + w - dw - GRIP / 2, y, width: GRIP, height: h })
          }
          w = Math.max(0, w - dw)
        }
      } else if (this.splitter && this.splitterAttached) {
        this.splitter.setVisible(false)
      }

      // 3. Device emulation: shrink to the device's CSS size, centred. The gap
      //    around it shows the chrome's backdrop — that's the letterbox.
      const device = findDevice(tab.deviceId)
      if (device) {
        const dw = Math.min(device.width, w)
        const dh = Math.min(device.height, h)
        x += Math.round((w - dw) / 2)
        y += Math.round((h - dh) / 2)
        w = dw
        h = dh
      }

      tab.view.setBounds({ x, y, width: w, height: h })
    }
  }

  // ---- state ----

  state(): WindowState {
    return {
      windowId: this.win.id,
      isPrivate: this.isPrivate,
      activeTabId: this.activeId,
      tabs: this.order.map((id) => this.toState(this.tabs.get(id)!)),
      zoom: this.zoomOf(this.activeId),
      find: this.find,
      devtoolsSide: this.devtoolsSide
    }
  }

  private toState(tab: Tab): TabState {
    const wc = tab.view.webContents
    const dead = wc.isDestroyed()
    return {
      id: tab.id,
      title: tab.title,
      url: dead ? '' : wc.getURL(),
      favicon: tab.favicon,
      loading: !dead && wc.isLoading(),
      canGoBack: !dead && wc.navigationHistory.canGoBack(),
      canGoForward: !dead && wc.navigationHistory.canGoForward(),
      error: tab.error,
      devtoolsOpen: tab.devtoolsOpen,
      deviceId: tab.deviceId
    }
  }

  private wc(id: string) {
    const tab = this.tabs.get(id)
    if (!tab || tab.view.webContents.isDestroyed()) return null
    return tab.view.webContents
  }

  /** The active tab's webContents and URL — what Imprint acts on. */
  activeContext(): { url: string; wc: import('electron').WebContents } | null {
    if (!this.activeId) return null
    const wc = this.wc(this.activeId)
    if (!wc) return null
    return { url: wc.getURL(), wc }
  }

  private emit(): void {
    if (this.disposed || this.win.isDestroyed() || this.win.webContents.isDestroyed()) return
    this.win.webContents.send('push:windowState', this.state())
  }

  // ---- wiring ----

  private wire(tab: Tab): void {
    const wc = tab.view.webContents
    attachPageContextMenu(wc, this, tab.id)

    wc.on('page-title-updated', (_e, title) => {
      tab.title = title
      this.emit()
    })

    wc.on('page-favicon-updated', (_e, favicons) => {
      tab.favicon = favicons[0] ?? null
      this.emit()
    })

    wc.on('did-start-loading', () => {
      tab.error = null
      this.emit()
    })
    wc.on('did-stop-loading', () => this.emit())

    wc.on('found-in-page', (_e, result) => {
      this.find = {
        query: this.find?.query ?? '',
        activeMatch: result.activeMatchOrdinal,
        totalMatches: result.matches
      }
      this.emit()
    })

    wc.on('did-navigate', (_e, url) => {
      // Fall back to the URL as the title, so a titleless page (e.g. a raw JSON
      // response) doesn't keep showing the *previous* page's title. A real
      // page-title-updated overrides this a moment later.
      tab.title = prettyUrl(url)
      this.emit()
    })
    wc.on('did-navigate-in-page', () => this.emit())

    wc.on('did-finish-load', () => {
      // Private windows leave no trace on disk.
      if (!this.isPrivate) recordVisit(wc.getURL(), tab.title)
      this.emit()
    })

    wc.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
      // -3 is ABORTED — fires on every user-cancelled nav, not an error.
      if (!isMainFrame || code === -3) return
      tab.error = `${desc} (${code})`
      tab.title = 'Failed to load'
      this.emit()
    })

    // target=_blank / window.open → a new tab, never a popup window.
    wc.setWindowOpenHandler(({ url }) => {
      this.create(url)
      return { action: 'deny' }
    })
  }
}
