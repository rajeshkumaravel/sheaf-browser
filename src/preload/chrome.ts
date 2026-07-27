import { contextBridge, ipcRenderer } from 'electron'
import type { ChromeCommand, InvokeFn, IpcResult } from '@shared/ipc'
import {
  PUSH_COMMAND,
  PUSH_DOWNLOADS,
  PUSH_LETTERHEAD,
  PUSH_LETTERHEAD_FIRED,
  PUSH_OMNIBOX,
  PUSH_SETTINGS,
  PUSH_WINDOW_STATE
} from '@shared/ipc'
import type { AppSettings, OmniboxState, UpdateStatus, WindowState } from '@shared/types'

/**
 * Preload for the browser chrome UI only. Never attached to web content —
 * see preload/content.ts for that.
 *
 * The renderer's entire surface is one typed invoke plus one subscription.
 */
const invoke: InvokeFn = async (channel, ...args) => {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<never>
  if (!result.ok) throw new Error(result.error)
  return result.data
}

function onWindowState(cb: (state: WindowState) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, state: WindowState) => cb(state)
  ipcRenderer.on(PUSH_WINDOW_STATE, listener)
  return () => ipcRenderer.off(PUSH_WINDOW_STATE, listener)
}

function onDownloads(cb: () => void): () => void {
  const listener = () => cb()
  ipcRenderer.on(PUSH_DOWNLOADS, listener)
  return () => ipcRenderer.off(PUSH_DOWNLOADS, listener)
}

/** Menu items whose action lives in the renderer (bookmarks UI state). */
function onCommand(cb: (cmd: ChromeCommand) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, cmd: ChromeCommand) => cb(cmd)
  ipcRenderer.on(PUSH_COMMAND, listener)
  return () => ipcRenderer.off(PUSH_COMMAND, listener)
}

/** Only the overlay renderer listens to this one. */
function onOmnibox(cb: (state: OmniboxState) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, state: OmniboxState) => cb(state)
  ipcRenderer.on(PUSH_OMNIBOX, listener)
  return () => ipcRenderer.off(PUSH_OMNIBOX, listener)
}

/** Settings changed anywhere — including from an internal page. */
function onSettings(cb: (s: AppSettings) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, s: AppSettings) => cb(s)
  ipcRenderer.on(PUSH_SETTINGS, listener)
  return () => ipcRenderer.off(PUSH_SETTINGS, listener)
}

/** Letterhead rules changed in some window — global state, re-read it. */
function onLetterheadState(cb: (s: unknown) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, s: unknown) => cb(s)
  ipcRenderer.on(PUSH_LETTERHEAD, listener)
  return () => ipcRenderer.off(PUSH_LETTERHEAD, listener)
}

/** Ids of Letterhead rules that just modified a real request. */
function onLetterheadFired(cb: (ids: string[]) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, ids: string[]) => cb(ids)
  ipcRenderer.on(PUSH_LETTERHEAD_FIRED, listener)
  return () => ipcRenderer.off(PUSH_LETTERHEAD_FIRED, listener)
}

function onUpdateStatus(cb: (status: UpdateStatus) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, status: UpdateStatus) => cb(status)
  ipcRenderer.on('update-status', listener)
  return () => ipcRenderer.off('update-status', listener)
}

contextBridge.exposeInMainWorld('sheaf', {
  invoke,
  onWindowState,
  onDownloads,
  onCommand,
  onOmnibox,
  onSettings,
  onLetterheadFired,
  onLetterheadState,
  onUpdateStatus,
  // The renderer is sandboxed and has no `process`; it still needs to know the
  // platform for things like leaving room for the macOS traffic lights.
  platform: process.platform
})
