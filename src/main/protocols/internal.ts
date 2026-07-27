import type { Session } from 'electron'
import { app, protocol } from 'electron'
import type { BrowserInfo } from '@shared/types'
import type { TimeOfDay } from '@shared/skyArt'
import { SKY_FX_CSS, sceneAnimation, sceneGradient, skyIcon } from '@shared/skyArt'
import { DEVICE_PRESETS } from '@shared/devices'
import {
  REPO_IS_PLACEHOLDER,
  SHEAF_CONTRIBUTING,
  SHEAF_NEW_ISSUE,
  SHEAF_REPO,
  SHEAF_SECURITY
} from '@shared/repo'
import { listDownloads } from '../downloads'
import { listBookmarks } from '../store/repositories/bookmarks'
import { searchHistory } from '../store/repositories/history'

/**
 * Must run before `app.ready`, otherwise `sheaf://` gets an opaque origin and
 * behaves like a sandboxed iframe (no storage, no fetch).
 */
export function registerInternalScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'sheaf',
      privileges: { standard: true, secure: true, supportFetchAPI: true }
    },
    {
      // Mailroom stubs are served here. corsEnabled + supportFetchAPI so a page
      // can fetch() a stubbed endpoint cross-origin, which data: URLs can't do.
      scheme: 'sheaf-stub',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
  ])
}

export function browserInfo(): BrowserInfo {
  return {
    appName: app.getName(),
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    osVersion: process.getSystemVersion(),
    userDataPath: app.getPath('userData'),
    locale: app.getLocale(),
    isPackaged: app.isPackaged
  }
}

/**
 * Registers the `sheaf://` handler on one session.
 *
 * This is per-session, not global. The `protocol` module only ever configures
 * the *default* session, and every tab here runs in a named partition
 * (`persist:profile-default`, or a throwaway one per private window), so a
 * handler registered globally is invisible to the pages that need it.
 * Every session that can host a tab must be registered explicitly.
 */
export function registerInternalProtocol(ses: Session): void {
  if (ses.protocol.isProtocolHandled('sheaf')) return
  ses.protocol.handle('sheaf', async (request) => {
    const page = new URL(request.url).hostname
    switch (page) {
      case 'about':
        return htmlResponse(aboutPage())
      case 'history':
        return htmlResponse(historyPage())
      case 'bookmarks':
        return htmlResponse(bookmarksPage())
      case 'downloads':
        return htmlResponse(downloadsPage())
      case 'folio':
        // A bare shell: Folio's content script detects sheaf://folio and builds
        // the paste scratchpad into the body.
        return htmlResponse(folioShell())
      case 'extensions':
        return htmlResponse(extensionsPage())
      case 'devices':
        return htmlResponse(devicesPage())
      case 'home':
        return htmlResponse(homePage())
      case 'welcome':
        return htmlResponse(welcomePage())
      case 'help':
        return htmlResponse(helpPage())
      default:
        return htmlResponse(notFoundPage(page), 404)
    }
  })
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  })
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  )
}

/**
 * Internal pages are generated here rather than being React routes. That keeps
 * the foundation simple; when settings/history/plugins pages land they should
 * graduate to a second renderer entry served through this same handler.
 */
// Internal pages follow the app theme via data-theme (set by THEME_SCRIPT),
// falling back to the OS preference until that resolves.
const PAGE_CSS = `
  :root, :root[data-theme='dark'] {
    --bg:#0a0a0a; --fg:#ededed; --fg-muted:#a1a1a1; --fg-faint:#6e6e6e; --border:#262626;
    --border-strong:#3a3a3a; --bg-elev:#161616; --bg-hover:#1f1f1f; --accent:#0070f3;
    --danger:#e5484d; color-scheme: dark;
  }
  :root[data-theme='light'] {
    --bg:#ffffff; --fg:#171717; --fg-muted:#666; --fg-faint:#999; --border:#eaeaea;
    --border-strong:#d4d4d4; --bg-elev:#fafafa; --bg-hover:#f2f2f2; --accent:#0070f3;
    --danger:#dc3d43; color-scheme: light;
  }
  @media (prefers-color-scheme: light) {
    :root:not([data-theme]) {
      --bg:#ffffff; --fg:#171717; --fg-muted:#666; --fg-faint:#999; --border:#eaeaea;
      --border-strong:#d4d4d4; --bg-elev:#fafafa; --bg-hover:#f2f2f2; color-scheme: light;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin:0; padding:48px 32px; background:var(--bg); color:var(--fg);
    font:14px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 680px; margin: 0 auto; }
  h1 { font-size:28px; margin:0 0 4px; letter-spacing:-0.02em; }
  .tag { color:var(--fg-muted); margin:0 0 32px; font-size:14px; }
  table { width:100%; border-collapse:collapse; background:var(--bg-elev);
          border:1px solid var(--border); border-radius:8px; overflow:hidden; }
  td { padding:10px 14px; border-bottom:1px solid var(--border); }
  tr:last-child td { border-bottom:none; }
  td:first-child { color:var(--fg-muted); width:40%; }
  td:last-child { font-family:'SF Mono', ui-monospace, Menlo, monospace; font-size:12.5px;
                  word-break:break-all; }
  .foot { margin-top:24px; color:var(--fg-muted); font-size:12.5px; }
  a { color:var(--accent); }
`

function aboutPage(): string {
  const i = browserInfo()
  const rows: [string, string][] = [
    ['Version', `${i.appVersion}${i.isPackaged ? '' : ' (development)'}`],
    ['Electron', i.electron],
    ['Chromium', i.chrome],
    ['Node.js', i.node],
    ['V8', i.v8],
    ['Platform', `${i.platform} ${i.arch}`],
    ['OS version', i.osVersion],
    ['Locale', i.locale],
    ['Profile path', i.userDataPath]
  ]
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>About Sheaf Browser</title><style>${PAGE_CSS}</style></head>
<body><div class="wrap">
  <h1>Sheaf Browser</h1>
  <p class="tag">A browser for development teams — binds Letterhead, Folio, Imprint and Mailroom into one application.</p>
  <table>
    ${rows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('\n    ')}
  </table>
  <p class="foot">MIT licensed. Built on Chromium via Electron.</p>
</div></body></html>`
}

function notFoundPage(page: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Not found</title><style>${PAGE_CSS}</style></head>
<body><div class="wrap">
  <h1>Page not found</h1>
  <p class="tag">There is no internal page at <code>sheaf://${escapeHtml(page)}</code>.</p>
  <p class="foot"><a href="sheaf://home">Go home</a></p>
</div></body></html>`
}

/**
 * Applies the app theme to an internal page, and keeps following it.
 *
 * Main sets `nativeTheme.themeSource` from the saved theme, which forces
 * prefers-color-scheme in every page — so matchMedia IS the app theme, and it
 * fires on change. No settings read, and toggling re-themes an open page live.
 */
const THEME_SCRIPT = `<script>
(function(){
  var mq = matchMedia('(prefers-color-scheme: dark)');
  function apply(){ document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light'); }
  apply();
  mq.addEventListener('change', apply);
})();
</script>`

// ---- home (new tab): clock-driven greeting + sky + search + links (req 9) ----

const HOME_CSS = `
  .home { min-height:100vh; margin:0; padding:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:22px; }
  /* Scene: an original CSS gradient (no stock imagery — see shared/skyArt).
     Sits behind everything and cross-fades as the time of day changes.
     Driven by the system clock only — no weather API, no network. */
  .sky { position:fixed; inset:0; z-index:-2; transition:background 1s ease; }
  .sky-veil { position:fixed; inset:0; z-index:-1;
    background:radial-gradient(120% 80% at 50% 0%, transparent 40%, rgba(0,0,0,.35) 100%); }
  .hero { display:flex; flex-direction:column; align-items:center; gap:10px; }
  .wx-icon { filter:drop-shadow(0 3px 10px rgba(0,0,0,.35)); min-height:64px; }
  /* The hero sits on the scene like wallpaper, so it stays light in BOTH themes
     — dimming the scene for light mode just turned it muddy grey. The search box
     and links below still follow the theme, and read fine against the scene. */
  .greet { font-size:34px; font-weight:600; letter-spacing:-0.02em; text-align:center;
    color:#fff; text-shadow:0 2px 12px rgba(0,0,0,.45); }
  .greet b { font-weight:700; }
  .wx { color:rgba(255,255,255,.82); font-size:14px; min-height:20px;
    text-shadow:0 1px 8px rgba(0,0,0,.4); }
  .home-search { width:min(560px,86vw); display:flex; height:48px; border:1px solid var(--border-strong); border-radius:24px;
    background:var(--bg-elev); overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,.25); }
  .home-search input { flex:1; border:none; outline:none; background:transparent; padding:0 20px; font-size:15px; color:var(--fg); }
  .links { display:flex; flex-wrap:wrap; gap:10px; justify-content:center; max-width:620px; }
  .links a { display:flex; align-items:center; gap:7px; padding:9px 14px; border:1px solid var(--border); border-radius:9px;
    background:var(--bg-elev); color:var(--fg); text-decoration:none; font-size:13px; }
  .links a:hover { background:var(--bg-hover); }
  .home-foot { position:fixed; bottom:16px; color:var(--fg-faint); font-size:12px; }
  .home-foot a { color:var(--fg-faint); }
`

/**
 * Every scene/icon combination, precomputed and inlined. The page picks by
 * `kind|timeOfDay` at runtime, so it paints correctly on the first frame and
 * needs no network — the art is generated geometry, not stock imagery.
 */
function artBundle(): {
  scenes: Record<string, string>
  icons: Record<string, string>
  fx: Record<string, string>
} {
  const tods: TimeOfDay[] = ['dawn', 'day', 'dusk', 'night']
  const scenes: Record<string, string> = {}
  const icons: Record<string, string> = {}
  const fx: Record<string, string> = {}
  for (const t of tods) {
    scenes[t] = sceneGradient(t)
    icons[t] = skyIcon(t, 64)
    fx[t] = sceneAnimation(t)
  }
  return { scenes, icons, fx }
}

function homePage(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Sheaf Browser</title><style>${PAGE_CSS}${HOME_CSS}${SKY_FX_CSS}</style>${THEME_SCRIPT}</head>
<body class="home">
  <div class="sky" id="sky"></div>
  <div class="fx" id="fx"></div>
  <div class="sky-veil"></div>
  <div class="hero">
    <div class="wx-icon" id="wxicon"></div>
    <div class="greet" id="greet">Hello</div>
    <div class="wx" id="wx"></div>
  </div>
  <form class="home-search" id="f"><input id="q" placeholder="Search or enter address" spellcheck="false" autofocus></form>
  <div class="links">
    <a href="sheaf://about">ℹ︎ About</a>
    <a href="sheaf://help">? Help</a>
    <a href="sheaf://folio">{ } JSON viewer</a>
    <a href="sheaf://extensions">🧩 Extensions</a>
    <a href="sheaf://bookmarks">★ Bookmarks</a>
    <a href="sheaf://history">↺ History</a>
    <a href="sheaf://downloads">↓ Downloads</a>
  </div>
  <div class="home-foot">Sheaf Browser · <a href="sheaf://about">version</a></div>
<script>
  var api = window.sheafInternal
  var ART = ${JSON.stringify(artBundle())}
  function greetWord(){ var h=new Date().getHours(); return h<12?'Good morning':h<17?'Good afternoon':'Good evening' }
  function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  function todNow(){ var h=new Date().getHours(); return h>=5&&h<8?'dawn':h>=8&&h<17?'day':h>=17&&h<20?'dusk':'night' }
  // Everything here comes from the system clock. No network call is made.
  function paint(){
    var tod = todNow()
    document.getElementById('sky').style.background = ART.scenes[tod]
    document.getElementById('wxicon').innerHTML = ART.icons[tod]
    document.getElementById('fx').innerHTML = ART.fx[tod]
  }
  paint()
  // Follow the clock across a long session (dusk → night while the tab is open).
  setInterval(paint, 60000)
  var search = 'https://www.google.com/search?q=%s'
  api.invoke('settings:get').then(function(s){
    search = s.searchTemplate || search
    document.getElementById('greet').innerHTML = greetWord() + (s.userName? ', <b>'+esc(s.userName)+'</b>' : '')
  }).catch(function(){ document.getElementById('greet').textContent = greetWord() })
  document.getElementById('f').addEventListener('submit', function(e){
    e.preventDefault()
    var v=document.getElementById('q').value.trim(); if(!v) return
    var url
    if (/^[a-z]+:\\/\\//i.test(v)) url=v
    else if (/^[^\\s]+\\.[a-z]{2,}([\\/?#]|$)/i.test(v) || /^localhost([:\\/]|$)/.test(v)) url='https://'+v
    else url=search.replace('%s', encodeURIComponent(v))
    location.assign(url)
  })
</script>
</body></html>`
}

// ---- welcome (first launch): just a name (req 9) ----

function welcomePage(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Welcome to Sheaf Browser</title><style>${PAGE_CSS}${HOME_CSS}
  .wcard { width:min(460px,88vw); text-align:center; }
  .wcard h1 { font-size:26px; margin:0 0 6px; }
  .wcard p { color:var(--fg-muted); margin:0 0 22px; }
  .wcard input[type=text] { width:100%; height:44px; padding:0 14px; border:1px solid var(--border-strong);
    border-radius:10px; background:var(--bg-elev); color:var(--fg); font-size:15px; margin-bottom:14px; }
  .wcard input[type=text]:focus { outline:none; border-color:var(--accent); }
  .wlive { display:flex; gap:8px; align-items:flex-start; text-align:left; font-size:12.5px; color:var(--fg-muted); margin-bottom:20px; }
  .wgo { height:42px; padding:0 22px; border:none; border-radius:9px; background:var(--accent); color:#fff; font:inherit; font-weight:600; cursor:pointer; }
  .wgo:disabled { opacity:.4; }
</style>${THEME_SCRIPT}</head>
<body class="home">
  <div class="sky" id="wsky"></div>
  <div class="wcard">
    <h1>Welcome to Sheaf Browser</h1>
    <p>A browser for development teams — Letterhead, Folio, Imprint and Mailroom, bundled in.</p>
    <input type="text" id="name" maxlength="40" placeholder="What should I call you?" autofocus>
    <p style="font-size:12px;margin:0 0 18px">Stored on this machine only. Sheaf Browser makes no network calls of its own.</p>
    <button class="wgo" id="go" disabled>Let's go →</button>
  </div>
<script>
  // NB: never name a global 'name' — window.name coerces assignments to a string.
  var api = window.sheafInternal
  var nameEl=document.getElementById('name'), go=document.getElementById('go')
  nameEl.addEventListener('input', function(){ go.disabled = !nameEl.value.trim() })
  function submit(){
    var n=nameEl.value.trim(); if(!n) return
    api.invoke('settings:set', { userName:n, onboarded:true })
      .then(function(){ location.assign('sheaf://home') })
  }
  go.addEventListener('click', submit)
  nameEl.addEventListener('keydown', function(e){ if(e.key==='Enter') submit() })
</script>
</body></html>`
}

// ---- help / about / how-to (req 9) ----

function helpPage(): string {
  const i = browserInfo()
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Help — Sheaf Browser</title><style>${PAGE_CSS}
  .card { border:1px solid var(--border); border-radius:10px; background:var(--bg-elev); padding:16px 18px; margin:14px 0; }
  .card h2 { margin:0 0 10px; font-size:15px; }
  /* A 2-column grid, NOT flex. As a flex row the value's inline parts (text,
     <code>, text) each became a separate flex item and got spread across the
     row — "Only Sheaf's own [gap] sheaf:// pages" instead of a sentence.
     Grid keeps the whole value as one cell that wraps normally. */
  .kv { display:grid; grid-template-columns:150px 1fr; gap:4px 12px;
        font-size:13px; padding:4px 0; align-items:baseline; }
  .kv > b { color:var(--fg-muted); font-weight:400; }
  .kv > span { min-width:0; }
  @media (max-width: 560px) { .kv { grid-template-columns:1fr; } }
  kbd { font-family:var(--font-mono,monospace); background:var(--bg-hover); border:1px solid var(--border); border-radius:4px; padding:1px 6px; font-size:12px; }
  code { background:var(--bg-hover); border-radius:4px; padding:1px 5px; font-size:12px;
         font-family:'SF Mono',ui-monospace,Menlo,monospace; }
  .how { margin:0 0 12px; padding-left:20px; font-size:13px; }
  .how li { margin:4px 0; }
  .danger-btn { height:34px; padding:0 14px; border:1px solid var(--danger); border-radius:7px; background:transparent; color:var(--danger); font:inherit; cursor:pointer; }
  .reset-confirm { margin-top:10px; display:none; }
  .reset-confirm.on { display:block; }
  .reset-confirm input { height:32px; padding:0 10px; border:1px solid var(--border-strong); border-radius:6px; background:var(--bg); color:var(--fg); margin-right:8px; }
</style>${THEME_SCRIPT}</head>
<body><div class="wrap" style="max-width:720px">
  <h1>Help</h1>
  <p class="tag">Sheaf Browser ${escapeHtml(i.appVersion)}${i.isPackaged ? '' : ' (development)'} — a browser for development teams.</p>
  <p style="margin:6px 0 14px 0; font-size:13px; color:var(--fg-muted)">
    Visit website: <a href="https://rajeshk.dev/sheaf-browser?utm_source=sheafbrowser&utm_medium=help&utm_campaign=sheafbrowser" target="_blank" rel="noopener noreferrer">https://rajeshk.dev/sheaf-browser</a>
  </p>

  <div class="card">
    <h2>The bundled tools</h2>
    <div class="kv"><b>Letterhead</b><span>Add, override or remove HTTP request &amp; response headers, per URL.</span></div>
    <div class="kv"><b>Folio</b><span>View any JSON as an interactive tree — or paste JSON at <a href="sheaf://folio">sheaf://folio</a>.</span></div>
    <div class="kv"><b>Imprint</b><span>Read and edit cookies, localStorage and sessionStorage for the current site.</span></div>
    <div class="kv"><b>Mailroom</b><span>Mock, redirect, block or delay requests, and record a HAR.</span></div>
    <p class="foot">Open a tool from its button in the toolbar. Every tool was built from scratch.</p>
  </div>

  <div class="card">
    <h2>Using Letterhead — HTTP headers</h2>
    <p style="margin:0 0 10px">Click <b>L</b> in the toolbar. Rules live in a <b>profile</b>; switch profiles to swap whole sets (dev / staging / a colleague's token).</p>
    <ol class="how">
      <li><b>Add header rule</b>, then pick <b>Req</b> (sent to the server) or <b>Res</b> (what the server sent back — useful for faking CORS or cache headers).</li>
      <li>Choose the operation: <b>Append</b> adds to an existing value, <b>Set</b> replaces it, <b>Remove</b> deletes it.</li>
      <li>Type the header name and value, e.g. <code>Authorization</code> / <code>Bearer eyJ…</code>.</li>
      <li>Scope it with a <b>URL filter</b>, or leave it blank to apply everywhere.</li>
    </ol>
    <div class="kv"><b>URL filter</b><span>Four forms: <code>api.example.com</code> (substring), <code>https://api.example.com/*</code> (glob — any path, query or fragment), a bare regex like <code>.*://host:8080/.*</code>, or an explicit <code>/\\/v[12]\\//</code> (regex in slashes, with flags).</span></div>
    <div class="kv"><b>Append vs Set</b><span>On <code>User-Agent</code>, Append adds a product token after a space (the RFC's format); on <code>Cookie</code> it joins with <code>;</code>; elsewhere with <code>,</code>. Set replaces the whole value.</span></div>
    <div class="kv"><b>The blue pulse</b><span>The <b>L</b> icon and a rule's dot pulse while that rule applies to the page you're on. If it isn't pulsing, your filter doesn't match — check it against the address bar.</span></div>
    <div class="kv"><b>Gotcha</b><span>Some servers reject unknown headers, and a page already loaded won't change until you reload it.</span></div>
  </div>

  <div class="card">
    <h2>Using Imprint — cookies &amp; storage</h2>
    <p style="margin:0 0 10px">Click <b>I</b>. It always acts on the <b>current tab's origin</b>, shown at the top; open an <code>http(s)</code> page first.</p>
    <ol class="how">
      <li><b>Cookies</b> / <b>Local</b> / <b>Session</b> tabs — the count next to each shows how many entries exist.</li>
      <li>Edit a value in place; it saves when you click away. <b>×</b> deletes. Use the bottom row to add a new one.</li>
      <li><b>Clear all</b> empties a storage area — handy for testing a first-time-visitor flow.</li>
    </ol>
    <div class="kv"><b>The flag chips</b><span><b>H</b> = HttpOnly (page scripts can't read it), <b>S</b> = Secure (HTTPS only), <b>SS·N/L/St</b> = SameSite None/Lax/Strict. Hover any chip for the full meaning.</span></div>
    <div class="kv"><b>Editing HttpOnly</b><span>Works here even though page JavaScript can't touch it — Imprint goes through the browser's own cookie store, not the page.</span></div>
    <div class="kv"><b>Gotcha</b><span>Changing a session cookie usually needs a reload to take effect, and the site may just re-set it.</span></div>
  </div>

  <div class="card">
    <h2>Using Mailroom — mock, redirect &amp; record</h2>
    <p style="margin:0 0 10px">Click <b>M</b>. Rules match a URL filter (same three forms as Letterhead) and the <b>first matching rule wins</b>.</p>
    <div class="kv"><b>Stub</b><span>Return a fake response body without touching the backend — set a Content-Type and paste the JSON. Ideal when the API doesn't exist yet.</span></div>
    <div class="kv"><b>Redirect</b><span>Send a request somewhere else — e.g. point production's bundle at <code>localhost</code>.</span></div>
    <div class="kv"><b>Block</b><span>Make matching requests fail, so you can see how the page copes with a dead endpoint.</span></div>
    <div class="kv"><b>Delay</b><span>Hold requests for N ms — the honest way to find missing loading states.</span></div>
    <div class="kv"><b>Record network</b><span>Tick it, reproduce the problem, then <b>Export HAR</b> — a file you can attach to a ticket so the backend team sees exactly what you saw.</span></div>
    <div class="kv"><b>Gotcha</b><span>An empty URL filter matches <i>nothing</i> (deliberately — a stray rule shouldn't mock the whole web), and a cached page may not re-request at all: hard-reload with <kbd>⌘⇧R</kbd>.</span></div>
  </div>

  <div class="card">
    <h2>Using Folio — JSON</h2>
    <p style="margin:0 0 10px">Folio needs no button: open any JSON URL and it renders a tree instead of raw text. Filter, expand/collapse, and click any key to copy its path.</p>
    <div class="kv"><b>Scratchpad</b><span>Have JSON from somewhere else? <a href="sheaf://folio">sheaf://folio</a> (<kbd>⌘⇧U</kbd>) — paste it, or hit <b>Paste from clipboard</b>.</span></div>
  </div>

  <div class="card">
    <h2>Keyboard shortcuts</h2>
    <div class="kv"><b>New tab</b><span><kbd>⌘T</kbd></span></div>
    <div class="kv"><b>New / private window</b><span><kbd>⌘N</kbd> / <kbd>⌘⇧N</kbd></span></div>
    <div class="kv"><b>Find in page</b><span><kbd>⌘F</kbd></span></div>
    <div class="kv"><b>Reload / hard reload</b><span><kbd>⌘R</kbd> / <kbd>⌘⇧R</kbd></span></div>
    <div class="kv"><b>Zoom</b><span><kbd>⌘+</kbd> <kbd>⌘−</kbd> <kbd>⌘0</kbd></span></div>
    <div class="kv"><b>Developer tools</b><span><kbd>⌥⌘I</kbd></span></div>
    <div class="kv"><b>JSON viewer</b><span><kbd>⌘⇧U</kbd></span></div>
  </div>

  <div class="card">
    <h2>Why Sheaf exists</h2>
    <p style="margin:0 0 10px">Every developer ends up with the same pile: a header switcher, a JSON viewer, a cookie editor, a request mocker — each a separate extension, each asking for "read and change all your data on all sites", each one more thing to re-install on a new machine.</p>
    <p style="margin:0 0 10px">Worse, the workarounds get dangerous. Testing against an internal cert or a CORS-blocked API usually ends with someone running their <b>daily browser</b> with <code>--disable-web-security</code>. That's a browser you also read email in.</p>
    <p style="margin:0"><b>A sheaf binds separate papers into one volume.</b> The tools are built in, written from scratch, and scoped to a browser you only use for development.</p>
  </div>

  <div class="card">
    <h2>Loading Chrome extensions</h2>
    <p style="margin:0 0 8px">Add unpacked extensions or <code>.crx</code> files at <a href="sheaf://extensions">sheaf://extensions</a>. Sheaf unpacks <code>.crx</code> itself and re-loads your extensions on every launch.</p>
    <p style="margin:0"><b>Be aware:</b> Electron implements only part of the Chrome extension API, so some extensions won't work — and a header-modifying extension <i>cannot</i> work, because Electron has no <code>declarativeNetRequest</code>. That's precisely why Letterhead is built in rather than bundled as an extension.</p>
  </div>

  <div class="card">
    <h2>Built with</h2>
    <div class="kv"><b>Electron</b><span>${escapeHtml(i.electron)} — Chromium ${escapeHtml(i.chrome)}, Node ${escapeHtml(i.node)}</span></div>
    <div class="kv"><b>UI</b><span>React + TypeScript, no component framework</span></div>
    <div class="kv"><b>Storage</b><span>SQLite (better-sqlite3), local file only</span></div>
    <div class="kv"><b>Licence</b><span>MIT — all dependencies MIT/Apache-2.0</span></div>
    <p class="foot"><a href="sheaf://about">Full system details →</a></p>
  </div>

  <div class="card">
    <h2>Security &amp; privacy</h2>
    <div class="kv"><b>Local only</b><span>Settings, history, bookmarks, downloads and tool rules live in a SQLite file on this machine. There is no account, no sync, no telemetry.</span></div>
    <div class="kv"><b>No network calls of its own</b><span>Sheaf never phones home. The home page's sky and greeting come from your system clock — no weather service, no IP geolocation, no analytics. The only requests made are the ones you make by browsing.</span></div>
    <div class="kv"><b>Private windows</b><span>Use a throwaway in-memory session — no history, no downloads recorded, no cookies kept.</span></div>
    <div class="kv"><b>Bookmark icons</b><span>Captured once while you're on the site and stored locally. Showing the bookmarks bar never pings the sites you bookmarked.</span></div>
    <div class="kv"><b>Spellcheck</b><span>On Windows and Linux, Chromium downloads dictionaries from Google's CDN — so Sheaf turns spellcheck off there. macOS uses the OS spellchecker, which downloads nothing, so it stays on.</span></div>
    <div class="kv"><b>Web pages are untrusted</b><span>Every page runs sandboxed, with context isolation on and Node disabled. Page content can't reach the browser's own APIs.</span></div>
    <div class="kv"><b>Clipboard</b><span>Only Sheaf's own <code>sheaf://</code> pages may read it (for Folio's paste button). Websites cannot.</span></div>
    <div class="kv"><b>Your tool rules never leave</b><span>Headers, mocks and cookies you configure are applied locally and stored locally.</span></div>
    <p class="foot">Sheaf is <b>not code-signed</b>, so macOS and Windows warn on first launch — see the README for the one-time steps. It renders untrusted web content, so keep it updated: Chromium security fixes arrive with each Electron release.</p>
  </div>

  <div class="card">
    <h2>Open source — report an issue or contribute</h2>
    <p style="margin:0 0 10px">Sheaf is MIT licensed and developed in the open. Bug reports and pull requests are welcome.</p>
    ${
      REPO_IS_PLACEHOLDER
        ? `<p class="foot" style="color:var(--danger)"><b>The repository URL isn't set yet.</b> It's a single placeholder constant (<code>src/shared/repo.ts</code>) — deliberately not a guessed URL. Once the GitHub org is decided, set <code>SHEAF_REPO</code> and every link here, in the README and in CONTRIBUTING follows.</p>`
        : `<div class="kv"><b>Report a bug</b><span><a href="${SHEAF_NEW_ISSUE}">Open an issue →</a></span></div>
           <div class="kv"><b>Contributing</b><span><a href="${SHEAF_CONTRIBUTING}">CONTRIBUTING.md →</a></span></div>
           <div class="kv"><b>Security issues</b><span><a href="${SHEAF_SECURITY}">Report privately →</a></span></div>
           <div class="kv"><b>Source</b><span><a href="${SHEAF_REPO}">${escapeHtml(SHEAF_REPO)}</a></span></div>`
    }
    <p class="foot">A good bug report includes: what you did, what you expected, what happened, and the versions from <a href="sheaf://about">sheaf://about</a>. If a tool misbehaved, say which one and paste the rule.</p>
  </div>

  <div class="card">
    <h2>Reset Sheaf</h2>
    <p style="margin:0 0 10px">Erase all local data — settings, history, bookmarks, cookies, storage, and installed extensions — and restart as if freshly installed. There is no undo.</p>
    <button class="danger-btn" id="reset">Reset Sheaf…</button>
    <div class="reset-confirm" id="rc">
      <p style="font-size:12.5px;color:var(--fg-muted)">Type <b style="color:var(--danger)">CONFIRM</b> to erase everything:</p>
      <input id="ct" spellcheck="false"><button class="danger-btn" id="doReset" disabled>Erase &amp; restart</button>
    </div>
  </div>
<script>
  var api = window.sheafInternal
  var rc=document.getElementById('rc'), ct=document.getElementById('ct'), doReset=document.getElementById('doReset')
  document.getElementById('reset').addEventListener('click', function(){ rc.classList.add('on'); ct.focus() })
  ct.addEventListener('input', function(){ doReset.disabled = ct.value !== 'CONFIRM' })
  doReset.addEventListener('click', function(){ if(ct.value==='CONFIRM'){ doReset.textContent='Erasing…'; api.invoke('app:factoryReset') } })
</script>
</body></html>`
}

function folioShell(): string {
  // Intentionally near-empty: Folio's content script owns everything here. The
  // CSP allows the inline styles the script injects.
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Folio</title></head>
<body></body></html>`
}

/**
 * The extensions manager. It's interactive, so it drives the narrow
 * `window.sheafInternal` IPC bridge exposed by the content preload for sheaf://
 * pages. Vanilla JS — no bundler reaches internal pages.
 */
function extensionsPage(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Extensions</title><style>${PAGE_CSS}${EXT_CSS}</style></head>
<body><div class="wrap">
  <h1>Extensions</h1>
  <p class="tag">Load unpacked Chrome extensions or <code>.crx</code> files. Support is limited to what Electron implements — some extensions won't work. Nothing is shared outside this machine.</p>
  <div class="ext-actions"><button id="add" class="ext-add">Add extension…</button><span id="msg" class="ext-msg"></span></div>
  <div id="list" class="list"></div>
  <p class="foot">Extensions must be re-loaded on each launch; Sheaf does this for you.</p>
</div>
<script>
  const api = window.sheafInternal
  const listEl = document.getElementById('list')
  const msgEl = document.getElementById('msg')
  function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
  function render(items){
    if(!items.length){ listEl.innerHTML = '<div class="none">No extensions installed.</div>'; return }
    listEl.innerHTML = items.map(function(e){
      return '<div class="item"><div class="ext-main"><div class="ext-name">'+esc(e.name)+
        ' <span class="ext-ver">'+esc(e.version)+'</span></div>'+
        (e.error?'<div class="ext-err">'+esc(e.error)+'</div>':'<div class="ext-id">'+(e.chromeId?esc(e.chromeId):'disabled')+'</div>')+
        '</div><div class="ext-btns">'+
        '<button data-act="toggle" data-id="'+e.installId+'" data-en="'+(e.enabled?'0':'1')+'">'+(e.enabled?'Disable':'Enable')+'</button>'+
        '<button data-act="remove" data-id="'+e.installId+'" class="danger">Remove</button>'+
        '</div></div>'
    }).join('')
  }
  async function refresh(){ render(await api.invoke('extensions:list')) }
  document.getElementById('add').addEventListener('click', async function(){
    msgEl.textContent = ''
    try { const r = await api.invoke('extensions:install'); if(r.error) msgEl.textContent = r.error; render(r.list) }
    catch(err){ msgEl.textContent = String(err) }
  })
  listEl.addEventListener('click', async function(ev){
    const b = ev.target.closest('button'); if(!b) return
    const id = b.getAttribute('data-id'), act = b.getAttribute('data-act')
    if(act==='remove') render(await api.invoke('extensions:remove', id))
    else if(act==='toggle') render(await api.invoke('extensions:setEnabled', id, b.getAttribute('data-en')==='1'))
  })
  refresh()
</script>
</body></html>`
}

/** Manage custom device-simulation profiles (req 7). */
function devicesPage(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Devices</title><style>${PAGE_CSS}${EXT_CSS}
  .dev-form { display:grid; grid-template-columns:2fr 1fr 1fr 1fr; gap:8px; margin-bottom:10px; }
  .dev-form input { height:32px; padding:0 10px; border:1px solid var(--border-strong); border-radius:6px;
    background:var(--bg); color:var(--fg); font:inherit; font-size:13px; }
  .dev-ua { grid-column:1 / -1; }
  .dev-opts { grid-column:1 / -1; display:flex; gap:14px; align-items:center; font-size:12.5px; color:var(--fg-muted); }
  .builtin { opacity:.65; }
</style>${THEME_SCRIPT}</head>
<body><div class="wrap" style="max-width:720px">
  <h1>Devices</h1>
  <p class="tag">Profiles for the device-simulation dropdown. Built-ins can't be changed; add your own below. Sizes are CSS pixels.</p>

  <div class="ext-actions" style="display:block">
    <div class="dev-form">
      <input id="label" placeholder="Name (e.g. Kiosk 720p)">
      <input id="w" type="number" placeholder="Width">
      <input id="h" type="number" placeholder="Height">
      <input id="dpr" type="number" step="0.1" placeholder="DPR" value="2">
      <input id="ua" class="dev-ua" placeholder="User agent (blank = leave the browser's own)">
      <div class="dev-opts">
        <label><input type="checkbox" id="mobile" checked> Mobile (touch-style viewport)</label>
        <button class="ext-add" id="add">Add device</button>
        <span id="msg" class="ext-msg"></span>
      </div>
    </div>
  </div>

  <div id="list" class="list"></div>
</div>
<script>
  var api = window.sheafInternal
  var listEl = document.getElementById('list'), msg = document.getElementById('msg')
  function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  function row(d, custom){
    return '<div class="item'+(custom?'':' builtin')+'"><div class="ext-main"><div class="ext-name">'+esc(d.label)+
      ' <span class="ext-ver">'+d.width+'×'+d.height+' @'+d.deviceScaleFactor+'x'+(d.mobile?' · mobile':'')+'</span></div>'+
      '<div class="ext-id">'+esc((d.userAgent||'(browser default UA)').slice(0,72))+'</div></div>'+
      '<div class="ext-btns">'+(custom?'<button class="danger" data-id="'+esc(d.id)+'">Remove</button>':'<span class="ext-ver">built-in</span>')+'</div></div>'
  }
  function render(s){
    var custom = s.customDevices || []
    listEl.innerHTML = ${JSON.stringify(DEVICE_PRESETS)}.map(function(d){return row(d,false)}).join('') +
      custom.map(function(d){return row(d,true)}).join('')
  }
  function load(){ api.invoke('settings:get').then(render) }
  document.getElementById('add').addEventListener('click', function(){
    msg.textContent = ''
    var label=document.getElementById('label').value.trim()
    var w=parseInt(document.getElementById('w').value,10), h=parseInt(document.getElementById('h').value,10)
    var dpr=parseFloat(document.getElementById('dpr').value)
    if(!label){ msg.textContent='Give the device a name.'; return }
    if(!(w>0&&h>0)){ msg.textContent='Width and height must be positive numbers.'; return }
    if(!(dpr>0)){ msg.textContent='DPR must be a positive number.'; return }
    api.invoke('settings:get').then(function(s){
      var next=(s.customDevices||[]).concat([{
        id:'custom-'+Date.now(), label:label, width:w, height:h, deviceScaleFactor:dpr,
        mobile:document.getElementById('mobile').checked, userAgent:document.getElementById('ua').value.trim()
      }])
      return api.invoke('settings:set',{customDevices:next})
    }).then(function(s){
      render(s); msg.textContent=''
      document.getElementById('label').value=''; document.getElementById('w').value=''
      document.getElementById('h').value=''; document.getElementById('ua').value=''
    })
  })
  listEl.addEventListener('click', function(e){
    var b=e.target.closest('button[data-id]'); if(!b) return
    api.invoke('settings:get').then(function(s){
      return api.invoke('settings:set',{customDevices:(s.customDevices||[]).filter(function(d){return d.id!==b.getAttribute('data-id')})})
    }).then(render)
  })
  load()
</script>
</body></html>`
}

const EXT_CSS = `
  .ext-actions { display:flex; align-items:center; gap:12px; margin-bottom:16px; }
  .ext-add { height:34px; padding:0 16px; border:none; border-radius:7px; background:var(--accent); color:#fff; font:inherit; font-weight:500; cursor:pointer; }
  .ext-msg { color:var(--danger); font-size:12.5px; }
  .ext-main { flex:1; min-width:0; }
  .ext-name { font-weight:600; }
  .ext-ver { color:var(--fg-faint); font-weight:400; font-size:12px; }
  .ext-id { color:var(--fg-faint); font-size:11.5px; font-family:'SF Mono',ui-monospace,Menlo,monospace; }
  .ext-err { color:var(--danger); font-size:11.5px; }
  .ext-btns { display:flex; gap:6px; }
  .ext-btns button { height:28px; padding:0 12px; border:1px solid var(--border-strong); border-radius:6px; background:var(--bg); color:var(--fg); font:inherit; font-size:12px; cursor:pointer; }
  .ext-btns button:hover { background:var(--bg-hover); }
  .ext-btns button.danger:hover { color:var(--danger); border-color:var(--danger); }
`

function shell(title: string, heading: string, tag: string, body: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PAGE_CSS}${LIST_CSS}</style></head>
<body><div class="wrap">
  <h1>${escapeHtml(heading)}</h1>
  <p class="tag">${escapeHtml(tag)}</p>
  ${body}
</div></body></html>`
}

const LIST_CSS = `
  .list { border:1px solid var(--border); border-radius:8px; background:var(--bg-elev); overflow:hidden; }
  .item { display:flex; gap:12px; align-items:baseline; padding:10px 14px; border-bottom:1px solid var(--border); }
  .item:last-child { border-bottom:none; }
  .item a { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-decoration:none; }
  .item .url { color:var(--fg-faint); font-size:11.5px; }
  .when { color:var(--fg-faint); font-size:11.5px; white-space:nowrap; font-variant-numeric:tabular-nums; }
  .none { padding:28px 14px; color:var(--fg-faint); text-align:center; }
`

function when(ms: number): string {
  const d = new Date(ms)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function historyPage(): string {
  const rows = searchHistory('', 300)
  const body = rows.length
    ? `<div class="list">${rows
        .map(
          (r) =>
            `<div class="item"><a href="${escapeHtml(r.url)}">${escapeHtml(
              r.title || r.url
            )}<div class="url">${escapeHtml(r.url)}</div></a><span class="when">${when(
              r.visitedAt
            )}</span></div>`
        )
        .join('')}</div>`
    : '<div class="list"><div class="none">No history yet.</div></div>'
  return shell('History', 'History', `${rows.length} pages. Private windows are never recorded.`, body)
}

function bookmarksPage(): string {
  const rows = listBookmarks().filter((b) => b.kind === 'bookmark')
  const body = rows.length
    ? `<div class="list">${rows
        .map(
          (b) =>
            `<div class="item"><a href="${escapeHtml(b.url ?? '')}">${escapeHtml(
              b.title
            )}<div class="url">${escapeHtml(b.url ?? '')}</div></a><span class="when">${when(
              b.createdAt
            )}</span></div>`
        )
        .join('')}</div>`
    : '<div class="list"><div class="none">No bookmarks yet. Press ⌘D on any page.</div></div>'
  return shell('Bookmarks', 'Bookmarks', `${rows.length} saved.`, body)
}

function bytes(n: number): string {
  if (n <= 0) return '—'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`
}

function downloadsPage(): string {
  const rows = listDownloads(200)
  const body = rows.length
    ? `<div class="list">${rows
        .map(
          (d) =>
            `<div class="item"><a href="${escapeHtml(d.url)}">${escapeHtml(
              d.filename
            )}<div class="url">${escapeHtml(d.state)} · ${bytes(d.receivedBytes)}${
              d.totalBytes > 0 ? ` of ${bytes(d.totalBytes)}` : ''
            }</div></a><span class="when">${when(d.startedAt)}</span></div>`
        )
        .join('')}</div>`
    : '<div class="list"><div class="none">No downloads yet.</div></div>'
  return shell('Downloads', 'Downloads', `${rows.length} items.`, body)
}
