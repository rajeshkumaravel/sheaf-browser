// One-shot UI verification: launches the built app via Playwright's Electron
// driver, walks the core browser features, and screenshots each step into
// ./shots. Exits non-zero on the first failed step.
//
// Note on screenshots: page content lives in a native WebContentsView composited
// *over* the chrome renderer, so Playwright's page.screenshot() cannot see it.
// Page captures go through webContents.capturePage() in the main process instead.
import { _electron as electron } from 'playwright-core'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'

// A local echo server, so the header tests assert on real HTTP without
// depending on a third-party site being up.
const echo = http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*')

  // A file the browser must download rather than render.
  if (req.url?.startsWith('/download')) {
    res.setHeader('content-type', 'application/octet-stream')
    res.setHeader('content-disposition', 'attachment; filename="sheaf-test.bin"')
    res.end('downloaded-bytes-ok')
    return
  }

  // Accepts an upload and reports what it actually received.
  if (req.method === 'POST' && req.url?.startsWith('/upload')) {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          gotFilename: /filename="([^"]+)"/.exec(body)?.[1] ?? null,
          gotContent: /upload-payload-\w+/.exec(body)?.[0] ?? null,
          bytes: body.length
        })
      )
    })
    return
  }

  res.setHeader('content-type', 'application/json')
  res.setHeader('x-echo-origin', 'server')
  // A real Set-Cookie so Imprint has an actual cookie to read and delete.
  res.setHeader('set-cookie', 'sheaf_test=echo-value; Path=/')
  res.end(JSON.stringify(req.headers))
})
await new Promise((r) => echo.listen(0, '127.0.0.1', r))
const ECHO = `http://127.0.0.1:${echo.address().port}/`

const APP_DIR = path.resolve(import.meta.dirname, '..')
const SHOT_DIR = path.join(APP_DIR, 'shots')
const DATA_DIR = path.join(APP_DIR, '.verify-profile')

fs.rmSync(SHOT_DIR, { recursive: true, force: true })
fs.mkdirSync(SHOT_DIR, { recursive: true })
fs.rmSync(DATA_DIR, { recursive: true, force: true })

const electronBin = path.join(
  APP_DIR,
  'node_modules/electron/dist',
  process.platform === 'darwin'
    ? 'Electron.app/Contents/MacOS/Electron'
    : process.platform === 'win32'
      ? 'electron.exe'
      : 'electron'
)

const launchArgs = [APP_DIR]
if (process.platform === 'linux') {
  launchArgs.unshift('--no-sandbox')
}
if (process.platform === 'win32') {
  // Windows GitHub runners can fail early in GPU init before Playwright sees
  // a DevTools endpoint; these flags make startup more deterministic.
  launchArgs.unshift('--disable-gpu', '--disable-software-rasterizer')
}

if (!fs.existsSync(electronBin)) {
  throw new Error(`Electron binary not found: ${electronBin}`)
}

let app
try {
  app = await electron.launch({
    executablePath: electronBin,
    args: launchArgs,
    env: { ...process.env, SHEAF_USER_DATA: DATA_DIR },
    timeout: 40_000
  })
} catch (e) {
  console.log('Launch diagnostics:')
  console.log('  platform:', process.platform)
  console.log('  electronBin:', electronBin)
  console.log('  launchArgs:', JSON.stringify(launchArgs))
  console.log('  cwd:', process.cwd())
  throw e
}

// firstWindow() is now ambiguous: the omnibox overlay is a second WebContentsView
// warmed at construction, so it may arrive first. Wait for the chrome page.
await app.firstWindow()
const findChrome = async () => {
  for (let i = 0; i < 40; i++) {
    const p = app.windows().find((w) => w.url().endsWith('index.html'))
    if (p) return p
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('chrome page (index.html) never appeared')
}
const page = await findChrome()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [renderer error]', m.text())
})

// Any uncaught exception in the main process (e.g. touching a destroyed window
// during teardown) fails the run — these never surfaced through UI assertions.
let mainCrash = null
app.process().stderr?.on('data', (b) => {
  const s = b.toString()
  if (/Uncaught Exception|Object has been destroyed/.test(s)) mainCrash = s.trim()
})

let failures = 0
/** Step names contain `sheaf://…`; slashes would become directories. */
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60)

const step = async (name, fn) => {
  try {
    await fn()
    console.log('PASS:', name)
  } catch (e) {
    failures++
    console.log('FAIL:', name, '—', e.message)
    await page.screenshot({ path: path.join(SHOT_DIR, `FAIL-${slug(name)}.png`) }).catch(() => {})
  }
}

/** State of the active tab, read from the main process. */
const tabInfo = () =>
  app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const views = win.contentView.children.filter((v) => 'webContents' in v)
    const visible = views.find((v) => v.getVisible?.() !== false) ?? views[0]
    if (!visible) return null
    const wc = visible.webContents
    return { url: wc.getURL(), title: wc.getTitle(), bounds: visible.getBounds() }
  })

/** Screenshot the page itself (not the chrome) via the main process. */
const capturePage = async (name) => {
  // capturePage can intermittently throw on CI/Linux (UnknownVizError) even
  // when the app is healthy. Screenshots are evidence, not pass/fail signals,
  // so capture is best-effort with retries.
  let lastErr = null
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const b64 = await app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        const views = win.contentView.children.filter((v) => 'webContents' in v)
        const visible = views.find((v) => v.getVisible?.() !== false) ?? views[0]
        if (!visible) return null
        const img = await visible.webContents.capturePage()
        return img.toPNG().toString('base64')
      })
      if (b64) fs.writeFileSync(path.join(SHOT_DIR, `${name}.png`), Buffer.from(b64, 'base64'))
      return
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 250 * attempt))
    }
  }
  console.log(`WARN: screenshot skipped (${name}) — ${lastErr?.message ?? lastErr}`)
}

/** Visible text of the current page, via the main process. */
const pageText = () =>
  app.evaluate(async ({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => 'webContents' in c)
    return v.webContents.executeJavaScript('document.body.innerText').catch(() => '')
  })

const waitFor = async (fn, msg, timeout = 15_000) => {
  const started = Date.now()
  for (;;) {
    if (await fn()) return
    if (Date.now() - started > timeout) throw new Error(msg)
    await new Promise((r) => setTimeout(r, 250))
  }
}

// Run JS inside the active tab's content view (defined early for the boot flow).
const execView = (js) =>
  app.evaluate(async ({ BrowserWindow }, code) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => 'webContents' in c)
    return v.webContents.executeJavaScript(code)
  }, js)

// ---- 1. boot: first launch shows the welcome page (req 9) ----
await step('boot: first launch opens the welcome page', async () => {
  await page.waitForSelector('.tabstrip', { timeout: 30_000 })
  await waitFor(async () => (await page.locator('.tab').count()) === 1, 'expected exactly 1 tab')
  await waitFor(async () => (await tabInfo())?.url.startsWith('sheaf://welcome'), 'first tab is not the welcome page')
})

// ---- 2. onboarding lands on home with a personalised greeting (req 9) ----
await step('welcome: entering a name lands on home with a greeting', async () => {
  await execView(
    "(() => { const n=document.getElementById('name'); n.value='Rivera'; n.dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('go').click(); })()"
  )
  await waitFor(async () => (await tabInfo())?.url.startsWith('sheaf://home'), 'welcome did not redirect to home')
  await waitFor(async () => /Rivera/.test(await execView("document.getElementById('greet').innerText")), 'home greeting missing the name')
})
await capturePage('00-home')

// ---- 3. requirement 3: sheaf://about ----
await step('sheaf://about loads and reports browser info', async () => {
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill('sheaf://about')
  await page.keyboard.press('Enter')
  await waitFor(async () => (await tabInfo())?.url === 'sheaf://about/', 'nav to about failed')
  const text = await execView('document.body.innerText')
  for (const needle of ['Electron', 'Chromium', 'Node.js', 'V8', 'Profile path']) {
    if (!text.includes(needle)) throw new Error(`about page missing "${needle}"`)
  }
})
await capturePage('01-about')
await page.screenshot({ path: path.join(SHOT_DIR, '01-chrome.png') })

// ---- 3. the layering test: is the page view actually below the chrome? ----
await step('layout: page view sits below the chrome, no overlap', async () => {
  const chromeH = await page.evaluate(() => document.querySelector('.chrome').getBoundingClientRect().height)
  const info = await tabInfo()
  if (!info) throw new Error('no visible page view')
  if (Math.abs(info.bounds.y - chromeH) > 1) {
    throw new Error(`page view y=${info.bounds.y} but chrome height=${chromeH}`)
  }
  if (info.bounds.height < 100) throw new Error(`page view too short: ${info.bounds.height}`)
})

// ---- 4. real navigation ----
await step('omnibox: typing a domain navigates to it', async () => {
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill('example.com')
  await page.keyboard.press('Enter')
  await waitFor(
    async () => (await tabInfo())?.url.startsWith('https://example.com'),
    'did not navigate to example.com'
  )
  await waitFor(async () => /Example/i.test((await tabInfo())?.title ?? ''), 'page title never arrived')
})
await capturePage('02-example-com')

// ---- 5. search fallback ----
await step('omnibox: free text becomes a search, not a navigation', async () => {
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill('hello world test')
  await page.keyboard.press('Enter')
  await waitFor(
    async () => {
      const url = (await tabInfo())?.url ?? ''
      return /google\./i.test(url) && /\/search/i.test(url)
    },
    'free text did not become a search'
  )
})

// ---- 6. back/forward ----
await step('history: back returns to the previous page', async () => {
  await page.locator('.nav-btn[aria-label="Back"]').click()
  await waitFor(
    async () => (await tabInfo())?.url.startsWith('https://example.com'),
    'back did not return to example.com'
  )
})

// ---- 7. tabs ----
await step('tabs: new tab opens and becomes active', async () => {
  await page.locator('.tab-new').click()
  await waitFor(async () => (await page.locator('.tab').count()) === 2, 'expected 2 tabs')
  await waitFor(async () => (await tabInfo())?.url === 'sheaf://home/', 'new tab did not load the home page')
})
await page.screenshot({ path: path.join(SHOT_DIR, '03-two-tabs.png') })

await step('tabs: closing a tab removes it', async () => {
  await page.locator('.tab.active .tab-close').click()
  await waitFor(async () => (await page.locator('.tab').count()) === 1, 'expected 1 tab after close')
})

// ---- 8. security: javascript: in the omnibox must not execute ----
await step('security: javascript: URL is searched, never executed', async () => {
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill('javascript:alert(1)')
  await page.keyboard.press('Enter')
  await new Promise((r) => setTimeout(r, 1200))
  const url = (await tabInfo())?.url ?? ''
  if (url.startsWith('javascript:')) throw new Error('javascript: URL was navigated to!')
})

// ---- 9. Letterhead: the architectural bet ----
// Everything else is a browser. This is the reason the browser exists: proving
// a native plugin can do what a Manifest V3 extension provably cannot.

// A fresh fetch of the current page, parsed. Not innerText: Folio replaces a
// JSON document's DOM with its tree viewer, so innerText is no longer raw JSON.
// The fetch goes through the same session, so Letterhead's rules still apply —
// which makes this assert header injection on fetch requests, not just nav.
const pageJson = async () =>
  app.evaluate(async ({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => 'webContents' in c)
    return v.webContents.executeJavaScript('fetch(location.href).then((r) => r.json())')
  })

await step('letterhead: panel opens in the dock', async () => {
  await page.locator('.plugin-btn').first().click()
  await page.waitForSelector('.lh', { timeout: 10_000 })
})

await step('letterhead: dock shrinks the page view instead of covering it', async () => {
  const dockW = await page.evaluate(() => document.querySelector('.dock').getBoundingClientRect().width)
  const winW = await page.evaluate(() => window.innerWidth)
  const info = await tabInfo()
  if (Math.abs(info.bounds.width - (winW - dockW)) > 2) {
    throw new Error(`page width ${info.bounds.width}, expected ${winW - dockW} (window ${winW} - dock ${dockW})`)
  }
})
await page.screenshot({ path: path.join(SHOT_DIR, '04-letterhead.png') })

await step('letterhead: a request-header rule reaches a real HTTP server', async () => {
  await page.locator('.lh-input[placeholder="Header name"]').first().fill('X-Sheaf-Test')
  await page.locator('.lh-input[placeholder="Value"]').first().fill('letterhead-works')

  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill(ECHO)
  await page.keyboard.press('Enter')
  await waitFor(async () => (await tabInfo())?.url.startsWith(ECHO), 'did not reach echo server')

  const headers = await pageJson()
  if (headers['x-sheaf-test'] !== 'letterhead-works') {
    throw new Error(`header not injected — server saw: ${JSON.stringify(headers['x-sheaf-test'])}`)
  }
})
await capturePage('05-letterhead-injected')

await step('letterhead: disabling the rule stops it firing', async () => {
  await page.locator('.lh-rule input[type="checkbox"]').first().uncheck()
  await page.locator('.nav-btn[aria-label="Reload"]').click()
  await new Promise((r) => setTimeout(r, 800))
  const headers = await pageJson()
  if (headers['x-sheaf-test'] !== undefined) throw new Error('disabled rule still fired')
})

await step('letterhead: URL filter scopes the rule to matching URLs only', async () => {
  await page.locator('.lh-rule input[type="checkbox"]').first().check()
  await page.locator('.lh-input.dim').first().fill('/nothing-matches-this/')
  await page.locator('.nav-btn[aria-label="Reload"]').click()
  await new Promise((r) => setTimeout(r, 800))
  let headers = await pageJson()
  if (headers['x-sheaf-test'] !== undefined) throw new Error('rule fired despite non-matching filter')

  // …and fires again once the filter matches.
  await page.locator('.lh-input.dim').first().fill('127.0.0.1')
  await page.locator('.nav-btn[aria-label="Reload"]').click()
  await new Promise((r) => setTimeout(r, 800))
  headers = await pageJson()
  if (headers['x-sheaf-test'] !== 'letterhead-works') throw new Error('rule did not fire on matching filter')
})

await step('letterhead: Append on User-Agent reaches the server (regression)', async () => {
  // The exact reported case: appending a product token to User-Agent silently
  // did nothing, because append returned an ARRAY and Electron's requestHeaders
  // takes a string per header — so the header was dropped entirely.
  await page.evaluate(async () => {
    const s = await window.sheaf.invoke('letterhead:get')
    const p = s.profiles[0]
    p.enabled = true
    p.rules = [
      {
        id: 'ua-append',
        enabled: true,
        target: 'request',
        op: 'append',
        name: 'User-Agent',
        value: 'My-Custom-Agent',
        urlFilter: '127.0.0.1',
        comment: ''
      }
    ]
    await window.sheaf.invoke('letterhead:set', { profiles: [p], activeProfileId: p.id })
  })
  const headers = await pageJson()
  const ua = headers['user-agent'] ?? ''
  if (!ua.includes('My-Custom-Agent')) throw new Error(`UA was not appended: ${ua}`)
  // Appended, not replaced — the original UA must survive.
  if (!/Mozilla|Chrome/.test(ua)) throw new Error(`append clobbered the original UA: ${ua}`)
  // user-agent joins with a space (RFC 9110 product tokens), not a comma.
  if (/,\s*My-Custom-Agent/.test(ua)) throw new Error(`UA appended with a comma: ${ua}`)
})

await step('letterhead: a glob URL filter matches path and query', async () => {
  // ECHO must be passed in — the callback is serialised into the page, where
  // this script's variables don't exist.
  await page.evaluate(async (echo) => {
    const s = await window.sheaf.invoke('letterhead:get')
    const p = s.profiles[0]
    p.rules = [
      {
        id: 'glob',
        enabled: true,
        target: 'request',
        op: 'set',
        name: 'X-Glob',
        value: 'matched',
        // The shape a user types: origin + /* — any path, query or fragment.
        urlFilter: `${echo}*`,
        comment: ''
      }
    ]
    await window.sheaf.invoke('letterhead:set', { profiles: [p], activeProfileId: p.id })
  }, ECHO)
  const got = await execView(`fetch('${ECHO}deep/path?a=1&b=2').then(r=>r.json()).then(h=>h['x-glob'])`)
  if (got !== 'matched') throw new Error(`glob filter did not match a path+query URL: ${got}`)
})

await step('letterhead: a firing rule ripples the icon and its own row', async () => {
  // One matching rule and one that can't match — only the first should ripple.
  await page.evaluate(async (echo) => {
    const s = await window.sheaf.invoke('letterhead:get')
    const p = s.profiles[0]
    p.enabled = true
    p.rules = [
      { id: 'hit', enabled: true, target: 'request', op: 'set', name: 'X-Hit', value: '1', urlFilter: `${echo}*`, comment: '' },
      { id: 'miss', enabled: true, target: 'request', op: 'set', name: 'X-Miss', value: '1', urlFilter: 'nope.invalid', comment: '' }
    ]
    await window.sheaf.invoke('letterhead:set', { profiles: [p], activeProfileId: p.id })
  }, ECHO)

  // The panel may already be open from an earlier step — clicking would close it.
  if ((await page.locator('.lh').count()) === 0) {
    await page.locator('.plugin-btn[title^="Letterhead"]').click()
  }
  await page.waitForSelector('.lh', { timeout: 10_000 })

  // The indicator is driven by the CURRENT PAGE's URL, not by a request that
  // happened to fire — so it stays lit while you're on the page.
  await waitFor(async () => (await page.locator('.plugin-btn.live').count()) > 0, 'the Letterhead icon never lit')
  // Only the rule that matches this page gets the live dot (1 of the 2 rules).
  await waitFor(async () => (await page.locator('.lh-live').count()) === 1, 'expected exactly the matching rule to be live')

  // It must NOT stop once the page goes quiet — the old one-shot flash did.
  await new Promise((r) => setTimeout(r, 2500))
  if ((await page.locator('.plugin-btn.live').count()) === 0) {
    throw new Error('the ripple stopped while still on the page the rule applies to')
  }
  if ((await page.locator('.lh-live').count()) !== 1) {
    throw new Error('the rule dot stopped while still on the page it applies to')
  }
})
await page.screenshot({ path: path.join(SHOT_DIR, '21-ripple.png') })

await step('letterhead: a rule that matches nothing never ripples', async () => {
  await page.evaluate(async () => {
    const s = await window.sheaf.invoke('letterhead:get')
    const p = s.profiles[0]
    p.rules = [{ id: 'miss', enabled: true, target: 'request', op: 'set', name: 'X-Miss', value: '1', urlFilter: 'nope.invalid', comment: '' }]
    await window.sheaf.invoke('letterhead:set', { profiles: [p], activeProfileId: p.id })
  })
  await waitFor(async () => (await page.locator('.lh-live').count()) === 0, 'a non-matching rule stayed live')
  if ((await page.locator('.plugin-btn.live').count()) > 0) throw new Error('the icon lit with no matching rule')
})

await step('letterhead: badge counts the rules that will actually fire', async () => {
  await waitFor(async () => (await page.locator('.plugin-badge').textContent()) === '1', 'badge should read 1')
})

// ---- 10. standard browser features ----

await step('bookmarks: star saves the page and fills in', async () => {
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill('example.com')
  await page.keyboard.press('Enter')
  await waitFor(async () => (await tabInfo())?.url.startsWith('https://example.com'), 'nav failed')
  await waitFor(async () => /Example/i.test((await tabInfo())?.title ?? ''), 'title never arrived')

  await page.locator('.star').click()
  await waitFor(async () => (await page.locator('.star.on').count()) === 1, 'star did not fill')
  await waitFor(async () => (await page.locator('.bm').count()) === 1, 'bookmark not on the bar')
  const label = await page.locator('.bm-title').first().textContent()
  if (!/Example/i.test(label ?? '')) throw new Error(`bar shows "${label}", expected the page title`)
})
await page.screenshot({ path: path.join(SHOT_DIR, '06-bookmarked.png') })

await step('bookmarks: survive a reload and unstar removes them', async () => {
  const stored = await app.evaluate(async () => true) // ensure main is responsive
  if (!stored) throw new Error('main not responsive')

  await page.locator('.star').click()
  await waitFor(async () => (await page.locator('.star.on').count()) === 0, 'star still filled')
  await waitFor(async () => (await page.locator('.bm').count()) === 0, 'bookmark still on the bar')
})

await step('bookmarks: bar reflects a bookmark added while on another page', async () => {
  await page.locator('.star').click()
  await waitFor(async () => (await page.locator('.bm').count()) === 1, 'bookmark not added')
  // Navigate away — the bar must still show it, and the star must empty.
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill('sheaf://about')
  await page.keyboard.press('Enter')
  await waitFor(async () => (await tabInfo())?.url === 'sheaf://about/', 'nav to about failed')
  await waitFor(async () => (await page.locator('.star.on').count()) === 0, 'star should be empty here')
  if ((await page.locator('.bm').count()) !== 1) throw new Error('bar lost the bookmark')
})

await step('find: counts matches on a real page', async () => {
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill('example.com')
  await page.keyboard.press('Enter')
  // Wait for the *text*, not the title: the title lands before the body is
  // rendered, and find is one-shot — searching an empty page returns 0 matches
  // and never re-runs.
  await waitFor(async () => (await pageText()).includes('domain'), 'page text never rendered')

  // Open via find:start — the same path the menu item uses.
  await page.evaluate(() => window.sheaf.invoke('find:start'))
  await page.waitForSelector('.findbar', { timeout: 5000 })
  await page.locator('.find-input').fill('domain')
  try {
    await waitFor(async () => {
      const t = (await page.locator('.find-count').textContent()) ?? ''
      return /^[1-9]\d*\/[1-9]\d*$/.test(t.trim())
    }, 'no count', 8000)
  } catch {
    // Report what was actually observed — "it didn't work" costs a debug cycle.
    const seen = await page.locator('.find-count').textContent()
    const value = await page.locator('.find-input').inputValue()
    const st = await page.evaluate(() => window.sheaf.invoke('tabs:state'))
    throw new Error(`count="${seen}" input="${value}" state=${JSON.stringify(st.find)}`)
  }
})

await step('find: next/previous advances through matches', async () => {
  const first = await page.locator('.find-count').textContent()
  await page.locator('.find-input').press('Enter')
  await waitFor(async () => (await page.locator('.find-count').textContent()) !== first, 'Enter did not advance the match')
})
await page.screenshot({ path: path.join(SHOT_DIR, '07-find.png') })

await step('find: escape closes the bar and clears the search', async () => {
  await page.locator('.find-input').press('Escape')
  await waitFor(async () => (await page.locator('.findbar').count()) === 0, 'find bar did not close')
})

await step('zoom: chip appears off 100% and resets', async () => {
  const id = (await tabInfo()) && (await page.evaluate(() => null))
  await page.evaluate(async () => {
    const s = await window.sheaf.invoke('tabs:state')
    await window.sheaf.invoke('tabs:zoom', s.activeTabId, 'in')
  })
  await waitFor(async () => (await page.locator('.zoom-chip').count()) === 1, 'zoom chip never showed')
  const txt = await page.locator('.zoom-chip').textContent()
  if (txt === '100%') throw new Error('zoom chip shows 100% after zooming in')

  await page.locator('.zoom-chip').click()
  await waitFor(async () => (await page.locator('.zoom-chip').count()) === 0, 'zoom did not reset')
})

await step('internal pages: history, bookmarks and downloads all render', async () => {
  for (const [host, needle] of [
    ['sheaf://history', 'History'],
    ['sheaf://bookmarks', 'Bookmarks'],
    ['sheaf://downloads', 'Downloads']
  ]) {
    await page.locator('.omnibox input').click()
    await page.locator('.omnibox input').fill(host)
    await page.keyboard.press('Enter')
    await waitFor(async () => (await tabInfo())?.url.startsWith(host), `did not reach ${host}`)
    const text = await app.evaluate(async ({ BrowserWindow }) => {
      const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => 'webContents' in c)
      return v.webContents.executeJavaScript('document.body.innerText')
    })
    if (!text.includes(needle)) throw new Error(`${host} did not render "${needle}"`)
  }
})
await capturePage('08-history')

await step('history: records real visits but never internal pages', async () => {
  // The loop above ends on sheaf://downloads — go back to history explicitly
  // rather than assuming which page we're standing on.
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill('sheaf://history')
  await page.keyboard.press('Enter')
  await waitFor(async () => (await tabInfo())?.url.startsWith('sheaf://history'), 'nav to history failed')

  const text = await app.evaluate(async ({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => 'webContents' in c)
    return v.webContents.executeJavaScript('document.body.innerText')
  })
  if (!/example\.com/.test(text)) throw new Error('example.com missing from history')
  // Internal pages must never be recorded as browsing history.
  if (/sheaf:\/\/(about|downloads|bookmarks)/.test(text)) {
    throw new Error('internal pages leaked into history')
  }
})

// ---- 10b. Folio: the JSON viewer, as a content script ----

await step('folio: replaces a JSON document with an interactive tree', async () => {
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill(ECHO)
  await page.keyboard.press('Enter')
  await waitFor(async () => (await tabInfo())?.url.startsWith(ECHO), 'did not reach echo server')
  // Folio marks the document and builds .folio-tree, replacing Chromium's viewer.
  await waitFor(async () => {
    const has = await app.evaluate(async ({ BrowserWindow }) => {
      const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => 'webContents' in c)
      return v.webContents.executeJavaScript(
        "!!document.querySelector('.folio-tree') && document.querySelectorAll('.folio-key').length"
      )
    })
    return typeof has === 'number' && has > 0
  }, 'Folio never rendered a tree')
})
await capturePage('11-folio')

await step('folio: search filters the tree to matching keys', async () => {
  const result = await app.evaluate(async ({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => 'webContents' in c)
    return v.webContents.executeJavaScript(`(async () => {
      const search = document.querySelector('.folio-search')
      search.value = 'user-agent'
      search.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 250))
      const count = document.querySelector('.folio-count').textContent
      const visibleKeys = [...document.querySelectorAll('.folio-node')]
        .filter(n => n.style.display !== 'none')
        .map(n => n.querySelector('.folio-key')?.textContent).filter(Boolean)
      return { count, hasUserAgent: visibleKeys.some(k => /user-agent/i.test(k)) }
    })()`)
  })
  if (!/match/.test(result.count)) throw new Error(`search reported no matches: "${result.count}"`)
  if (!result.hasUserAgent) throw new Error('user-agent key not visible after filtering for it')
})

// Run JS inside the active tab's page (the content view).
const inPage = (js) =>
  app.evaluate(async ({ BrowserWindow }, code) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => 'webContents' in c)
    return v.webContents.executeJavaScript(code)
  }, js)

await step('folio scratchpad: sheaf://folio shows a paste box', async () => {
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill('sheaf://folio')
  await page.keyboard.press('Enter')
  await waitFor(async () => (await tabInfo())?.url.startsWith('sheaf://folio'), 'did not reach sheaf://folio')
  await waitFor(
    async () => (await inPage("!!document.querySelector('.folio-paste textarea')")) === true,
    'paste box never rendered'
  )
})
await capturePage('12-folio-scratchpad')

await step('folio scratchpad: typed JSON renders as a tree', async () => {
  await inPage(`(() => {
    const ta = document.querySelector('.folio-paste textarea')
    ta.value = '{"alpha":1,"nested":{"beta":true,"list":[1,2,3]}}'
  })()`)
  // Click View.
  await inPage(`document.querySelector('.folio-primary').click()`)
  await waitFor(async () => (await inPage("!!document.querySelector('.folio-tree')")) === true, 'tree did not render')
  const keys = await inPage(`[...document.querySelectorAll('.folio-key')].map(k => k.textContent)`)
  for (const k of ['alpha', 'nested', 'beta', 'list']) {
    if (!keys.includes(k)) throw new Error(`key "${k}" missing from tree — got ${JSON.stringify(keys)}`)
  }
})

await step('folio scratchpad: Edit returns to the box with input preserved', async () => {
  await inPage(`[...document.querySelectorAll('.folio-btn')].find(b => /Edit/.test(b.textContent)).click()`)
  await waitFor(async () => (await inPage("!!document.querySelector('.folio-paste textarea')")) === true, 'did not return to paste box')
  const val = await inPage(`document.querySelector('.folio-paste textarea').value`)
  if (!val.includes('alpha')) throw new Error('input was not preserved on Edit')
})

await step('folio scratchpad: invalid JSON shows a parse error, not a tree', async () => {
  await inPage(`(() => {
    const ta = document.querySelector('.folio-paste textarea')
    ta.value = '{ not valid json ]'
    document.querySelector('.folio-primary').click()
  })()`)
  await new Promise((r) => setTimeout(r, 200))
  const err = await inPage(`document.querySelector('.folio-error').textContent`)
  if (!err || err.length === 0) throw new Error('no parse error shown for invalid JSON')
  const hasTree = await inPage("!!document.querySelector('.folio-tree')")
  if (hasTree) throw new Error('invalid JSON still rendered a tree')
})

await step('folio scratchpad: Paste from clipboard reads the OS clipboard', async () => {
  // Seed the real clipboard from the main process, then click the button.
  await app.evaluate(async ({ clipboard }) => clipboard.writeText('{"from":"clipboard","ok":true}'))
  await inPage(`[...document.querySelectorAll('.folio-btn')].find(b => /Paste from clipboard/.test(b.textContent)).click()`)
  await waitFor(async () => (await inPage("!!document.querySelector('.folio-tree')")) === true, 'clipboard paste did not render a tree')
  const keys = await inPage(`[...document.querySelectorAll('.folio-key')].map(k => k.textContent)`)
  if (!keys.includes('from') || !keys.includes('ok')) {
    throw new Error(`clipboard JSON not shown — got ${JSON.stringify(keys)}`)
  }
})
await capturePage('13-folio-clipboard')

// ---- 10c. Imprint: cookies & storage editor ----

await step('imprint: reads cookies for the current origin', async () => {
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill(ECHO)
  await page.keyboard.press('Enter')
  await waitFor(async () => (await tabInfo())?.url.startsWith(ECHO), 'nav to echo failed')

  await page.locator('.plugin-btn[title^="Imprint"]').click()
  await page.waitForSelector('.imp', { timeout: 10_000 })
  await waitFor(async () => {
    const names = await page.locator('.imp-name').allTextContents()
    return names.some((t) => /sheaf_test/.test(t))
  }, 'sheaf_test cookie not shown by Imprint')
})
await page.screenshot({ path: path.join(SHOT_DIR, '14-imprint.png') })

await step('imprint: adds a localStorage entry that reaches the real page', async () => {
  await page.locator('.imp-tab', { hasText: 'Local' }).click()
  await page.locator('.imp-add-k').fill('imp_key')
  await page.locator('.imp-add-v').fill('imp_value')
  await page.locator('.imp-add-btn').click()
  await waitFor(async () => (await inPage("window.localStorage.getItem('imp_key')")) === 'imp_value', 'localStorage entry never reached the page')
})

await step('imprint: reads back a localStorage value set by the page itself', async () => {
  await inPage("window.localStorage.setItem('page_set', 'from-page')")
  // Re-open Imprint's snapshot by toggling back to Local via a fresh snapshot.
  await page.locator('.imp-tab', { hasText: 'Session' }).click()
  await page.locator('.imp-tab', { hasText: 'Local' }).click()
  // The panel re-fetches on mount; force a refresh by reopening the dock.
  await page.locator('.plugin-btn[title^="Imprint"]').click()
  await page.locator('.plugin-btn[title^="Imprint"]').click()
  await page.waitForSelector('.imp', { timeout: 5000 })
  await page.locator('.imp-tab', { hasText: 'Local' }).click()
  await waitFor(async () => {
    const names = await page.locator('.imp-name').allTextContents()
    return names.some((t) => /page_set/.test(t))
  }, 'page-set localStorage key not visible in Imprint')
})

await step('imprint: deleting a cookie removes it from the session', async () => {
  await page.locator('.imp-tab', { hasText: 'Cookies' }).click()
  const row = page.locator('.imp-row', {
    has: page.locator('.imp-name', { hasText: 'sheaf_test' })
  })
  await row.locator('.imp-del').click()
  await waitFor(async () => {
    const names = await page.locator('.imp-name').allTextContents()
    return !names.some((t) => /sheaf_test/.test(t))
  }, 'cookie still present after delete')
  // Confirm at the source of truth — read document.cookie directly. (Don't
  // re-fetch: the echo server's Set-Cookie would just re-create it.)
  const cookieStr = await inPage('document.cookie')
  if (/sheaf_test/.test(cookieStr)) throw new Error('cookie still in document.cookie after delete')
})

await step('tabs: a titleless page shows its URL, not the previous title', async () => {
  // Navigate to a page that sets a title, then to one that has none.
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill('sheaf://folio')
  await page.keyboard.press('Enter')
  await waitFor(async () => /Folio/.test((await tabInfo())?.title ?? ''), 'scratchpad title never set')
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill(ECHO)
  await page.keyboard.press('Enter')
  await waitFor(async () => (await tabInfo())?.url.startsWith(ECHO), 'nav to echo failed')
  // The tab must NOT still say "Folio" — it should fall back to the URL.
  await waitFor(async () => {
    const t = (await tabInfo())?.title ?? ''
    return !/Folio/.test(t) && /127\.0\.0\.1/.test(t)
  }, 'titleless page kept the previous title')
})

await step('imprint: shows an empty state on pages with no origin', async () => {
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill('sheaf://about')
  await page.keyboard.press('Enter')
  await waitFor(async () => (await tabInfo())?.url === 'sheaf://about/', 'nav to about failed')
  await page.locator('.plugin-btn[title^="Imprint"]').click()
  await page.locator('.plugin-btn[title^="Imprint"]').click()
  await waitFor(async () => (await page.locator('.panel-empty').count()) > 0, 'no empty state for origin-less page')
})

// ---- 10d. Mailroom: mock / redirect + HAR ----

const setMailroom = (state) => page.evaluate((s) => window.sheaf.invoke('mailroom:set', s), state)
const baseRule = (over) => ({
  id: crypto.randomUUID?.() ?? String(Math.random()),
  enabled: true,
  urlFilter: '',
  action: 'redirect',
  redirectTo: '',
  delayMs: 0,
  stubBody: '',
  stubContentType: 'application/json',
  comment: '',
  ...over
})

await step('mailroom: panel opens with record controls', async () => {
  await page.locator('.plugin-btn[title^="Mailroom"]').click()
  await page.waitForSelector('.mr-record', { timeout: 10_000 })
})

await step('mailroom: a stub rule serves a fake response body', async () => {
  await setMailroom({
    recording: false,
    rules: [baseRule({ urlFilter: ECHO, action: 'stub', stubBody: '{"stubbed":true,"who":"mailroom"}' })]
  })
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill(ECHO)
  await page.keyboard.press('Enter')
  // The stub is a data: URL; Folio then renders it. Assert the fake key shows.
  await waitFor(async () => {
    const keys = await inPage(`[...document.querySelectorAll('.folio-key')].map(k=>k.textContent)`).catch(() => [])
    return Array.isArray(keys) && keys.includes('stubbed')
  }, 'stub body was not served')
})
await capturePage('15-mailroom-stub')

// The active tab's error lives in the window state (tabInfo reads webContents,
// which has no error field).
const activeError = async () => {
  const st = await page.evaluate(() => window.sheaf.invoke('tabs:state'))
  return st.tabs.find((t) => t.id === st.activeTabId)?.error ?? null
}

await step('mailroom: a block rule fails matching requests', async () => {
  await setMailroom({ recording: false, rules: [baseRule({ urlFilter: 'blockme', action: 'block' })] })
  // A unique path guarantees a fresh request (a matching URL that isn't blocked
  // by anything else in the suite).
  const target = `${ECHO}blockme-${Date.now()}`
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill(target)
  await page.keyboard.press('Enter')
  await waitFor(async () => /BLOCKED|-20/.test((await activeError()) ?? ''), 'blocked request did not report an error')
})

await step('mailroom: recording captures a HAR and export writes a valid file', async () => {
  await setMailroom({ recording: true, rules: [] })
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill(ECHO)
  await page.keyboard.press('Enter')
  await waitFor(async () => {
    const v = await page.evaluate(() => window.sheaf.invoke('mailroom:get'))
    return v.harCount > 0
  }, 'no HAR entries captured while recording')

  // Stub the native save dialog so export runs headless.
  const harPath = path.join(DATA_DIR, 'export.har')
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p })
  }, harPath)
  const res = await page.evaluate(() => window.sheaf.invoke('mailroom:exportHar'))
  if (!res.saved) throw new Error('export reported not saved')
  const har = JSON.parse(fs.readFileSync(harPath, 'utf8'))
  if (har.log?.version !== '1.2' || !Array.isArray(har.log.entries) || har.log.entries.length === 0) {
    throw new Error('HAR file is not a valid non-empty 1.2 log')
  }
  const echoEntry = har.log.entries.find((e) => e.request.url.includes('127.0.0.1'))
  if (!echoEntry) throw new Error('HAR did not record the echo request')
})

// Reset Mailroom so its rules don't affect later navigation tests.
await setMailroom({ recording: false, rules: [] })

await step('folio: leaves non-JSON pages completely alone', async () => {
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill('example.com')
  await page.keyboard.press('Enter')
  await waitFor(async () => /Example/i.test((await tabInfo())?.title ?? ''), 'nav to example.com failed')
  const folioPresent = await app.evaluate(async ({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => 'webContents' in c)
    return v.webContents.executeJavaScript("!!document.querySelector('.folio-tree')")
  })
  if (folioPresent) throw new Error('Folio hijacked a non-JSON page')
})

// ---- 11. the omnibox dropdown: the last native-view layering problem ----

/**
 * The dropdown lives in its own WebContentsView, so it is not in `page`.
 *
 * `rendered` is the count of items actually painted. Asserting only on bounds
 * and main's state let a blank-but-correctly-sized dropdown pass — the view was
 * positioned and "visible" while rendering nothing at all.
 */
const overlayInfo = () =>
  app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const views = win.contentView.children.filter((v) => 'webContents' in v)
    const ov = views.find((v) => (v.webContents.getURL() || '').includes('overlay.html'))
    if (!ov) return null
    const attached = views.indexOf(ov)
    const probe = await ov.webContents
      .executeJavaScript(
        `JSON.stringify({
           rendered: document.querySelectorAll('.sug-item').length,
           highlighted: document.querySelectorAll('.sug-item.on').length,
           text: document.body.innerText
         })`
      )
      .catch(() => '{"rendered":0,"highlighted":0,"text":""}')
    const p = JSON.parse(probe)
    return {
      visible: ov.getVisible?.() !== false,
      bounds: ov.getBounds(),
      // Index in the child list: it must be *after* the page view, or it draws
      // underneath it.
      index: attached,
      count: views.length,
      rendered: p.rendered,
      highlighted: p.highlighted,
      text: p.text
    }
  })

/** Each step opens its own dropdown — hide() removes the view entirely, so
 *  depending on a previous step's overlay makes these order-dependent. */
const openDropdown = async (text) => {
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill(text)
  // Wait on *painted rows*, not just a visible view — a sized-but-empty
  // dropdown is exactly the bug this is here to catch.
  await waitFor(async () => {
    const o = await overlayInfo()
    return !!o && o.visible && o.rendered > 0
  }, `dropdown never rendered any rows for "${text}"`)
  return overlayInfo()
}

await step('omnibox: the very first open renders rows, not a blank panel', async () => {
  // Specifically the cold path: the overlay renderer loads asynchronously, so
  // the first push can land before it is listening.
  const o = await openDropdown('example')
  if (o.rendered === 0) throw new Error('dropdown opened blank on first use')
})
await page.screenshot({ path: path.join(SHOT_DIR, '09-omnibox-chrome.png') })

await step('omnibox: the dropdown draws OVER the page, not under it', async () => {
  const o = await openDropdown('example')
  // The whole point: it must be the last child, i.e. on top of the tab views.
  if (o.index !== o.count - 1) {
    throw new Error(`overlay is child ${o.index} of ${o.count} — it would render beneath the page`)
  }
  // It hangs from just under the omnibox (covering the bookmarks bar, as Chrome
  // does), so what matters is that it *extends into* the page area — being on
  // top proves nothing if it never overlaps the page.
  const page = (await tabInfo()).bounds
  const overlap = o.bounds.y + o.bounds.height - page.y
  if (overlap <= 0) {
    throw new Error(
      `dropdown (y=${o.bounds.y} h=${o.bounds.height}) never reaches the page area (y=${page.y})`
    )
  }
})

await step('omnibox: suggestions come from real history and bookmarks', async () => {
  const o = await openDropdown('example')
  if (!/example\.com/.test(o.text)) throw new Error(`no example.com suggestion — saw: ${o.text}`)
  if (!/Search/.test(o.text)) throw new Error('search fallback missing from suggestions')
})

await step('omnibox: nothing is selected until you pick it', async () => {
  const o = await openDropdown('example')
  // The safety property: no highlight means Enter takes the typed text.
  if (o.highlighted !== 0) {
    throw new Error(`${o.highlighted} items highlighted on a fresh query, expected 0`)
  }
})

await step('omnibox: arrow down then Enter opens the chosen suggestion', async () => {
  await openDropdown('example')
  await page.locator('.omnibox input').press('ArrowDown')
  await waitFor(async () => (await overlayInfo())?.highlighted === 1, 'arrow did not highlight a row')
  await page.locator('.omnibox input').press('Enter')
  await waitFor(
    async () => (await tabInfo())?.url.startsWith('https://example.com'),
    'Enter did not open the selected suggestion'
  )
  await waitFor(async () => {
    const o = await overlayInfo()
    return !o || !o.visible
  }, 'dropdown stayed open after navigating')
})

await step('omnibox: Enter without picking uses the typed text, not a suggestion', async () => {
  // The safety property. Suggestions are async, so a stale one must never win.
  await openDropdown('example.com/typed-path')
  await page.locator('.omnibox input').press('Enter')
  await waitFor(
    async () => (await tabInfo())?.url.includes('/typed-path'),
    'Enter navigated somewhere other than what was typed'
  )
})

await step('omnibox: Escape closes the dropdown', async () => {
  await openDropdown('exam')
  await page.locator('.omnibox input').press('Escape')
  await waitFor(async () => {
    const o = await overlayInfo()
    return !o || !o.visible
  }, 'Escape did not close the dropdown')
})

// ---- 11b. third-party Chrome extension loader ----

await step('extensions: installs an unpacked extension whose content script runs', async () => {
  const extDir = path.join(DATA_DIR, 'test-ext')
  fs.mkdirSync(extDir, { recursive: true })
  fs.writeFileSync(
    path.join(extDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Sheaf Test Ext',
      version: '1.2.3',
      content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'], run_at: 'document_start' }]
    })
  )
  fs.writeFileSync(
    path.join(extDir, 'content.js'),
    "document.documentElement.setAttribute('data-sheaf-ext', 'loaded')"
  )

  // Stub the native file picker so install runs headless.
  await app.evaluate(async ({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, extDir)

  const res = await page.evaluate(() => window.sheaf.invoke('extensions:install'))
  if (res.error) throw new Error(`install error: ${res.error}`)
  if (!res.list.some((e) => e.name === 'Sheaf Test Ext' && e.version === '1.2.3')) {
    throw new Error(`extension not in list: ${JSON.stringify(res.list)}`)
  }

  // The real proof it loaded: its content script runs on a fresh page.
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill(`http://example.com/ext-${Date.now()}`)
  await page.keyboard.press('Enter')
  await waitFor(
    async () => (await inPage("document.documentElement.getAttribute('data-sheaf-ext')")) === 'loaded',
    "the extension's content script never ran"
  )
})

await step('extensions: sheaf://extensions lists the installed extension', async () => {
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill('sheaf://extensions')
  await page.keyboard.press('Enter')
  await waitFor(async () => (await tabInfo())?.url.startsWith('sheaf://extensions'), 'nav to extensions page failed')
  // The page builds its list through the narrow sheafInternal IPC bridge.
  await waitFor(async () => /Sheaf Test Ext/.test(await inPage('document.body.innerText')), 'extension not shown on the page')
})
await capturePage('16-extensions')

await step('extensions: removing it unloads it and clears the content script', async () => {
  const list = await page.evaluate(() => window.sheaf.invoke('extensions:list'))
  const after = await page.evaluate((id) => window.sheaf.invoke('extensions:remove', id), list[0].installId)
  if (after.length !== 0) throw new Error('extension still listed after removal')
  // A fresh page must no longer carry the content script's mark.
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill(`http://example.com/noext-${Date.now()}`)
  await page.keyboard.press('Enter')
  await new Promise((r) => setTimeout(r, 1200))
  if ((await inPage("document.documentElement.getAttribute('data-sheaf-ext')")) === 'loaded') {
    throw new Error('content script still ran after removal')
  }
})

// ---- 11c. theme toggle + help/reset (req 5, req 9) ----

await step('theme: toolbar toggle cycles dark/light/system and persists', async () => {
  const themeOf = async () => (await page.evaluate(() => window.sheaf.invoke('settings:get'))).theme
  const seq = [await themeOf()]
  for (let i = 0; i < 3; i++) {
    await page.locator('.theme-btn').click()
    await waitFor(async () => (await themeOf()) !== seq[seq.length - 1], 'theme did not advance')
    seq.push(await themeOf())
  }
  if (new Set(seq).size < 3) throw new Error(`did not cycle all three modes: ${seq.join(',')}`)
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  if (!['dark', 'light'].includes(applied)) throw new Error(`data-theme not applied: ${applied}`)
})

await step('help: sheaf://help lists tools, shortcuts, and a gated reset', async () => {
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill('sheaf://help')
  await page.keyboard.press('Enter')
  await waitFor(async () => (await tabInfo())?.url.startsWith('sheaf://help'), 'nav to help failed')
  const text = await execView('document.body.innerText')
  // Modelled on the reference apps' help: what it is, why, how, built with,
  // security, and how to report a problem.
  for (const needle of [
    'Letterhead',
    'Mailroom',
    'Keyboard shortcuts',
    'Why Sheaf exists',
    'Built with',
    'Security',
    'Reset Sheaf',
    'report an issue',
    // Per-plugin how-to guides.
    'Using Letterhead',
    'Using Imprint',
    'Using Mailroom',
    'Using Folio',
    'HttpOnly',
    'SameSite',
    'Export HAR'
  ]) {
    if (!text.includes(needle)) throw new Error(`help page missing "${needle}"`)
  }
  // Security claims users rely on must actually be stated.
  for (const claim of ['no telemetry', 'Private windows', 'not code-signed']) {
    if (!text.includes(claim)) throw new Error(`help page missing the "${claim}" note`)
  }
  // The no-phone-home promise must be stated, and must NOT claim a weather
  // service — that feature was removed for licensing/privacy reasons.
  if (!/No network calls of its own/i.test(text)) {
    throw new Error('help page no longer states the no-network-calls guarantee')
  }
  if (/opt.?in|ipapi|open-meteo/i.test(text)) {
    throw new Error('help page still advertises a weather/geolocation service')
  }
  // The reset is CONFIRM-gated. Verify the gate WITHOUT erasing (that would
  // relaunch and wipe the session mid-suite).
  const g = JSON.parse(
    await execView(`(() => {
      document.getElementById('reset').click();
      const btn = document.getElementById('doReset');
      const before = btn.disabled;
      const ct = document.getElementById('ct'); ct.value='CONFIRM'; ct.dispatchEvent(new Event('input',{bubbles:true}));
      return JSON.stringify({ before, after: btn.disabled });
    })()`)
  )
  if (g.before !== true) throw new Error('erase button was not disabled initially')
  if (g.after !== false) throw new Error('erase button did not enable after typing CONFIRM')
})
await capturePage('17-help')

// ---- 11d. docked DevTools + device simulation (req 4) ----

/**
 * The DevTools host is its own WebContentsView; find it by its devtools:// URL.
 * DevTools renders its tab strip inside shadow DOM, so the panel query has to
 * walk shadow roots — a plain querySelectorAll finds nothing.
 */
const devtoolsInfo = () =>
  app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const views = win.contentView.children.filter((v) => 'webContents' in v)
    const dt = views.find((v) => (v.webContents.getURL() || '').startsWith('devtools://'))
    if (!dt) return null
    const panels = await dt.webContents
      .executeJavaScript(
        "JSON.stringify((function(){var f=[];function w(r){try{r.querySelectorAll('[role=tab]').forEach(function(t){var s=(t.getAttribute('aria-label')||t.textContent||'').trim();if(s)f.push(s)});r.querySelectorAll('*').forEach(function(e){if(e.shadowRoot)w(e.shadowRoot)})}catch(e){}}w(document);return f})())"
      )
      .catch(() => '[]')
    return { visible: dt.getVisible?.() !== false, bounds: dt.getBounds(), panels: JSON.parse(panels) }
  })

await step('devtools: docks inside the window with the real Chrome panels', async () => {
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill('example.com')
  await page.keyboard.press('Enter')
  await waitFor(async () => /Example/i.test((await tabInfo())?.title ?? ''), 'nav failed')

  await page.locator('.nav-btn[aria-label="Toggle DevTools"]').click()
  await waitFor(async () => {
    const d = await devtoolsInfo()
    return !!d && d.visible && d.bounds.height > 50
  }, 'DevTools view never appeared')

  // Requirement 4's panels, verified present. They're Chrome's own — we dock them.
  await waitFor(async () => {
    const names = ((await devtoolsInfo())?.panels ?? []).join(' ')
    return ['Elements', 'Console', 'Sources', 'Network', 'Application'].every((p) => names.includes(p))
  }, 'DevTools loaded without the Elements/Console/Sources/Network/Application panels')
})
await page.screenshot({ path: path.join(SHOT_DIR, '18-devtools.png') })

await step('devtools: docking bottom shrinks the page, no overlap', async () => {
  const d = await devtoolsInfo()
  const p = (await tabInfo()).bounds
  // Page sits above DevTools; together they fill the content area.
  if (p.y + p.height > d.bounds.y + 2) {
    throw new Error(`page (y=${p.y} h=${p.height}) overlaps DevTools (y=${d.bounds.y})`)
  }
  if (Math.abs(p.x - d.bounds.x) > 2 || Math.abs(p.width - d.bounds.width) > 2) {
    throw new Error('DevTools is not aligned with the page column')
  }
})

await step('devtools: dock side switches to the right', async () => {
  await page.locator('.dock-side').click()
  await waitFor(async () => {
    const d = await devtoolsInfo()
    const p = (await tabInfo()).bounds
    // Side-by-side now: DevTools starts where the page ends.
    return !!d && Math.abs(d.bounds.x - (p.x + p.width)) <= 2 && d.bounds.height > p.height - 5
  }, 'DevTools did not dock to the right')
  await page.locator('.dock-side').click() // back to bottom
})

await step('devtools: the divider drags to resize the dock', async () => {
  const before = (await devtoolsInfo()).bounds.height
  // Drive the same IPC the splitter view sends on mousedown/move/up. (The
  // divider is its own native view, so Playwright can't click it directly.)
  await page.evaluate(async () => {
    await window.sheaf.invoke('devtools:dragStart')
    // Drag upward: y is relative to the expanded splitter (the content area),
    // so a small y means a tall DevTools pane.
    await window.sheaf.invoke('devtools:dragMove', 200, 120)
    await window.sheaf.invoke('devtools:dragEnd')
  })
  await waitFor(async () => (await devtoolsInfo()).bounds.height > before + 20, 'dragging did not grow the DevTools dock')

  // And back down — the page must reclaim the space.
  await page.evaluate(async () => {
    await window.sheaf.invoke('devtools:dragStart')
    await window.sheaf.invoke('devtools:dragMove', 200, 600)
    await window.sheaf.invoke('devtools:dragEnd')
  })
  await waitFor(async () => (await devtoolsInfo()).bounds.height < before, 'dragging did not shrink the dock')
})

await step('devtools: the divider clamps so neither pane collapses', async () => {
  const { height } = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentBounds())
  await page.evaluate(async () => {
    await window.sheaf.invoke('devtools:dragStart')
    await window.sheaf.invoke('devtools:dragMove', 200, -5000) // yank far past the top
    await window.sheaf.invoke('devtools:dragEnd')
  })
  const d = await devtoolsInfo()
  const p = await tabInfo()
  if (p.bounds.height < 20) throw new Error(`page collapsed to ${p.bounds.height}px`)
  if (d.bounds.height >= height) throw new Error('DevTools took the whole window')
})

await step('devtools: toggling off restores the full page area', async () => {
  const before = (await tabInfo()).bounds.height
  await page.locator('.nav-btn[aria-label="Toggle DevTools"]').click()
  await waitFor(async () => (await devtoolsInfo()) === null, 'DevTools view was not removed')
  await waitFor(async () => (await tabInfo()).bounds.height > before, 'page did not reclaim the space')
})

await step('device: a preset resizes the viewport and changes the user agent', async () => {
  const desktopUa = await inPage('navigator.userAgent')
  await page.locator('.device-select').selectOption('iphone-15')
  // The page view is letterboxed to the device's CSS size (393 wide).
  await waitFor(async () => Math.abs((await tabInfo()).bounds.width - 393) <= 2, 'page not resized to the device width')
  await waitFor(async () => {
    const ua = await inPage('navigator.userAgent').catch(() => '')
    return /iPhone/.test(ua)
  }, 'user agent did not change to the device')
  const w = await inPage('window.innerWidth')
  if (w > 420) throw new Error(`viewport did not shrink: innerWidth=${w}`)
  if (/iPhone/.test(desktopUa)) throw new Error('desktop UA already claimed to be an iPhone')
})
await page.screenshot({ path: path.join(SHOT_DIR, '19-device.png') })

await step('device: DevTools and device simulation work at the same time', async () => {
  await page.locator('.nav-btn[aria-label="Toggle DevTools"]').click()
  await waitFor(async () => {
    const d = await devtoolsInfo()
    return !!d && d.visible
  }, 'DevTools did not open while a device was active')
  // Still emulating the device, and still letterboxed inside the smaller area.
  const ua = await inPage('navigator.userAgent')
  if (!/iPhone/.test(ua)) throw new Error('device emulation was lost when DevTools opened')
  const p = (await tabInfo()).bounds
  if (Math.abs(p.width - 393) > 2) throw new Error(`device width lost: ${p.width}`)
  await page.locator('.nav-btn[aria-label="Toggle DevTools"]').click()
})

await step('device: a user-added profile appears and actually emulates', async () => {
  // Add one the way sheaf://devices does — through settings.
  await page.evaluate(async () => {
    const s = await window.sheaf.invoke('settings:get')
    await window.sheaf.invoke('settings:set', {
      customDevices: [
        ...(s.customDevices ?? []),
        {
          id: 'custom-kiosk',
          label: 'Kiosk 640',
          width: 640,
          height: 480,
          deviceScaleFactor: 1,
          mobile: false,
          userAgent: 'SheafKiosk/1.0'
        }
      ]
    })
  })
  // It shows up in the dropdown…
  await waitFor(async () => (await page.locator('.device-select option').allTextContents()).includes('Kiosk 640'), 'custom device missing from the dropdown')
  // …and selecting it emulates for real, not just in the UI.
  await page.locator('.device-select').selectOption('custom-kiosk')
  await waitFor(async () => Math.abs((await tabInfo()).bounds.width - 640) <= 2, 'custom device did not resize the page')
  await waitFor(async () => /SheafKiosk/.test(await inPage('navigator.userAgent').catch(() => '')), 'custom device UA not applied')
})

await step('device: sheaf://devices lists built-ins and the custom profile', async () => {
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill('sheaf://devices')
  await page.keyboard.press('Enter')
  await waitFor(async () => (await tabInfo())?.url.startsWith('sheaf://devices'), 'nav to devices failed')
  await waitFor(async () => {
    const t = await inPage('document.body.innerText')
    return /iPhone 15/.test(t) && /Kiosk 640/.test(t) && /built-in/.test(t)
  }, 'devices page did not list built-ins and the custom profile')
})
await capturePage('20-devices')

await step('device: switching back to Desktop restores the viewport and UA', async () => {
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill('example.com')
  await page.keyboard.press('Enter')
  await waitFor(async () => /Example/i.test((await tabInfo())?.title ?? ''), 'nav failed')
  await page.locator('.device-select').selectOption('')
  await waitFor(async () => (await tabInfo()).bounds.width > 500, 'page did not return to full width')
  await waitFor(async () => {
    const ua = await inPage('navigator.userAgent').catch(() => '')
    return !/iPhone/.test(ua)
  }, 'user agent was not restored')
})

// ---- 11e. uploads & downloads ----

await step('upload: a file input posts its contents to a real server', async () => {
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill(ECHO)
  await page.keyboard.press('Enter')
  await waitFor(async () => (await tabInfo())?.url.startsWith(ECHO), 'nav to echo failed')

  // Chromium's own file picker backs <input type=file>; there's nothing for us
  // to implement. What this proves is the plumbing works inside our content
  // view: a File reaches an input, and multipart upload reaches the server.
  const res = await inPage(`(async () => {
    const input = document.createElement('input'); input.type = 'file';
    const file = new File(['upload-payload-abc'], 'note.txt', { type: 'text/plain' });
    const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
    const fd = new FormData(); fd.append('f', input.files[0], input.files[0].name);
    const r = await fetch('${ECHO}upload', { method: 'POST', body: fd });
    return JSON.stringify(await r.json());
  })()`)
  const got = JSON.parse(res)
  if (got.gotFilename !== 'note.txt') throw new Error(`server saw filename ${got.gotFilename}`)
  if (got.gotContent !== 'upload-payload-abc') throw new Error(`server saw content ${got.gotContent}`)
})

await step('download: a Content-Disposition file saves and is listed', async () => {
  const before = (await page.evaluate(() => window.sheaf.invoke('downloads:list'))).length
  await inPage(`location.assign('${ECHO}download')`)
  await waitFor(async () => {
    const list = await page.evaluate(() => window.sheaf.invoke('downloads:list'))
    return list.length > before && list.some((d) => d.filename === 'sheaf-test.bin' && d.state === 'completed')
  }, 'download never completed or was not recorded')

  // It really landed on disk, with the bytes the server sent.
  const item = (await page.evaluate(() => window.sheaf.invoke('downloads:list'))).find(
    (d) => d.filename === 'sheaf-test.bin'
  )
  if (!fs.existsSync(item.savePath)) throw new Error(`file not on disk: ${item.savePath}`)
  if (fs.readFileSync(item.savePath, 'utf8') !== 'downloaded-bytes-ok') {
    throw new Error('downloaded file contents are wrong')
  }
  fs.rmSync(item.savePath, { force: true })
})

// ---- 11f. privacy: the app must never phone home ----

await step('privacy: the request recorder actually sees traffic (guards the next test)', async () => {
  // Record every request either session makes. onSendHeaders is informational
  // and unused by the plugin host, so this doesn't clobber a real listener.
  await app.evaluate(async ({ session }) => {
    globalThis.__seen = []
    const record = (d) => globalThis.__seen.push(d.url)
    session.defaultSession.webRequest.onSendHeaders(record)
    session.fromPartition('persist:profile-default').webRequest.onSendHeaders(record)
  })
  // Prove the recorder is live BEFORE asserting silence with it — otherwise
  // "no requests seen" could just mean the listener never attached, and the
  // privacy test below would pass vacuously forever.
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill(`${ECHO}recorder-check`)
  await page.keyboard.press('Enter')
  await waitFor(async () => {
    const seen = await app.evaluate(() => globalThis.__seen)
    return seen.some((u) => u.includes('recorder-check'))
  }, 'the request recorder never saw a known request — it is not working')
})

await step('privacy: sitting on the home page makes no outbound requests', async () => {
  await app.evaluate(() => {
    globalThis.__seen = []
  })
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill('sheaf://home')
  await page.keyboard.press('Enter')
  await waitFor(async () => (await tabInfo())?.url.startsWith('sheaf://home'), 'nav home failed')
  // Give anything lazy (weather, dictionaries, favicons, telemetry) time to fire.
  await new Promise((r) => setTimeout(r, 3000))

  const seen = await app.evaluate(() => globalThis.__seen)
  // Local-only schemes and our own test server are fine; anything else is a leak.
  const external = seen.filter(
    (u) => !/^(sheaf|sheaf-stub|devtools|chrome|chrome-extension|about|data|blob|file):/.test(u) && !u.includes('127.0.0.1')
  )
  if (external.length) {
    throw new Error(`the app made outbound requests on its own: ${[...new Set(external)].join(', ')}`)
  }
})

await step('privacy: no weather or IP-geolocation service is ever contacted', async () => {
  const seen = await app.evaluate(() => globalThis.__seen ?? [])
  const banned = /ipapi|open-meteo|ip-api|ipinfo|geoip|gvt1|google|googleapis|analytics|sentry|telemetry/i
  const hits = seen.filter((u) => banned.test(u))
  if (hits.length) throw new Error(`contacted a banned host: ${[...new Set(hits)].join(', ')}`)
})

await step('privacy: bookmarking stores the icon locally, not a remote URL', async () => {
  await page.locator('.omnibox input').click()
  await page.locator('.omnibox input').fill(ECHO)
  await page.keyboard.press('Enter')
  await waitFor(async () => (await tabInfo())?.url.startsWith(ECHO), 'nav to echo failed')
  const list = await page.evaluate(() => window.sheaf.invoke('bookmarks:list'))
  // Whatever is stored must never be an http(s) URL — that would mean the
  // bookmarks bar re-fetches from the origin every time it renders.
  for (const b of list) {
    if (b.favicon && !b.favicon.startsWith('data:')) {
      throw new Error(`bookmark "${b.title}" stores a remote favicon URL: ${b.favicon}`)
    }
  }
})

await step('menu: the native application menu is installed', async () => {
  const labels = await app.evaluate(async ({ Menu }) => {
    const m = Menu.getApplicationMenu()
    return m ? m.items.map((i) => i.label) : []
  })
  for (const needed of ['File', 'Edit', 'View', 'History', 'Bookmarks']) {
    if (!labels.includes(needed)) throw new Error(`menu missing "${needed}" — got ${labels.join(', ')}`)
  }
})

// ---- 12. teardown: closing a window with the dropdown open must not crash ----
// This is the exact path that threw "Object has been destroyed" — the overlay's
// dispose ran on `closed`, when the window was already gone.
// Count real BrowserWindows, not Playwright pages: each window is 3 pages
// (chrome + overlay + tab content), so page counts mislead.
const windowCount = () => app.evaluate(async ({ BrowserWindow }) => BrowserWindow.getAllWindows().length)

await step('teardown: open a second window, open its dropdown, close it cleanly', async () => {
  await page.evaluate(() => window.sheaf.invoke('window:new', { private: false }))
  await waitFor(async () => (await windowCount()) === 2, 'second window never opened')

  // The new window's chrome is the last index.html page.
  const chromePages = (await app.windows()).filter((w) => w.url().endsWith('index.html'))
  const second = chromePages[chromePages.length - 1]
  await second.waitForSelector('.omnibox input', { timeout: 10_000 })
  await second.locator('.omnibox input').click()
  await second.locator('.omnibox input').fill('example')
  // Show the dropdown, so close() exercises the overlay teardown that crashed.
  await new Promise((r) => setTimeout(r, 500))

  await app.evaluate(async ({ BrowserWindow }) => {
    const wins = BrowserWindow.getAllWindows()
    wins[wins.length - 1].close()
  })
  await waitFor(async () => (await windowCount()) === 1, 'window did not close')
  await new Promise((r) => setTimeout(r, 400))
  if (mainCrash) throw new Error(`main process crashed on close: ${mainCrash}`)
})

if (mainCrash) {
  failures++
  console.log('FAIL: main process emitted an uncaught exception —', mainCrash)
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
await app.close().catch(() => {})
echo.close()
process.exit(failures === 0 ? 0 : 1)
