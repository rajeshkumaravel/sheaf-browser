import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, app, nativeTheme } from 'electron'
import { setCustomDevices } from '@shared/devices'
import { getAppSettings } from './store/repositories/settings'
import {
  register as registerLetterhead,
  setFireListener as setLetterheadFireListener
} from '@plugins/letterhead/main'
import { PUSH_LETTERHEAD_FIRED } from '@shared/ipc'
import { register as registerMailroom } from '@plugins/mailroom/main'
import { loadAllExtensions } from './extensions'
import { registerIpcHandlers } from './ipc'
import { buildAppMenu } from './menus/appMenu'
import { registerInternalScheme } from './protocols/internal'
import { closeStore, initStore } from './store/sqlite'
import { SheafWindow, allWindows } from './windows/window'
import { initUpdater } from './updater';

// Dev runs otherwise report "Electron" in menus and the taskbar.
app.setName('Sheaf Browser')

// Test hook: lets automated runs isolate their profile.
if (process.env.SHEAF_USER_DATA) app.setPath('userData', process.env.SHEAF_USER_DATA)

// MUST be before app.ready — see protocols/internal.ts
registerInternalScheme()

const devIcon = join(__dirname, '../../resources/icon.png')

app.whenReady().then(() => {
  if (process.platform === 'darwin' && !app.isPackaged && existsSync(devIcon)) {
    app.dock?.setIcon(devIcon)
  }

  initStore(app.getPath('userData'))

  const settings = getAppSettings()
  // Apply the saved theme to Chromium itself, so prefers-color-scheme is right
  // from the first paint rather than flipping after the renderer boots.
  nativeTheme.themeSource = settings.theme
  // Register user devices so emulation resolves their ids, not just built-ins.
  setCustomDevices(settings.customDevices)

  // Plugins register their hooks with the host once, before any window exists;
  // the host then attaches itself to each session as windows are created.
  registerLetterhead()
  registerMailroom()

  // Tell every window which rules just touched a request, so the toolbar icon
  // and the matching rows can ripple.
  setLetterheadFireListener((ids) => {
    for (const w of allWindows()) {
      if (!w.win.isDestroyed()) w.win.webContents.send(PUSH_LETTERHEAD_FIRED, ids)
    }
  })

  registerIpcHandlers()
  buildAppMenu()
  // sheaf:// and the plugin host are wired per-session, in SheafWindow.

  const mainWindow = new SheafWindow()

  if (app.isPackaged) {
    initUpdater(mainWindow.win)
  }

  // The window's constructor set the target session; load user extensions into
  // it. Electron doesn't remember them across restarts, so this runs every boot.
  void loadAllExtensions()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) new SheafWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  for (const w of allWindows()) w.tabs.dispose()
})

app.on('quit', () => closeStore())
