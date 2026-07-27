import type { MenuItemConstructorOptions } from 'electron'
import { Menu, app, shell } from 'electron'
import { SheafWindow, allWindows, focusedSheafWindow } from '../windows/window'

const isMac = process.platform === 'darwin'

/**
 * The native menu bar. Beyond looking right, this is where a browser's keyboard
 * shortcuts actually belong: accelerators registered here fire even when focus
 * is inside a page's WebContentsView, which a renderer keydown listener never
 * sees.
 */
export function buildAppMenu(): void {
  const withTabs = (fn: (w: SheafWindow, tabId: string) => void) => () => {
    const w = focusedSheafWindow()
    const id = w?.tabs.state().activeTabId
    if (w && id) fn(w, id)
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.getName(),
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => focusedSheafWindow()?.tabs.create()
        },
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => new SheafWindow()
        },
        {
          label: 'New Private Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => new SheafWindow({ private: true })
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: withTabs((w, id) => w.tabs.close(id))
        },
        { role: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W' },
        ...(isMac ? [] : ([{ type: 'separator' }, { role: 'quit' }] as MenuItemConstructorOptions[]))
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find in Page…',
          accelerator: 'CmdOrCtrl+F',
          click: () => focusedSheafWindow()?.tabs.startFind()
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: withTabs((w, id) => w.tabs.reload(id))
        },
        {
          label: 'Force Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: withTabs((w, id) => w.tabs.reload(id, true))
        },
        { type: 'separator' },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: withTabs((w, id) => w.tabs.zoom(id, 'in'))
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: withTabs((w, id) => w.tabs.zoom(id, 'out'))
        },
        {
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click: withTabs((w, id) => w.tabs.zoom(id, 'reset'))
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        {
          label: 'Toggle Developer Tools',
          accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: withTabs((w, id) => w.tabs.toggleDevTools(id))
        }
      ]
    },
    {
      label: 'History',
      submenu: [
        {
          label: 'Back',
          accelerator: isMac ? 'Cmd+Left' : 'Alt+Left',
          click: withTabs((w, id) => w.tabs.back(id))
        },
        {
          label: 'Forward',
          accelerator: isMac ? 'Cmd+Right' : 'Alt+Right',
          click: withTabs((w, id) => w.tabs.forward(id))
        },
        { type: 'separator' },
        {
          label: 'Show All History',
          accelerator: 'CmdOrCtrl+Y',
          click: () => focusedSheafWindow()?.tabs.create('sheaf://history')
        }
      ]
    },
    {
      label: 'Bookmarks',
      submenu: [
        {
          label: 'Bookmark This Page',
          accelerator: 'CmdOrCtrl+D',
          click: () => focusedSheafWindow()?.win.webContents.send('push:command', 'bookmark-page')
        },
        {
          label: 'Show All Bookmarks',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => focusedSheafWindow()?.tabs.create('sheaf://bookmarks')
        },
        {
          label: 'Show Bookmarks Bar',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => focusedSheafWindow()?.win.webContents.send('push:command', 'toggle-bookmarks-bar')
        }
      ]
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'JSON Viewer (Folio)',
          accelerator: 'CmdOrCtrl+Shift+U',
          click: () => focusedSheafWindow()?.tabs.create('sheaf://folio')
        },
        {
          label: 'Extensions',
          click: () => focusedSheafWindow()?.tabs.create('sheaf://extensions')
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        ...(isMac
          ? ([{ role: 'zoom' }, { type: 'separator' }, { role: 'front' }] as MenuItemConstructorOptions[])
          : [])
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Sheaf Browser Help',
          click: () => focusedSheafWindow()?.tabs.create('sheaf://help')
        },
        {
          label: 'About Sheaf Browser',
          click: () => focusedSheafWindow()?.tabs.create('sheaf://about')
        },
        {
          label: 'Downloads',
          accelerator: 'CmdOrCtrl+Shift+J',
          click: () => focusedSheafWindow()?.tabs.create('sheaf://downloads')
        },
        { type: 'separator' },
        {
          label: 'Source Code',
          click: () => void shell.openExternal('https://github.com/rajeshkumaravel/sheaf-browser')
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

export function hasWindows(): boolean {
  return allWindows().length > 0
}
