import type { CSSProperties, JSX } from 'react'
import type { TabState } from '@shared/types'
import { greetingFor, sceneGradient, skyIcon, timeOfDay } from '@shared/skyArt'

interface Props {
  tabs: TabState[]
  activeTabId: string | null
  userName: string | null
  updatePercent: number | null
  updateReady: boolean
  updateError: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  onContextMenu: (id: string) => void
  onGreetingClick: () => void
}

export function TabStrip({
  tabs,
  activeTabId,
  userName,
  updatePercent,
  updateReady,
  updateError,
  onSelect,
  onClose,
  onNew,
  onContextMenu,
  onGreetingClick
}: Props): JSX.Element {
  const updateLabel = updateError
    ? 'Update failed'
    : updateReady
      ? 'Restart to update'
      : updatePercent !== null
        ? `Updating ${updatePercent}%`
        : null

  return (
    <div
      className="tabstrip"
      style={
        // Leave room for the macOS traffic lights.
        window.sheaf.platform === 'darwin'
          ? ({ '--tabstrip-inset': '78px' } as CSSProperties)
          : undefined
      }
    >
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab${tab.id === activeTabId ? ' active' : ''}`}
          onMouseDown={(e) => {
            // Middle-click closes, as everywhere else.
            if (e.button === 1) {
              e.preventDefault()
              onClose(tab.id)
            } else if (e.button === 0) {
              onSelect(tab.id)
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            onSelect(tab.id)
            onContextMenu(tab.id)
          }}
          title={tab.title || tab.url}
        >
          {tab.favicon ? (
            <img
              className="tab-favicon"
              src={tab.favicon}
              alt=""
              onError={(e) => {
                e.currentTarget.style.visibility = 'hidden'
              }}
            />
          ) : (
            <span className="tab-favicon-blank" />
          )}
          <span className="tab-title">{tab.loading && !tab.title ? 'Loading…' : tab.title}</span>
          <button
            className="tab-close"
            aria-label="Close tab"
            onMouseDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
            }}
            onClick={(e) => {
              e.stopPropagation()
              onClose(tab.id)
            }}
          >
            <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden>
              <path
                d="M1 1l7 7M8 1L1 8"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      ))}
      <button className="tab-new" onClick={onNew} aria-label="New tab" title="New tab (⌘T)">
        <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden>
          <path
            d="M6.5 1v11M1 6.5h11"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {/* The greeting lives here, not in the URL bar: the toolbar is already
          dense (device, devtools, downloads, theme, four plugins) and the
          omnibox must stay a wide, clean text field. The tab strip's right side
          is otherwise empty drag area — ambient info belongs there. */}
      <span className="strip-spacer" />
      {(userName || updateLabel) && (
        <button
          className="greet-chip"
          onClick={onGreetingClick}
          title={updateError ?? (updateReady ? 'Update ready — restart to apply' : 'Go home')}
          // A slice of the home page's sky, same generated gradient.
          style={{ ['--sky' as string]: sceneGradient(timeOfDay(new Date().getHours())) }}
        >
          <span
            className="greet-icon"
            // Our own generated SVG, chosen from the system clock — no network,
            // no remote asset, no licence question. 'ui' inherits currentColor:
            // the scene colours are near-white and vanish on a light toolbar.
            dangerouslySetInnerHTML={{
              __html: skyIcon(timeOfDay(new Date().getHours()), 15, 'ui')
            }}
          />
          <span className="greet-text">
            {userName ? (
              <>
                {greetingFor(new Date().getHours())}, <b>{userName}</b>
              </>
            ) : (
              <>Update status</>
            )}
          </span>
          {updateLabel && (
            <span className={`greet-update${updateReady ? ' greet-update-ready' : ''}`}>{updateLabel}</span>
          )}
        </button>
      )}
    </div>
  )
}
