import { app, dialog, shell, BrowserWindow } from 'electron';
import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import type { UpdateStatus } from '@shared/types'

const GITHUB_OWNER = 'rajeshkumaravel';
const GITHUB_REPO = 'sheaf-browser';
const RELEASES_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const FIRST_PROGRESS_TIMEOUT_MS = 30_000

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  assets: GitHubReleaseAsset[];
}

export function initUpdater(mainWindow: BrowserWindow): void {
  if (!app.isPackaged) {
    return;
  }

  // macOS: unsigned app -> Squirrel.Mac rejects updates.
  // Fall back to notify + open download link.
  if (process.platform === 'darwin') {
    void checkMacUpdate(mainWindow);
    setInterval(() => void checkMacUpdate(mainWindow), CHECK_INTERVAL_MS);
    return;
  }

  // Start downloads explicitly on update-available so the flow is deterministic
  // across providers/build variants.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  let waitingForFirstProgress: NodeJS.Timeout | null = null
  const clearProgressWatchdog = () => {
    if (waitingForFirstProgress) {
      clearTimeout(waitingForFirstProgress)
      waitingForFirstProgress = null
    }
  }

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    clearProgressWatchdog()
    sendStatus(mainWindow, { state: 'downloading', version: info.version });
    waitingForFirstProgress = setTimeout(() => {
      sendStatus(mainWindow, {
        state: 'error',
        message: 'Download did not begin (no progress event received).'
      })
      waitingForFirstProgress = null
    }, FIRST_PROGRESS_TIMEOUT_MS)

    void autoUpdater.downloadUpdate().catch((err: Error) => {
      clearProgressWatchdog()
      console.error('[updater] download failed:', err.message);
      sendStatus(mainWindow, { state: 'error', message: err.message })
    });
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    clearProgressWatchdog()
    sendStatus(mainWindow, {
      state: 'progress',
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    clearProgressWatchdog()
    sendStatus(mainWindow, { state: 'ready', version: info.version });
    void promptRestart(mainWindow, info.version);
  });

  autoUpdater.on('error', (err: Error) => {
    clearProgressWatchdog()
    console.error('[updater] error:', err.message);
    sendStatus(mainWindow, { state: 'error', message: err.message })
  });

  void autoUpdater.checkForUpdates();
  setInterval(() => void autoUpdater.checkForUpdates(), CHECK_INTERVAL_MS);
}

function sendStatus(win: BrowserWindow, status: UpdateStatus): void {
  if (!win.isDestroyed()) {
    win.webContents.send('update-status', status);
  }
}

async function promptRestart(
  win: BrowserWindow,
  version: string
): Promise<void> {
  const { response } = await dialog.showMessageBox(win, {
    type: 'info',
    title: 'Update ready',
    message: `Version ${version} has been downloaded.`,
    detail: 'Restart the application to apply the update.',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });

  if (response === 0) {
    autoUpdater.quitAndInstall();
  }
  // "Later" -> installs on next quit via autoInstallOnAppQuit
}

// ---------- macOS fallback ----------

let macPromptShownForVersion: string | null = null;

async function checkMacUpdate(win: BrowserWindow): Promise<void> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      { headers: { Accept: 'application/vnd.github+json' } }
    );
    if (!res.ok) return;

    const release = (await res.json()) as GitHubRelease;
    const latest = release.tag_name.replace(/^v/, '');
    const current = app.getVersion();

    if (!isNewer(latest, current)) return;
    if (macPromptShownForVersion === latest) return; // don't nag every interval
    macPromptShownForVersion = latest;

    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update available',
      message: `Version ${latest} is available (you have ${current}).`,
      detail:
        'Download the new version, then drag it to Applications to replace the current one.',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 0) {
      const dmg = release.assets.find((a) => a.name.endsWith('.dmg'));
      await shell.openExternal(dmg?.browser_download_url ?? RELEASES_URL);
    }
  } catch (err) {
    console.error('[updater] mac check failed:', err);
  }
}

function isNewer(latest: string, current: string): boolean {
  const a = latest.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}