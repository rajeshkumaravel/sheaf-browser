import { join } from 'node:path'
import { app } from 'electron'

export function userDataDir(): string {
  return app.getPath('userData')
}

/**
 * Local, gitignored config. PUBLIC REPO: internal hostnames, proxy settings and
 * environment profiles live here — never in the repository.
 */
export function localConfigPath(): string {
  return join(userDataDir(), 'sheaf.local.json')
}

/** Where user-uploaded Chrome extensions are unpacked to. */
export function extensionsDir(): string {
  return join(userDataDir(), 'extensions')
}
