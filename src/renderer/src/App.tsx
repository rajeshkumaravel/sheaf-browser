import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { activeRuleCount, liveRuleIds } from '@shared/plugins'
import type { Bookmark } from '@shared/types'
import { BookmarksBar } from './components/BookmarksBar'
import { FindBar } from './components/FindBar'
import { DEVICE_PRESETS, setCustomDevices } from '@shared/devices'
import { PLUGINS, PluginDock } from './components/PluginDock'
import { TabStrip } from './components/TabStrip'
import { MANAGE_DEVICES, Toolbar } from './components/Toolbar'
import { activeTab, resolveTheme, usePulse, useStore } from './state/store'

export function App(): JSX.Element {
  const settings = useStore((s) => s.settings)
  const win = useStore((s) => s.window)
  const openPluginId = useStore((s) => s.openPluginId)
  const letterhead = useStore((s) => s.letterhead)
  const setSettings = useStore((s) => s.setSettings)
  const setWindow = useStore((s) => s.setWindow)
  const setOpenPluginId = useStore((s) => s.setOpenPluginId)
  const setLetterhead = useStore((s) => s.setLetterhead)
  const letterheadFired = useStore((s) => s.letterheadFired)
  const pushLetterheadFired = useStore((s) => s.pushLetterheadFired)
  /** Ripples the Letterhead button whenever one of its rules touches a request. */
  const lhPulse = usePulse(letterheadFired.tick)

  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [showBar, setShowBar] = useState(true)
  const [downloadCount, setDownloadCount] = useState(0)
  const [percent, setPercent] = useState<number | null>(null)
  const [updateReady, setUpdateReady] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const chromeRef = useRef<HTMLDivElement>(null)

  const tab = activeTab(win)
  const api = window.sheaf

  const refreshBookmarks = useCallback(async () => {
    setBookmarks(await api.invoke('bookmarks:list'))
  }, [])

  // Downloads still in flight — the toolbar badge. Main pushes on every change.
  const refreshDownloads = useCallback(async () => {
    const items = await api.invoke('downloads:list')
    setDownloadCount(items.filter((d) => d.state === 'progressing' || d.state === 'paused').length)
  }, [])

  useEffect(() => {
    void refreshDownloads()
    return api.onDownloads(() => void refreshDownloads())
  }, [refreshDownloads])

  // Settings can change from an internal page (devices, welcome) — follow them
  // rather than trusting the copy read at boot.
  useEffect(
    () =>
      api.onSettings((s) => {
        setSettings(s)
        setCustomDevices(s.customDevices)
      }),
    []
  )

  useEffect(() => api.onLetterheadFired(pushLetterheadFired), [])
  useEffect(() => api.onLetterheadState(setLetterhead), [])

  useEffect(() => {
    const unsubscribe = api.onUpdateStatus((status) => {
      if (status.state === 'downloading') {
        setUpdateReady(false)
        setPercent(0)
        setUpdateError(null)
      }
      if (status.state === 'progress') {
        setUpdateReady(false)
        setPercent(status.percent)
        setUpdateError(null)
      }
      if (status.state === 'ready') {
        setUpdateReady(true)
        setUpdateError(null)
      }
      if (status.state === 'error') {
        setUpdateReady(false)
        setPercent(null)
        setUpdateError(status.message)
      }
    })
    return unsubscribe
  }, [])

  // ---- boot ----
  useEffect(() => {
    const offState = api.onWindowState(setWindow)
    void (async () => {
      const s = await api.invoke('settings:get')
      setSettings(s)
      // The renderer has its own copy of the devices module — register the
      // user's profiles here too, or the dropdown resolves ids main knows about.
      setCustomDevices(s.customDevices)
      setLetterhead(await api.invoke('letterhead:get'))
      await refreshBookmarks()
      const state = await api.invoke('tabs:state')
      setWindow(state)
      // First launch → the welcome page; otherwise the home page (via default).
      if (state.tabs.length === 0) {
        await api.invoke('tabs:create', s.onboarded ? undefined : 'sheaf://welcome')
      }
    })()
    return offState
  }, [])

  // ---- theme ----
  useEffect(() => {
    const apply = () =>
      document.documentElement.setAttribute('data-theme', resolveTheme(settings?.theme))
    apply()
    if (settings?.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings?.theme])

  // ---- bookmarks ----
  const bookmarkForTab = tab?.url ? (bookmarks.find((b) => b.url === tab.url) ?? null) : null

  const toggleBookmark = useCallback(async () => {
    if (!tab?.url || tab.url === 'about:blank') return
    const existing = bookmarks.find((b) => b.url === tab.url)
    if (existing) await api.invoke('bookmarks:remove', existing.id)
    else await api.invoke('bookmarks:add', { title: tab.title || tab.url, url: tab.url })
    await refreshBookmarks()
  }, [tab?.url, tab?.title, bookmarks])

  // Menu items whose action lives here, because the renderer owns this state.
  useEffect(() => {
    return api.onCommand((cmd) => {
      if (cmd === 'bookmark-page') void toggleBookmark()
      else if (cmd === 'toggle-bookmarks-bar') setShowBar((v) => !v)
    })
  }, [toggleBookmark])

  // ---- layout ----
  // Chrome height is decided by CSS; main needs it to position the page view.
  // The bookmarks and find bars change it, so this must re-measure on any
  // resize rather than being computed once.
  useLayoutEffect(() => {
    const el = chromeRef.current
    if (!el) return
    const report = () => void api.invoke('chrome:height', el.getBoundingClientRect().height)
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const badge = letterhead ? activeRuleCount(letterhead) : 0
  // Rules applying to the page you're on right now. Stays lit while you're
  // there, rather than flashing once when a request happens to fire.
  const liveIds = letterhead ? liveRuleIds(letterhead, tab?.url ?? null) : []

  // Theme cycles dark → light → system, persisted and applied immediately.
  const cycleTheme = async () => {
    const order = ['dark', 'light', 'system'] as const
    const next = order[(order.indexOf((settings?.theme ?? 'system') as (typeof order)[number]) + 1) % 3]
    setSettings(await api.invoke('settings:set', { theme: next }))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="chrome" ref={chromeRef}>
        <TabStrip
          tabs={win?.tabs ?? []}
          activeTabId={win?.activeTabId ?? null}
          userName={settings?.userName ?? null}
          updatePercent={percent}
          updateReady={updateReady}
          updateError={updateError}
          onSelect={(id) => void api.invoke('tabs:select', id)}
          onClose={(id) => void api.invoke('tabs:close', id)}
          onNew={() => void api.invoke('tabs:create')}
          onContextMenu={(id) => void api.invoke('tabs:contextMenu', id)}
          onGreetingClick={() =>
            tab && void api.invoke('tabs:navigate', tab.id, settings?.homePage ?? 'sheaf://home')
          }
        />
        <Toolbar
          tab={tab}
          isPrivate={win?.isPrivate ?? false}
          zoom={win?.zoom ?? 1}
          isBookmarked={!!bookmarkForTab}
          theme={settings?.theme ?? 'system'}
          devtoolsSide={win?.devtoolsSide ?? 'bottom'}
          downloadCount={downloadCount}
          devices={[...DEVICE_PRESETS, ...(settings?.customDevices ?? [])]}
          onNavigate={(input) => tab && void api.invoke('tabs:navigate', tab.id, input)}
          onBack={() => tab && void api.invoke('tabs:back', tab.id)}
          onForward={() => tab && void api.invoke('tabs:forward', tab.id)}
          onReload={() => tab && void api.invoke('tabs:reload', tab.id)}
          onReloadMenu={() => tab && void api.invoke('tabs:reloadMenu', tab.id)}
          onStop={() => tab && void api.invoke('tabs:stop', tab.id)}
          onHome={() => tab && void api.invoke('tabs:navigate', tab.id, settings?.homePage ?? 'sheaf://home')}
          onCycleTheme={() => void cycleTheme()}
          onToggleBookmark={() => void toggleBookmark()}
          onResetZoom={() => tab && void api.invoke('tabs:zoom', tab.id, 'reset')}
          onToggleDevTools={() => tab && void api.invoke('tabs:devtools', tab.id)}
          onDevToolsSide={(side) => void api.invoke('tabs:devtoolsSide', side)}
          onDevice={(deviceId) => {
            if (!tab) return
            if (deviceId === MANAGE_DEVICES) {
              void api.invoke('tabs:create', 'sheaf://devices')
              return
            }
            void api.invoke('tabs:device', tab.id, deviceId)
          }}
          onDownloads={() => void api.invoke('tabs:create', 'sheaf://downloads')}
          actions={PLUGINS.map((p) => (
            <button
              key={p.id}
              className={`plugin-btn${openPluginId === p.id ? ' on' : ''}${
                p.id === 'letterhead' && liveIds.length > 0 ? ' live' : ''
              }${p.id === 'letterhead' && lhPulse ? ' fired' : ''}`}
              title={
                p.id === 'letterhead' && liveIds.length > 0
                  ? `${p.name} — ${liveIds.length} rule${liveIds.length > 1 ? 's' : ''} active on this page`
                  : `${p.name} — ${p.descriptor}`
              }
              onClick={() => setOpenPluginId(openPluginId === p.id ? null : p.id)}
            >
              {p.name[0]}
              {p.id === 'letterhead' && badge > 0 && <span className="plugin-badge">{badge}</span>}
            </button>
          ))}
        />
        {showBar && !win?.isPrivate && (
          <BookmarksBar
            bookmarks={bookmarks}
            onOpen={(url) => tab && void api.invoke('tabs:navigate', tab.id, url)}
            onRemove={async (id) => {
              await api.invoke('bookmarks:remove', id)
              await refreshBookmarks()
            }}
          />
        )}
        {win?.find && (
          <FindBar
            find={win.find}
            onQuery={(q, forward, findNext) => void api.invoke('find:query', q, forward, findNext)}
            onClose={() => void api.invoke('find:stop')}
          />
        )}
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* The page is a native view composited over this element. */}
        <div className="viewport" />
        <PluginDock openId={openPluginId} onClose={() => setOpenPluginId(null)} />
      </div>
    </div>
  )
}
