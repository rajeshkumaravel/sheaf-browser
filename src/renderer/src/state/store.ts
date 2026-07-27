import { useEffect, useState } from 'react'
import { create } from 'zustand'
import type { LetterheadState } from '@shared/plugins'
import type { AppSettings, ResolvedTheme, TabState, WindowState } from '@shared/types'

interface AppState {
  settings: AppSettings | null
  window: WindowState | null
  /** Which plugin panel is open in the dock, if any. */
  openPluginId: string | null
  /**
   * Held here rather than inside the panel so the toolbar badge stays live
   * after the panel unmounts.
   */
  letterhead: LetterheadState | null
  /**
   * Rules that just modified a live request. `tick` increments on every push so
   * components can retrigger the ripple even when the same rule fires again.
   */
  letterheadFired: { ids: string[]; tick: number }

  setSettings: (s: AppSettings) => void
  setWindow: (w: WindowState) => void
  setOpenPluginId: (id: string | null) => void
  setLetterhead: (s: LetterheadState) => void
  pushLetterheadFired: (ids: string[]) => void
}

export const useStore = create<AppState>((set) => ({
  settings: null,
  window: null,
  openPluginId: null,
  letterhead: null,
  letterheadFired: { ids: [], tick: 0 },

  setSettings: (settings) => set({ settings }),
  setWindow: (window) => set({ window }),
  setOpenPluginId: (openPluginId) => set({ openPluginId }),
  setLetterhead: (letterhead) => set({ letterhead }),
  pushLetterheadFired: (ids) =>
    set((s) => ({ letterheadFired: { ids, tick: s.letterheadFired.tick + 1 } }))
}))

/** True for `ms` after `tick` changes — drives one-shot CSS animations. */
export function usePulse(tick: number, ms = 700): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (tick === 0) return
    setOn(true)
    const t = setTimeout(() => setOn(false), ms)
    return () => clearTimeout(t)
  }, [tick, ms])
  return on
}

export function activeTab(w: WindowState | null): TabState | null {
  if (!w || !w.activeTabId) return null
  return w.tabs.find((t) => t.id === w.activeTabId) ?? null
}

export function resolveTheme(mode: AppSettings['theme'] | undefined): ResolvedTheme {
  if (mode === 'dark' || mode === 'light') return mode
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}
