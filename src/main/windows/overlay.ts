import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { WebContentsView } from 'electron'
import { PUSH_OMNIBOX } from '@shared/ipc'
import type { OmniboxState, Rect } from '@shared/types'

const ITEM_H = 34
const PAD = 8
const MAX_VISIBLE = 8

/**
 * The omnibox suggestion dropdown.
 *
 * It cannot be a DOM element. Page content is a native WebContentsView
 * composited *above* the chrome renderer, so anything the chrome draws over the
 * page area is simply painted underneath it — z-index does not exist across
 * that boundary.
 *
 * So the dropdown is its own native view, sized to exactly the list's rect and
 * re-added on show so it sits on top of the tab views. Everywhere the dropdown
 * isn't, the view doesn't exist, so the page keeps receiving mouse events
 * normally.
 */
export class OmniboxOverlay {
  private view: WebContentsView | null = null
  private visible = false
  private rect: Rect = { x: 0, y: 0, width: 0, height: 0 }
  /** The renderer can't receive a push until it has mounted its listener. */
  private ready = false
  private pending: OmniboxState | null = null

  constructor(private readonly win: BrowserWindow) {
    // Warm it at construction so the first open isn't waiting on a page load.
    this.ensure()
  }

  private ensure(): WebContentsView {
    if (this.view) return this.view
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/chrome.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    // A WebContentsView is transparent via setBackgroundColor, not a
    // webPreferences flag — that one is a BrowserWindow option and is ignored here.
    view.setBackgroundColor('#00000000')

    // loadURL is async. Pushing before the renderer has mounted silently drops
    // the message — which showed up as a blank dropdown on first open, every
    // session. Queue until it's actually listening.
    view.webContents.once('did-finish-load', () => {
      this.ready = true
      if (this.pending) {
        this.push(this.pending)
        this.pending = null
      }
    })

    if (process.env['ELECTRON_RENDERER_URL']) {
      void view.webContents.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay.html`)
    } else {
      void view.webContents.loadFile(join(__dirname, '../renderer/overlay.html'))
    }
    this.view = view
    return view
  }

  show(state: OmniboxState, anchor: Rect): void {
    const view = this.ensure()
    const rows = Math.min(state.items.length, MAX_VISIBLE)
    if (rows === 0) {
      this.hide()
      return
    }

    // Re-adding brings it to the front of the child list: tab views are added
    // as tabs are created, so a view added once at construction would end up
    // buried underneath them.
    if (this.visible) this.win.contentView.removeChildView(view)
    this.win.contentView.addChildView(view)
    this.visible = true

    this.rect = {
      x: Math.round(anchor.x),
      y: Math.round(anchor.y),
      width: Math.round(anchor.width),
      height: rows * ITEM_H + PAD
    }
    view.setBounds(this.rect)
    view.setVisible(true)
    this.push(state)
  }

  push(state: OmniboxState): void {
    if (!this.view || this.view.webContents.isDestroyed()) return
    if (!this.ready) {
      this.pending = state
      return
    }
    this.view.webContents.send(PUSH_OMNIBOX, state)
  }

  hide(): void {
    if (!this.view || !this.visible) return
    this.visible = false
    // The window may already be tearing down (this can fire from a resize
    // handler mid-close); touching its contentView then throws "Object has been
    // destroyed".
    if (this.win.isDestroyed()) return
    this.view.setVisible(false)
    this.win.contentView.removeChildView(this.view)
  }

  isVisible(): boolean {
    return this.visible
  }

  dispose(): void {
    if (!this.view) return
    // dispose runs on the window's `closed` event, at which point the window and
    // all its child views are already destroyed. Only detach from contentView if
    // the window somehow outlives us; otherwise just drop our references.
    if (this.visible && !this.win.isDestroyed()) {
      this.win.contentView.removeChildView(this.view)
    }
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
    this.view = null
    this.visible = false
  }
}
