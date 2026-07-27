/**
 * Verifies the kinetic grid: loads the site in Electron, captures the hero at
 * rest, then dispatches synthetic mousemove events and captures again — the
 * two images must differ around the cursor. Also captures the CTA grid.
 *
 *     node scripts/verify-grid.mjs <outDir>
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

await app.evaluate(async ({ BrowserWindow }, file) => {
  globalThis.__site = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    useContentSize: true,
    webPreferences: { contextIsolation: false, offscreen: false }
  })
  await globalThis.__site.loadFile(file)
}, path.join(ROOT, 'site', 'index.html'))

const run = (js) => app.evaluate((_e, code) => globalThis.__site.webContents.executeJavaScript(code), js)
const shot = async (name) => {
  const b64 = await app.evaluate(async () => {
    const img = await globalThis.__site.webContents.capturePage()
    return img.toPNG().toString('base64')
  })
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(b64, 'base64'))
  console.log(`captured ${name}`)
}

// Wait for the loader to clear.
await app.evaluate(async () => {
  const wc = globalThis.__site.webContents
  for (let i = 0; i < 100; i++) {
    if (await wc.executeJavaScript(`document.getElementById('loader').classList.contains('is-done')`)) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('loader never finished')
})

// Hero at rest (give the grid time to settle/sleep).
await new Promise((r) => setTimeout(r, 1500))
await shot('grid-hero-idle')

// Synthetic cursor over the hero's left half, clear of the headline.
await run(`(() => {
  const fire = (x, y) => window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }))
  let i = 0
  const id = setInterval(() => {
    fire(280 + i * 4, 380 + Math.sin(i / 4) * 30)
    if (++i > 20) clearInterval(id)
  }, 16)
})()`)
await new Promise((r) => setTimeout(r, 900))
await shot('grid-hero-cursor')

// CTA section with the cursor mid-grid.
await run(`(() => {
  const cta = document.querySelector('.section--cta')
  scrollTo({ top: cta.offsetTop, behavior: 'instant' })
  return true
})()`)
await new Promise((r) => setTimeout(r, 600))
await run(`window.dispatchEvent(new MouseEvent('mousemove', { clientX: 1050, clientY: 620 }))`)
await new Promise((r) => setTimeout(r, 900))
await shot('grid-cta-cursor')

await app.evaluate(() => globalThis.__site?.destroy()).catch(() => {})
await app.close().catch(() => {})
fs.rmSync(path.join(ROOT, '.site-verify-profile'), { recursive: true, force: true })
console.log(`\nscreenshots -> ${OUT}`)
