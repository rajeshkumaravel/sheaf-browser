/** Shared between main, preload and renderer. No runtime imports from electron here. */

/**
 * Mirrors NodeJS.Platform. Declared locally because this file is compiled into
 * the renderer too, which has no Node types.
 */
export type Platform =
  | 'aix'
  | 'android'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'openbsd'
  | 'sunos'
  | 'win32'
  | 'cygwin'
  | 'netbsd'

export type ThemeMode = 'dark' | 'light' | 'system'

/** Resolved theme actually applied to the DOM (never 'system'). */
export type ResolvedTheme = 'dark' | 'light'

export interface AppSettings {
  theme: ThemeMode
  /** Shown in the greeting. Local only — never leaves the machine. */
  userName: string | null
  onboarded: boolean
  homePage: string
  /** `%s` is replaced with the query. */
  searchTemplate: string
  /** User-added device-simulation profiles, merged with the built-ins. */
  customDevices: import('./devices').DevicePreset[]
}

export const DEFAULT_HOME = 'sheaf://home'
export const DEFAULT_SEARCH = 'https://www.google.com/search?q=%s'

/** One tab, as the renderer sees it. Mirrors a WebContentsView in main. */
export interface TabState {
  id: string
  title: string
  url: string
  /** data: URI, or null when the page has no favicon yet. */
  favicon: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** Set when the page failed to load; cleared on the next successful nav. */
  error: string | null
  /** Whether docked DevTools are open for this tab. */
  devtoolsOpen: boolean
  /** Active device-simulation preset id, or null (desktop). */
  deviceId: string | null
}

export type DevToolsSide = 'bottom' | 'right'

/** Full state of one browser window, pushed to its chrome renderer on every change. */
export interface WindowState {
  windowId: number
  tabs: TabState[]
  activeTabId: string | null
  /** Private windows use an in-memory session that dies with the window. */
  isPrivate: boolean
  /** Zoom of the active tab, as a factor (1 = 100%). */
  zoom: number
  /** Null when the find bar is closed. */
  find: FindState | null
  /** Which side docked DevTools attach to. */
  devtoolsSide: DevToolsSide
}

// ---- bookmarks ----

export interface Bookmark {
  id: string
  /** null = top level (the bookmarks bar). */
  parentId: string | null
  kind: 'bookmark' | 'folder'
  title: string
  /** null for folders. */
  url: string | null
  /**
   * The site's icon as a **data URI**, captured once at bookmark time.
   * Deliberately not a remote URL: rendering the bar must never make a request
   * to every bookmarked origin.
   */
  favicon: string | null
  position: number
  createdAt: number
}

// ---- history ----

export interface HistoryEntry {
  id: number
  url: string
  title: string | null
  visitedAt: number
}

// ---- downloads ----

export type DownloadState = 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted'

export interface DownloadItem {
  id: string
  url: string
  filename: string
  savePath: string
  state: DownloadState
  receivedBytes: number
  totalBytes: number
  startedAt: number
}

// ---- Imprint: cookies & storage ----

export interface CookieItem {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  /** Unix seconds; null for a session cookie. */
  expirationDate: number | null
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

export type StorageArea = 'local' | 'session'

/** Snapshot of the active tab's storable state, for the Imprint panel. */
export interface ImprintSnapshot {
  /** The origin the panel is acting on, or null for a page with no origin. */
  origin: string | null
  url: string
  cookies: CookieItem[]
  local: Record<string, string>
  session: Record<string, string>
}

// ---- omnibox ----

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type SuggestionKind = 'url' | 'bookmark' | 'history' | 'search'

export interface Suggestion {
  kind: SuggestionKind
  /** What to show. For a search this is the raw query. */
  title: string
  url: string
  score: number
}

export interface OmniboxState {
  query: string
  items: Suggestion[]
  /**
   * -1 means "the user has not picked anything". Enter then navigates to what
   * was typed, never to a suggestion. Only an arrow key or a hover sets this.
   */
  selected: number
}

// ---- find in page ----

export interface FindState {
  query: string
  activeMatch: number
  totalMatches: number
}

// ---- third-party Chrome extensions ----

export interface InstalledExtension {
  /** Our stable install id (the folder name), not Chrome's computed id. */
  installId: string
  /** Chrome's extension id once loaded, or null if currently disabled. */
  chromeId: string | null
  name: string
  version: string
  enabled: boolean
  /** Present if the last load attempt failed. */
  error?: string
}

/** Requirement 3 — what `sheaf://about` reports. */
export interface BrowserInfo {
  appName: string
  appVersion: string
  electron: string
  chrome: string
  node: string
  v8: string
  platform: Platform
  arch: string
  osVersion: string
  /** Where settings/history/cache live. Useful for support. */
  userDataPath: string
  locale: string
  isPackaged: boolean
}

// ---- updater ----

export type UpdateStatus =
  | { state: 'downloading'; version: string }
  | { state: 'progress'; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }
