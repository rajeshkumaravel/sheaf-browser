import { StrictMode, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { createRoot } from 'react-dom/client'
import type { OmniboxState } from '@shared/types'
import { Suggestions } from './components/Suggestions'
import { resolveTheme } from './state/store'
import './theme/global.css'

/**
 * Renderer for the omnibox dropdown, which lives in its own native view above
 * the page — see main/windows/overlay.ts for why it can't be a DOM element in
 * the chrome.
 */
function Overlay(): JSX.Element | null {
  const [state, setState] = useState<OmniboxState | null>(null)

  useEffect(() => window.sheaf.onOmnibox(setState), [])

  // This view is separate from the chrome, so it must follow the theme itself.
  useEffect(() => {
    const apply = async () => {
      const s = await window.sheaf.invoke('settings:get')
      document.documentElement.setAttribute('data-theme', resolveTheme(s.theme))
    }
    void apply()
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    mq.addEventListener('change', () => void apply())
    return () => mq.removeEventListener('change', () => void apply())
  }, [])

  if (!state || state.items.length === 0) return null
  return (
    <Suggestions
      state={state}
      // A click is explicit and current, so the index is authoritative here.
      onPick={(i) => void window.sheaf.invoke('omnibox:accept', state.query, i)}
      onHover={(i) => void window.sheaf.invoke('omnibox:select', i)}
    />
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Overlay />
  </StrictMode>
)
