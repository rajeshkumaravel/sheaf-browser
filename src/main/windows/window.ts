import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Session } from 'electron'
import { BrowserWindow, session as electronSession, shell } from 'electron'
import type { OmniboxState } from '@shared/types'
import { registerStubProtocol } from '@plugins/mailroom/main'
import { attachDownloads } from '../downloads'
import { setExtensionSession } from '../extensions'
import { pluginHost } from '../plugin-host'
import { registerInternalProtocol } from '../protocols/internal'
import { TabManager } from '../tabs/manager'
import { OmniboxOverlay } from './overlay'

const windows = new Map<number, SheafWindow>()

const devIcon = join(__dirname, '../../resources/icon.png')

export class SheafWindow {
  readonly win: BrowserWindow
  readonly tabs: TabManager
  readonly session: Session
  readonly isPrivate: boolean
  readonly overlay: OmniboxOverlay
  /** Omnibox dropdown state lives in main so the chrome input and the overlay
   *  view — two separate renderers — can't disagree about what's selected. */
  omnibox: OmniboxState = { query: '', items: [], selected: 0 }

  constructor(opts: { private?: boolean } = {}) {
    this.isPrivate = opts.private ?? false

    // A partition without the `persist:` prefix is in-memory only: it dies with
    // the window. That is the whole implementation of private browsing.
    this.session = this.isPrivate
      ? electronSession.fromPartition(`private-${randomUUID()}`)
      : electronSession.fromPartition('persist:profile-default')

    // All per-session, not global — a private window gets a brand new session
    // that knows nothing about sheaf://, sheaf-stub://, or our plugins until told.
    registerInternalProtocol(this.session)
    registerStubProtocol(this.session)
    pluginHost.attach(this.session)

    // Third-party extensions load into the default profile only, never a
    // private window. The first default window's session is the target.
    if (!this.isPrivate) setExtensionSession(this.session)

    // PRIVACY: Electron's spellchecker is on by default, and on Windows/Linux it
    // downloads Hunspell dictionaries from Google's CDN (redirector.gvt1.com) —
    // an unprompted request handing Google the user's IP and locale. macOS uses
    // the OS spellchecker instead and downloads nothing, so keep it there and
    // turn it off where the only implementation phones home.
    this.session.setSpellCheckerEnabled(process.platform === 'darwin')

    // Clipboard read is granted ONLY to our own internal pages (Folio's paste
    // scratchpad). Everything else is denied — this is not the full permission
    // prompt system yet (that's future work), just a safe default that unblocks
    // a trusted feature without opening clipboard access to arbitrary sites.
    const isInternal = (url: string) => url.startsWith('sheaf://')
    this.session.setPermissionRequestHandler((wc, permission, callback) => {
      callback(permission === 'clipboard-read' && isInternal(wc.getURL()))
    })
    this.session.setPermissionCheckHandler((_wc, permission, origin) => {
      return permission === 'clipboard-read' && origin.startsWith('sheaf://')
    })

    this.win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 640,
      minHeight: 400,
      show: false,
      title: this.isPrivate ? 'Sheaf Browser — Private' : 'Sheaf Browser',
      backgroundColor: this.isPrivate ? '#1a1420' : '#0a0a0a',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      ...(process.platform !== 'darwin' && existsSync(devIcon) ? { icon: devIcon } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/chrome.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    this.tabs = new TabManager(this.win, this.session, this.isPrivate)
    this.overlay = new OmniboxOverlay(this.win)
    windows.set(this.win.id, this)

    // Resizing while the dropdown is open would leave it stranded mid-window.
    this.win.on('resize', () => this.overlay.hide())

    attachDownloads(this.session, this.isPrivate, () =>
      this.win.webContents.send('push:downloads')
    )

    // The chrome UI itself must never navigate away or spawn popups.
    this.win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void shell.openExternal(url)
      return { action: 'deny' }
    })

    this.win.on('ready-to-show', () => this.win.show())
    this.win.on('closed', () => {
      this.overlay.dispose()
      this.tabs.dispose()
      windows.delete(this.win.id)
    })

    if (process.env['ELECTRON_RENDERER_URL']) {
      void this.win.webContents.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      void this.win.webContents.loadFile(join(__dirname, '../renderer/index.html'))
    }

    // The renderer asks for its first tab once it has mounted, so the tab's
    // state push isn't lost before there's a listener.
  }
}

export function windowFromWebContents(sender: Electron.WebContents): SheafWindow | undefined {
  const bw = BrowserWindow.fromWebContents(sender)
  return bw ? windows.get(bw.id) : undefined
}

export function allWindows(): SheafWindow[] {
  return [...windows.values()]
}

/**
 * The window a menu action should apply to. `getFocusedWindow()` returns null
 * when focus is inside a page's WebContentsView rather than the chrome, so fall
 * back to the last window — otherwise menu items go dead the moment someone
 * clicks on a page.
 */
export function focusedSheafWindow(): SheafWindow | undefined {
  const bw = BrowserWindow.getFocusedWindow()
  if (bw && windows.has(bw.id)) return windows.get(bw.id)
  return [...windows.values()].pop()
}
