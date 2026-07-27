/**
 * Renders the 3D site in a real Chromium (Electron) at several scroll depths
 * and saves screenshots, so the WebGL scene can be eyeballed without the
 * in-app browser. Verification only — ships nothing.
 *
 *   1) npm run site3d:serve          (or: python3 -m http.server 4174 in site-3d)
 *   2) node scripts/verify-site-3d.mjs <outDir> [baseURL]
 */
import { _electron as electron } from 'playwright-core'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = process.argv[2] || path.join(ROOT, '.site3d-verify')
const BASE = process.argv[3] || 'http://localhost:4174'
fs.mkdirSync(OUT, { recursive: true })

const electronBin =
  process.platform === 'darwin'
    ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : process.platform === 'win32'
      ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
      : path.join(ROOT, 'node_modules/electron/dist/electron')

const app = await electron.launch({
  executablePath: electronBin,
  args: ['--no-sandbox', ROOT],
  env: { ...process.env, SHEAF_USER_DATA: path.join(ROOT, '.site3d-verify-profile') },
  timeout: 40_000
})
await app.firstWindow()

const consoleErrors = []
await app.evaluate(async ({ BrowserWindow }, url) => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    useContentSize: true,
    webPreferences: { offscreen: false }
  })
  globalThis.__win = win
  globalThis.__errs = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) globalThis.__errs.push(message) // warnings + errors
  })
  await win.loadURL(url)
}, BASE)

// Let the world init and the loader clear.
await new Promise((r) => setTimeout(r, 2500))

// Scene centres land at p = k/4 (five scenes); hero is above the scrub.
const POINTS = [
  ['hero', -1],
  ['s0-letterhead', 0.02],
  ['s1-folio', 0.25],
  ['s2-imprint', 0.5],
  ['s3-mailroom', 0.75],
  ['s4-browser', 0.98]
]

for (const [name, p] of POINTS) {
  const b64 = await app.evaluate(async (_e, pp) => {
    const wc = globalThis.__win.webContents
    await wc.executeJavaScript(
      '(() => { const s = document.querySelector("#scrub");' +
      ' const y = ' + pp + ' < 0 ? 0 : s.offsetTop + ' + pp + ' * (s.offsetHeight - innerHeight);' +
      ' scrollTo({ top: y, behavior: "instant" }); window.dispatchEvent(new Event("scroll")); return y; })()'
    )
    await new Promise((r) => setTimeout(r, 700))
    const img = await wc.capturePage()
    return img.toPNG().toString('base64')
  }, p)
  fs.writeFileSync(path.join(OUT, `site3d-${name}.png`), Buffer.from(b64, 'base64'))
  console.log(`captured ${name}`)
}

const errs = await app.evaluate(() => globalThis.__errs || [])
if (errs.length) {
  console.log('\nConsole warnings/errors:')
  for (const e of errs.slice(0, 20)) console.log('  -', e)
} else {
  console.log('\nNo console warnings/errors.')
}

await app.evaluate(() => globalThis.__win?.destroy()).catch(() => {})
await app.close().catch(() => {})
fs.rmSync(path.join(ROOT, '.site3d-verify-profile'), { recursive: true, force: true })
console.log(`\nscreenshots -> ${OUT}`)
