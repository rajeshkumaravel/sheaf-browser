import { useLayoutEffect, useRef } from 'react'
import type { JSX } from 'react'
import { ImprintPanel } from '@plugins/imprint/renderer/Panel'
import { LetterheadPanel } from '@plugins/letterhead/renderer/Panel'
import { MailroomPanel } from '@plugins/mailroom/renderer/Panel'
import type { PluginManifest } from '@shared/plugins'

/**
 * Static registry. First-party plugins are compiled into this bundle — runtime
 * loading buys nothing for code we ship ourselves. The runtime-loading path is
 * third-party Chrome extensions, which is a different mechanism entirely.
 */
export const PLUGINS: (PluginManifest & { Panel: () => JSX.Element })[] = [
  {
    id: 'letterhead',
    name: 'Letterhead',
    descriptor: 'HTTP headers',
    version: '0.1.0',
    Panel: LetterheadPanel
  },
  {
    id: 'imprint',
    name: 'Imprint',
    descriptor: 'Cookies & storage',
    version: '0.1.0',
    Panel: ImprintPanel
  },
  {
    id: 'mailroom',
    name: 'Mailroom',
    descriptor: 'Mock & record',
    version: '0.1.0',
    Panel: MailroomPanel
  }
]

export const DOCK_WIDTH = 340

interface Props {
  openId: string | null
  onClose: () => void
}

export function PluginDock({ openId, onClose }: Props): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const plugin = PLUGINS.find((p) => p.id === openId) ?? null

  // Tell main how much width to give back to the page. Reported from the real
  // measured element so CSS stays the single source of truth.
  useLayoutEffect(() => {
    const px = plugin ? (ref.current?.getBoundingClientRect().width ?? DOCK_WIDTH) : 0
    void window.sheaf.invoke('chrome:dockWidth', px)
  }, [plugin?.id])

  if (!plugin) return null

  return (
    <div className="dock" ref={ref} style={{ width: DOCK_WIDTH }}>
      <div className="dock-head">
        <span className="dock-title">{plugin.name}</span>
        <span className="dock-desc">{plugin.descriptor}</span>
        <button className="dock-close" onClick={onClose} aria-label="Close panel">
          <svg width="10" height="10" viewBox="0 0 9 9" aria-hidden>
            <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="dock-body">
        <plugin.Panel />
      </div>
    </div>
  )
}
