/**
 * Generates the documentation screenshots by driving the REAL app, so the docs
 * can't drift from what Sheaf actually renders.
 *
 *     npm run screenshots        # writes screenshots/raw/*.png
 *     node scripts/make-walkthrough.mjs   # curates + builds the slider & GIF
 *
 * Compositing, and why it's necessary: a tab's content, the docked DevTools and
 * the omnibox dropdown are each a native WebContentsView composited *over* the
 * chrome. Playwright's page.screenshot() sees only the chrome's DOM (the page
 * area comes out blank), and webContents.capturePage() sees only one view. So we
 * capture the chrome plus every visible view, and paste each at its own bounds.
 */
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const OUT = path.join(APP_DIR, 'screenshots', 'raw')
const TMP = path.join(APP_DIR, '.shot-tmp')
const DATA_DIR = path.join(APP_DIR, '.shot-profile')

for (const d of [OUT, TMP]) fs.rmSync(d, { recursive: true, force: true })
for (const d of [OUT, TMP]) fs.mkdirSync(d, { recursive: true })
fs.rmSync(DATA_DIR, { recursive: true, force: true })

// A local API to demo the tools against — no third-party site required.
const api = http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('set-cookie', 'session_id=8f2c1a; Path=/, theme=dark; Path=/')
  res.setHeader('content-type', 'application/json')
  res.end(
    JSON.stringify(
      {
        order: { id: 'A-10423', status: 'shipped', total: 129.5, currency: 'EUR' },
        customer: { id: 88123, name: 'Rivera', tier: 'gold' },
        items: [
          { sku: 'BILLY-80', qty: 2, price: 49.0 },
          { sku: 'KALLAX-44', qty: 1, price: 31.5 }
        ],
        _requestHeaders: req.headers
      },
      null,
      2
    )
  )
})
await new Promise((r) => api.listen(0, '127.0.0.1', r))
const API = `http://127.0.0.1:${api.address().port}/`

const electronBin =
  process.platform === 'darwin'
    ? path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : path.join(APP_DIR, 'node_modules/electron/dist/electron')

const app = await electron.launch({
  executablePath: electronBin,
  args: ['--no-sandbox', APP_DIR],
  env: { ...process.env, SHEAF_USER_DATA: DATA_DIR },
  timeout: 40_000
})

await app.firstWindow()
let page
for (let i = 0; i < 40; i++) {
  page = app.windows().find((w) => w.url().endsWith('index.html'))
  if (page) break
  await new Promise((r) => setTimeout(r, 250))
}
await page.waitForSelector('.tabstrip', { timeout: 30_000 })

// A consistent canvas for every shot.
await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()[0].setContentSize(1280, 800)
)
await new Promise((r) => setTimeout(r, 400))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const inView = (js) =>
  app.evaluate(async ({ BrowserWindow }, code) => {
    const vs = BrowserWindow.getAllWindows()[0].contentView.children.filter((v) => 'webContents' in v)
    const v = vs.find((x) => x.getVisible?.() !== false) ?? vs[0]
    return v.webContents.executeJavaScript(code)
  }, js)

/** Chrome + every visible native view, composited at their real bounds. */
async function snap(name) {
  await sleep(500)
  const chrome = path.join(TMP, 'chrome.png')
  await page.screenshot({ path: chrome })

  const views = await app.evaluate(async ({ BrowserWindow }) => {
    const out = []
    const vs = BrowserWindow.getAllWindows()[0].contentView.children.filter((v) => 'webContents' in v)
    for (const v of vs) {
      if (v.getVisible?.() === false) continue
      const b = v.getBounds()
      if (b.width < 2 || b.height < 2) continue
      const img = await v.webContents.capturePage()
      out.push({ b, png: img.toPNG().toString('base64') })
    }
    return out
  })

  // page.screenshot is in device pixels; view bounds are CSS px.
  const scale = (await page.evaluate(() => window.devicePixelRatio)) || 1
  const args = [chrome]
  views.forEach((v, i) => {
    const f = path.join(TMP, `v${i}.png`)
    fs.writeFileSync(f, Buffer.from(v.png, 'base64'))
    args.push(f, '-geometry', `+${Math.round(v.b.x * scale)}+${Math.round(v.b.y * scale)}`, '-composite')
  })
  args.push(path.join(OUT, `${name}.png`))
  execFileSync('magick', args)
  console.log('shot:', name)
}

const go = async (url) => {
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill(url)
  await page.keyboard.press('Enter')
  await sleep(1800)
}
const setTheme = (theme) => page.evaluate((t) => window.sheaf.invoke('settings:set', { theme: t }), theme)
const openPanel = async (name) => {
  const sel = `.plugin-btn[title^="${name}"]`
  const cls = { Letterhead: '.lh', Imprint: '.imp', Mailroom: '.mr' }[name]
  if ((await page.locator(cls).count()) === 0) await page.locator(sel).click()
  await page.waitForSelector(cls, { timeout: 8000 })
}
const closePanels = async () => {
  if ((await page.locator('.dock-close').count()) > 0) await page.locator('.dock-close').click()
  await sleep(200)
}

// ---- 1. first launch ----
await snap('welcome')

await inView(
  "(() => { const n=document.getElementById('name'); n.value='Rivera'; n.dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('go').click(); })()"
)
await sleep(1600)

// ---- 2. home, both themes ----
await setTheme('dark')
await snap('home-dark')
await setTheme('light')
await snap('home-light')
await setTheme('dark')

// ---- 3. omnibox suggestions ----
await go(API)
await page.locator('.star').click() // bookmark it, so a suggestion exists
await sleep(400)
await go('example.com')
await page.locator('.omnibox input').click()
await page.locator('.omnibox input').fill('127.0.0.1')
await sleep(900)
await snap('omnibox')
await page.locator('.omnibox input').press('Escape')

// ---- 4. Folio: JSON tree ----
await go(API)
await snap('folio')

// ---- 5. Folio scratchpad ----
await go('sheaf://folio')
await snap('folio-scratchpad')

// ---- 6. Letterhead ----
await go(API)
await page.evaluate(async (apiUrl) => {
  const s = await window.sheaf.invoke('letterhead:get')
  const p = s.profiles[0]
  p.name = 'Default'
  p.enabled = true
  p.rules = [
    { id: 'r1', enabled: true, target: 'request', op: 'append', name: 'User-Agent', value: 'Sheaf-QA', urlFilter: `${apiUrl}*`, comment: '' },
    { id: 'r2', enabled: true, target: 'request', op: 'set', name: 'Authorization', value: 'Bearer eyJhbGciOi…', urlFilter: `${apiUrl}*`, comment: '' },
    { id: 'r3', enabled: true, target: 'response', op: 'set', name: 'Cache-Control', value: 'no-store', urlFilter: 'staging.internal/*', comment: '' }
  ]
  await window.sheaf.invoke('letterhead:set', { profiles: [p], activeProfileId: p.id })
}, API)
await openPanel('Letterhead')
await sleep(700)
await snap('letterhead')

// ---- 7. Imprint ----
await closePanels()
await openPanel('Imprint')
await sleep(800)
await snap('imprint')

// ---- 8. Mailroom ----
await closePanels()
await page.evaluate(async (apiUrl) => {
  await window.sheaf.invoke('mailroom:set', {
    recording: true,
    rules: [
      { id: 'm1', enabled: true, urlFilter: `${apiUrl}orders/*`, action: 'stub', redirectTo: '', delayMs: 0, stubBody: '{"status":"pending","eta":"2d"}', stubContentType: 'application/json', comment: '' },
      { id: 'm2', enabled: true, urlFilter: 'cdn.analytics.example', action: 'block', redirectTo: '', delayMs: 0, stubBody: '', stubContentType: '', comment: '' },
      { id: 'm3', enabled: true, urlFilter: 'api.example.com/slow', action: 'delay', redirectTo: '', delayMs: 2000, stubBody: '', stubContentType: '', comment: '' }
    ]
  })
}, API)
await openPanel('Mailroom')
await sleep(600)
await go(API)
await sleep(600)
await snap('mailroom')

// ---- 9. DevTools docked ----
await closePanels()
await go('example.com')
await page.locator('.nav-btn[aria-label="Toggle DevTools"]').click()
await sleep(3000)
await snap('devtools')
await page.locator('.nav-btn[aria-label="Toggle DevTools"]').click()
await sleep(500)

// ---- 10. device simulation ----
await go(API)
await page.locator('.device-select').selectOption('iphone-15')
await sleep(1800)
await snap('device')
await page.locator('.device-select').selectOption('')
await sleep(800)

// ---- 11. extensions, devices, help, about ----
await go('sheaf://extensions')
await snap('extensions')
await go('sheaf://devices')
await snap('devices')
await go('sheaf://help')
await snap('help')
await go('sheaf://about')
await snap('about')

await app.close().catch(() => {})
api.close()
fs.rmSync(TMP, { recursive: true, force: true })
fs.rmSync(DATA_DIR, { recursive: true, force: true })
console.log('\nRaw screenshots ->', OUT)
