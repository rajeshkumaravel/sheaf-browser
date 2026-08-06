import { useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import type { DevicePreset } from '@shared/devices'
import type { DevToolsSide, ThemeMode, TabState } from '@shared/types'
import pkg from '../../../../package.json'

/** Sentinel option: opens the device manager instead of selecting a device. */
export const MANAGE_DEVICES = '__manage__'

interface Props {
  tab: TabState | null
  isPrivate: boolean
  zoom: number
  isBookmarked: boolean
  theme: ThemeMode
  devtoolsSide: DevToolsSide
  downloadCount: number
  /** Built-ins plus the user's own profiles. */
  devices: DevicePreset[]
  onNavigate: (input: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  /** Right-click the reload button → native three-way reload menu. */
  onReloadMenu: () => void
  onStop: () => void
  onHome: () => void
  onCycleTheme: () => void
  onToggleBookmark: () => void
  onResetZoom: () => void
  onToggleDevTools: () => void
  onDevToolsSide: (side: DevToolsSide) => void
  onDevice: (deviceId: string | null) => void
  onDownloads: () => void
  /** Plugin toggle buttons, rendered after the omnibox. */
  actions?: ReactNode
}

const THEME_ICON: Record<ThemeMode, string> = { dark: '☾', light: '☀︎', system: '◐' }

export function Toolbar({
  tab,
  isPrivate,
  zoom,
  isBookmarked,
  theme,
  devtoolsSide,
  downloadCount,
  devices,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onReloadMenu,
  onStop,
  onHome,
  onCycleTheme,
  onToggleBookmark,
  onResetZoom,
  onToggleDevTools,
  onDevToolsSide,
  onDevice,
  onDownloads,
  actions
}: Props): JSX.Element {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const omniRef = useRef<HTMLDivElement>(null)

  // Follow the tab's URL unless the user is mid-edit — clobbering what someone
  // is typing because a page finished loading is maddening.
  useEffect(() => {
    if (!editing) setDraft(tab?.url && tab.url !== 'about:blank' ? tab.url : '')
  }, [tab?.url, tab?.id, editing])

  /**
   * The dropdown is a native view positioned by main, so main needs this
   * element's rect. Measured from the DOM, so CSS stays the source of truth.
   */
  const anchor = () => {
    const r = omniRef.current?.getBoundingClientRect()
    return r
      ? { x: r.left, y: r.bottom + 2, width: r.width, height: 0 }
      : { x: 0, y: 0, width: 0, height: 0 }
  }

  const queryOmnibox = (text: string) => {
    if (text.trim()) void window.sheaf.invoke('omnibox:query', text, anchor())
    else void window.sheaf.invoke('omnibox:close')
  }

  return (
    <div className="toolbar">
      <button
        className="nav-btn"
        onClick={onBack}
        disabled={!tab?.canGoBack}
        aria-label="Back"
        title="Back"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
          <path
            d="M10 3L5 8l5 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        className="nav-btn"
        onClick={onForward}
        disabled={!tab?.canGoForward}
        aria-label="Forward"
        title="Forward"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
          <path
            d="M6 3l5 5-5 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        className="nav-btn"
        onClick={tab?.loading ? onStop : onReload}
        onContextMenu={(e) => {
          if (!tab) return
          e.preventDefault()
          onReloadMenu()
        }}
        disabled={!tab}
        aria-label={tab?.loading ? 'Stop' : 'Reload'}
        title={tab?.loading ? 'Stop' : 'Reload'}
      >
        {tab?.loading ? (
          <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden>
            <path d="M1 1l11 11M12 1L1 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
            <path
              d="M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 2v3h-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
      <button className="nav-btn" onClick={onHome} aria-label="Home" title="Home">
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
          <path
            d="M2.5 7.5L8 3l5.5 4.5M4 6.5V13h8V6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div className="omnibox" ref={omniRef}>
        {isPrivate && (
          <span className="private-badge">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path
                d="M2 4.5V3a3 3 0 016 0v1.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <rect x="1.5" y="4.5" width="7" height="4.5" rx="1" fill="currentColor" />
            </svg>
            Private
          </span>
        )}
        <input
          ref={inputRef}
          value={draft}
          spellCheck={false}
          placeholder="Search or enter address"
          onChange={(e) => {
            setDraft(e.target.value)
            queryOmnibox(e.target.value)
          }}
          onFocus={(e) => {
            setEditing(true)
            e.target.select()
          }}
          onBlur={() => {
            setEditing(false)
            void window.sheaf.invoke('omnibox:close')
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              // Main owns the selection: the list lives in a different renderer,
              // so the two must not each keep their own idea of what's picked.
              e.preventDefault()
              void window.sheaf.invoke('omnibox:move', e.key === 'ArrowDown' ? 1 : -1)
            } else if (e.key === 'Enter' && draft.trim()) {
              e.preventDefault()
              // Pass the text: main's suggestions may lag a keystroke behind,
              // and it must never navigate somewhere that wasn't typed.
              void window.sheaf.invoke('omnibox:accept', draft)
              inputRef.current?.blur()
            } else if (e.key === 'Escape') {
              setDraft(tab?.url ?? '')
              void window.sheaf.invoke('omnibox:close')
              inputRef.current?.blur()
            }
          }}
        />
        {/* Zoom only appears when it's not 100% — an always-on indicator is noise. */}
        {Math.abs(zoom - 1) > 0.01 && (
          <button className="zoom-chip" onClick={onResetZoom} title="Reset zoom (⌘0)">
            {Math.round(zoom * 100)}%
          </button>
        )}
        <button
          className={`star${isBookmarked ? ' on' : ''}`}
          onClick={onToggleBookmark}
          disabled={!tab || !tab.url || tab.url === 'about:blank'}
          title={isBookmarked ? 'Remove bookmark' : 'Bookmark this page (⌘D)'}
          aria-label="Bookmark"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
            <path
              d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"
              fill={isBookmarked ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {/* Device simulation — presets only; throttling/touch live in DevTools. */}
      <select
        className="device-select"
        value={tab?.deviceId ?? ''}
        disabled={!tab}
        title="Device simulation"
        onChange={(e) => onDevice(e.target.value || null)}
      >
        <option value="">Desktop</option>
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
        <option value={MANAGE_DEVICES}>Manage devices…</option>
      </select>

      <button
        className={`nav-btn${tab?.devtoolsOpen ? ' on' : ''}`}
        onClick={onToggleDevTools}
        disabled={!tab}
        aria-label="Toggle DevTools"
        title="DevTools (⌥⌘I)"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
          <path
            d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {tab?.devtoolsOpen && (
        <button
          className="nav-btn dock-side"
          onClick={() => onDevToolsSide(devtoolsSide === 'bottom' ? 'right' : 'bottom')}
          aria-label="DevTools dock side"
          title={`Dock DevTools to the ${devtoolsSide === 'bottom' ? 'right' : 'bottom'}`}
        >
          {devtoolsSide === 'bottom' ? '⊥' : '⊢'}
        </button>
      )}

      <button
        className="nav-btn dl-btn"
        onClick={onDownloads}
        aria-label="Downloads"
        title="Downloads (⌘⇧J)"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
          <path
            d="M8 2v8M4.5 7L8 10.5 11.5 7M3 13h10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {downloadCount > 0 && <span className="plugin-badge">{downloadCount}</span>}
      </button>

      <button
        className="nav-btn theme-btn"
        onClick={onCycleTheme}
        aria-label="Toggle theme"
        title={`Theme: ${theme} (click to change)`}
      >
        {THEME_ICON[theme]}
      </button>
      {actions}
      <span
        style={{
          fontSize: '11px',
          padding: '2px 8px',
          borderRadius: '10px',
          background: 'rgba(59, 130, 246, 0.15)',
          color: '#60a5fa',
          border: '1px solid rgba(96, 165, 250, 0.3)',
          fontWeight: 500,
          marginLeft: '6px',
          whiteSpace: 'nowrap'
        }}
      >
        v{pkg.version} • release check
      </span>
    </div>
  )
}
