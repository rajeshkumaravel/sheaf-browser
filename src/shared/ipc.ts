import type { LetterheadState, MailroomState } from './plugins'
import type {
  AppSettings,
  Bookmark,
  BrowserInfo,
  CookieItem,
  DevToolsSide,
  DownloadItem,
  HistoryEntry,
  ImprintSnapshot,
  InstalledExtension,
  OmniboxState,
  Rect,
  StorageArea,
  WindowState
} from './types'

/**
 * Every main-process handler returns this envelope so thrown errors arrive in
 * the renderer as clean messages instead of Electron's stringified stack.
 */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** The full renderer→main surface. Adding a channel here is the only way to add one. */
export interface IpcChannels {
  'settings:get': { args: []; result: AppSettings }
  'settings:set': { args: [partial: Partial<AppSettings>]; result: AppSettings }

  'browser:info': { args: []; result: BrowserInfo }


  /** Wipes all local data and relaunches. No return — the app restarts. */
  'app:factoryReset': { args: []; result: void }

  'tabs:create': { args: [url?: string]; result: string }
  'tabs:close': { args: [id: string]; result: void }
  'tabs:select': { args: [id: string]; result: void }
  'tabs:navigate': { args: [id: string, input: string]; result: void }
  'tabs:back': { args: [id: string]; result: void }
  'tabs:forward': { args: [id: string]; result: void }
  'tabs:reload': { args: [id: string, ignoreCache?: boolean]; result: void }
  'tabs:stop': { args: [id: string]; result: void }
  'tabs:devtools': { args: [id: string]; result: void }
  'tabs:devtoolsSide': { args: [side: DevToolsSide]; result: void }
  /** Dragging the DevTools divider. Coords are relative to the splitter view. */
  'devtools:dragStart': { args: []; result: void }
  'devtools:dragMove': { args: [x: number, y: number]; result: void }
  'devtools:dragEnd': { args: []; result: void }
  /** Device-simulation preset id, or null for desktop. */
  'tabs:device': { args: [id: string, deviceId: string | null]; result: void }
  'tabs:state': { args: []; result: WindowState }

  /**
   * The chrome renderer owns its own height (it's CSS), main owns the content
   * view bounds. This is how main learns where the page area starts.
   */
  'chrome:height': { args: [px: number]; result: void }

  /** Width of the plugin dock, so main can shrink the page view to fit it. */
  'chrome:dockWidth': { args: [px: number]; result: void }

  'window:new': { args: [opts: { private: boolean }]; result: void }

  'tabs:duplicate': { args: [id: string]; result: void }
  'tabs:contextMenu': { args: [id: string]; result: void }
  /** Right-click on the toolbar reload button → Chrome's three-way reload menu. */
  'tabs:reloadMenu': { args: [id: string]; result: void }

  'tabs:zoom': { args: [id: string, direction: 'in' | 'out' | 'reset']; result: void }

  // ---- omnibox dropdown ----
  /** Typing. `anchor` is the omnibox's rect in window coords, measured by CSS. */
  'omnibox:query': { args: [query: string, anchor: Rect]; result: void }
  /** Arrow keys. */
  'omnibox:move': { args: [delta: number]; result: void }
  /** Hover. */
  'omnibox:select': { args: [index: number]; result: void }
  /**
   * Enter, or a click in the dropdown. `text` is the input's current value and
   * is authoritative: suggestions are computed asynchronously, so main's state
   * may lag what was typed. Never navigate somewhere the user didn't ask for.
   */
  'omnibox:accept': { args: [text: string, index?: number]; result: void }
  'omnibox:close': { args: []; result: void }

  'find:start': { args: []; result: void }
  'find:query': { args: [query: string, forward: boolean, findNext: boolean]; result: void }
  'find:stop': { args: []; result: void }

  // ---- bookmarks ----
  'bookmarks:list': { args: []; result: Bookmark[] }
  'bookmarks:add': {
    args: [input: { title: string; url: string | null; parentId?: string | null; kind?: Bookmark['kind'] }]
    result: Bookmark
  }
  'bookmarks:update': { args: [id: string, patch: { title?: string; url?: string }]; result: void }
  'bookmarks:remove': { args: [id: string]; result: void }
  'bookmarks:forUrl': { args: [url: string]; result: Bookmark | null }

  // ---- history ----
  'history:search': { args: [query: string]; result: HistoryEntry[] }
  'history:delete': { args: [id: number]; result: void }
  'history:clear': { args: []; result: void }

  // ---- downloads ----
  'downloads:list': { args: []; result: DownloadItem[] }
  'downloads:cancel': { args: [id: string]; result: void }
  'downloads:pause': { args: [id: string]; result: void }
  'downloads:reveal': { args: [id: string]; result: void }
  'downloads:clear': { args: []; result: void }

  // ---- Letterhead ----
  'letterhead:get': { args: []; result: LetterheadState }
  'letterhead:set': { args: [state: LetterheadState]; result: LetterheadState }

  // ---- Imprint ---- (all act on the requesting window's active tab)
  'imprint:snapshot': { args: []; result: ImprintSnapshot }
  'imprint:setCookie': {
    args: [cookie: Partial<CookieItem> & { name: string; value: string }]
    result: ImprintSnapshot
  }
  'imprint:removeCookie': { args: [name: string]; result: ImprintSnapshot }
  'imprint:setStorage': { args: [area: StorageArea, key: string, value: string]; result: ImprintSnapshot }
  'imprint:removeStorage': { args: [area: StorageArea, key: string]; result: ImprintSnapshot }
  'imprint:clearStorage': { args: [area: StorageArea]; result: ImprintSnapshot }

  // ---- Mailroom ----
  'mailroom:get': { args: []; result: { state: MailroomState; harCount: number } }
  'mailroom:set': { args: [state: MailroomState]; result: { state: MailroomState; harCount: number } }
  'mailroom:clearHar': { args: []; result: { state: MailroomState; harCount: number } }
  'mailroom:exportHar': { args: []; result: { saved: boolean; path?: string } }

  // ---- third-party extensions ----
  'extensions:list': { args: []; result: InstalledExtension[] }
  /** Opens a file picker; returns the updated list (unchanged if cancelled). */
  'extensions:install': { args: []; result: { list: InstalledExtension[]; error?: string } }
  'extensions:setEnabled': { args: [installId: string, enabled: boolean]; result: InstalledExtension[] }
  'extensions:remove': { args: [installId: string]; result: InstalledExtension[] }
}

export type IpcChannel = keyof IpcChannels

export type InvokeFn = <K extends IpcChannel>(
  channel: K,
  ...args: IpcChannels[K]['args']
) => Promise<IpcChannels[K]['result']>

/** main→renderer pushes. */
export const PUSH_WINDOW_STATE = 'push:windowState'
export const PUSH_DOWNLOADS = 'push:downloads'
/** Settings changed anywhere (including from an internal page) — re-read them. */
export const PUSH_SETTINGS = 'push:settings'
/** Letterhead rules that just modified a live request — drives the ripple. */
export const PUSH_LETTERHEAD_FIRED = 'push:letterheadFired'
/** Letterhead rules changed. Global state, so every window must re-read it. */
export const PUSH_LETTERHEAD = 'push:letterhead'
/** main→overlay renderer. */
export const PUSH_OMNIBOX = 'push:omnibox'
/** Menu items that need the renderer to act (it owns the bookmarks UI state). */
export const PUSH_COMMAND = 'push:command'

export type ChromeCommand = 'bookmark-page' | 'toggle-bookmarks-bar'
