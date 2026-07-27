import type { ChromeCommand, InvokeFn } from '@shared/ipc'
import type { AppSettings, OmniboxState, Platform, UpdateStatus, WindowState } from '@shared/types'

declare global {
  interface Window {
    sheaf: {
      invoke: InvokeFn
      /** Each returns an unsubscribe function. */
      onWindowState: (cb: (state: WindowState) => void) => () => void
      onDownloads: (cb: () => void) => () => void
      onCommand: (cb: (cmd: ChromeCommand) => void) => () => void
      onSettings: (cb: (s: AppSettings) => void) => () => void
      onLetterheadFired: (cb: (ids: string[]) => void) => () => void
      onLetterheadState: (cb: (s: import('@shared/plugins').LetterheadState) => void) => () => void
      onUpdateStatus: (cb: (status: UpdateStatus) => void) => () => void
      /** Only the overlay renderer uses this. */
      onOmnibox: (cb: (state: OmniboxState) => void) => () => void
      platform: Platform
    }
  }
}

export {}
