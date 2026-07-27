/**
 * Loads the product site in a real Chromium (via Electron) at a desktop
 * viewport, scrolls to several depths of the scrub, and saves screenshots to
 * the scratch dir so the scroll animation can be eyeballed. Verification only —
 * ships nothing.
 *
 *     node scripts/verify-site.mjs <outDir>
 */
import { _electron as electron } from 'playwright-core'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = process.argv[2] || path.join(ROOT, '.site-verify')
fs.mkdirSync(OUT, { recursive: true })

const electronBin =
  process.platform === 'darwin'
    ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : path.join(ROOT, 'node_modules/electron/dist/electron')

const app = await electron.launch({
  executablePath: electronBin,
  args: ['--no-sandbox', ROOT],
  env: { ...process.env, SHEAF_USER_DATA: path.join(ROOT, '.site-verify-profile') },
  timeout: 40_000
})
await app.firstWindow()

const indexFile = path.join(ROOT, 'site', 'index.html')
await app.evaluate(async ({ BrowserWindow }, file) => {
  globalThis.__site = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    useContentSize: true,
    webPreferences: { contextIsolation: false, offscreen: false }
  })
  await globalThis.__site.loadFile(file)
}, indexFile)

// Wait for the loader to clear (eager frames decoded).
await app.evaluate(async () => {
  const wc = globalThis.__site.webContents
  for (let i = 0; i < 100; i++) {
    const done = await wc.executeJavaScript(`document.getElementById('loader').classList.contains('is-done')`)
    if (done) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('loader never finished')
})

// Progress points across the scrub, plus hero (-1) and CTA/grid (2).
const POINTS = [
  ['hero', -1],
  ['p10', 0.1],
  ['p25', 0.25],
  ['p45', 0.45],
  ['p62', 0.62],
  ['p78', 0.78],
  ['p95', 0.95],
  ['cta', 2]
]

for (const [name, p] of POINTS) {
  const b64 = await app.evaluate(async (_e, pp) => {
    const wc = globalThis.__site.webContents
    await wc.executeJavaScript(`(() => {
      const s = document.querySelector('.section--scrub')
      let y
      if (${pp} < 0) y = 0
      else if (${pp} > 1) y = s.offsetTop + s.offsetHeight + innerHeight * 0.4
      else y = s.offsetTop + ${pp} * (s.offsetHeight - innerHeight)
      scrollTo({ top: y, behavior: 'instant' })
      return y
    })()`)
    // Let the lerp settle and any straggler frames decode.
    await new Promise((r) => setTimeout(r, 1200))
    const img = await wc.capturePage()
    return img.toPNG().toString('base64')
  }, p)
  fs.writeFileSync(path.join(OUT, `site-${name}.png`), Buffer.from(b64, 'base64'))
  console.log(`captured ${name}`)
}

await app.evaluate(() => globalThis.__site?.destroy()).catch(() => {})
await app.close().catch(() => {})
fs.rmSync(path.join(ROOT, '.site-verify-profile'), { recursive: true, force: true })
console.log(`\nscreenshots -> ${OUT}`)
