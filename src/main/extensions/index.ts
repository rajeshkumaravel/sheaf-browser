import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import type { Session } from 'electron'
import type { InstalledExtension } from '@shared/types'
import { extensionsDir } from '../paths'
import { crxToZip } from './crx'

/**
 * Loads user-supplied, unpacked Chrome extensions.
 *
 * Electron's support is deliberately narrow (unpacked only, not remembered
 * across restarts, a subset of the chrome.* APIs). So we own a registry and
 * re-load every enabled extension on each boot. We support .crx files by
 * unpacking them ourselves — a CRX is a header + ZIP — because Electron will not
 * load a .crx directly.
 */

interface RegistryEntry {
  installId: string
  name: string
  version: string
  enabled: boolean
}

function registryPath(): string {
  return join(extensionsDir(), 'registry.json')
}

function readRegistry(): RegistryEntry[] {
  try {
    return JSON.parse(readFileSync(registryPath(), 'utf8')) as RegistryEntry[]
  } catch {
    return []
  }
}

function writeRegistry(entries: RegistryEntry[]): void {
  mkdirSync(extensionsDir(), { recursive: true })
  writeFileSync(registryPath(), JSON.stringify(entries, null, 2))
}

function unpackedDir(installId: string): string {
  return join(extensionsDir(), installId)
}

/**
 * A CRX may put the manifest under a subdirectory. Electron needs the dir that
 * directly contains manifest.json.
 */
function manifestDir(root: string): string {
  if (existsSync(join(root, 'manifest.json'))) return root
  // One level down (some archives wrap everything in a folder).
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(root, entry.name, 'manifest.json'))) {
        return join(root, entry.name)
      }
    }
  } catch {
    /* ignore */
  }
  return root
}

/** The default (non-private) session extensions load into, set once at boot. */
let targetSession: Session | null = null
/** installId → the loaded Chrome extension id, for removal/toggle. */
const loaded = new Map<string, string>()
const errors = new Map<string, string>()

export function setExtensionSession(ses: Session): void {
  targetSession = ses
}

async function loadOne(entry: RegistryEntry): Promise<void> {
  if (!targetSession || !entry.enabled) return
  try {
    const dir = manifestDir(unpackedDir(entry.installId))
    const ext = await targetSession.extensions.loadExtension(dir, { allowFileAccess: true })
    loaded.set(entry.installId, ext.id)
    errors.delete(entry.installId)
  } catch (err) {
    errors.set(entry.installId, err instanceof Error ? err.message : String(err))
  }
}

/** Re-load every enabled extension. Call once, after the target session is set. */
export async function loadAllExtensions(): Promise<void> {
  for (const entry of readRegistry()) await loadOne(entry)
}

export function listExtensions(): InstalledExtension[] {
  return readRegistry().map((e) => ({
    installId: e.installId,
    chromeId: loaded.get(e.installId) ?? null,
    name: e.name,
    version: e.version,
    enabled: e.enabled,
    error: errors.get(e.installId)
  }))
}

/**
 * Install from a .crx file or an unpacked extension directory. The source is
 * copied into our own store so a later move/delete of the original can't break
 * the installed extension.
 */
export async function installExtension(sourcePath: string): Promise<InstalledExtension[]> {
  const installId = randomUUID()
  const dest = unpackedDir(installId)
  mkdirSync(dest, { recursive: true })

  if (sourcePath.toLowerCase().endsWith('.crx') || sourcePath.toLowerCase().endsWith('.zip')) {
    new AdmZip(crxToZip(sourcePath)).extractAllTo(dest, true)
  } else {
    cpSync(sourcePath, dest, { recursive: true })
  }

  const mDir = manifestDir(dest)
  const manifestFile = join(mDir, 'manifest.json')
  if (!existsSync(manifestFile)) {
    rmSync(dest, { recursive: true, force: true })
    throw new Error('No manifest.json found in the extension')
  }
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as { name?: string; version?: string }

  const entry: RegistryEntry = {
    installId,
    name: manifest.name ?? 'Unnamed extension',
    version: manifest.version ?? '0.0.0',
    enabled: true
  }
  writeRegistry([...readRegistry(), entry])
  await loadOne(entry)
  return listExtensions()
}

export async function setExtensionEnabled(installId: string, enabled: boolean): Promise<InstalledExtension[]> {
  const entries = readRegistry().map((e) => (e.installId === installId ? { ...e, enabled } : e))
  writeRegistry(entries)
  const entry = entries.find((e) => e.installId === installId)
  const chromeId = loaded.get(installId)

  if (!enabled && chromeId && targetSession) {
    targetSession.extensions.removeExtension(chromeId)
    loaded.delete(installId)
  } else if (enabled && entry) {
    await loadOne(entry)
  }
  return listExtensions()
}

export function removeExtension(installId: string): InstalledExtension[] {
  const chromeId = loaded.get(installId)
  if (chromeId && targetSession) targetSession.extensions.removeExtension(chromeId)
  loaded.delete(installId)
  errors.delete(installId)
  writeRegistry(readRegistry().filter((e) => e.installId !== installId))
  rmSync(unpackedDir(installId), { recursive: true, force: true })
  return listExtensions()
}
