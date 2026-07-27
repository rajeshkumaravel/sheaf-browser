# Sheaf — Engineering Plan

> *A sheaf is a bundle of separate papers gathered and bound into one.*
> Sheaf binds **Letterhead**, **Folio**, **Imprint** and **Mailroom** into a
> single browser for development teams.

**Status:** Draft for review
**Product name:** Sheaf · **Scheme:** `sheaf://` · **App ID:** `com.<org>.sheaf`
**Target platforms:** Windows, macOS, Linux
**License:** MIT (open source) — see §12
**Stack:** Electron 36 + electron-vite + TypeScript + React + zustand + better-sqlite3 + electron-builder
(matches the existing `electron-sql` / `kafka-offset-explorer` house style)

---

## 1. Motivation

A bundled browser for the development team, shipping the tools they currently
bolt onto Chrome — header editing, JSON viewing, cookie/storage editing,
request mocking — as first-class, in-house features. Every bundled tool is
written from scratch; none are third-party extensions.

Secondary benefit: it replaces the common practice of running a permanently
insecure Chrome (`--disable-web-security`, `--ignore-certificate-errors`) as a
daily driver.

---

## 2. Constraints that shape everything (verified, not assumed)

Electron's Chrome-extension support is deliberately limited. From the official
docs and confirmed against the Electron 36.9.5 typings:

| Capability | Status |
|---|---|
| `chrome.declarativeNetRequest` | **Absent** — not in Electron at all |
| `.crx` files | **Not supported** — unpacked directories only |
| Persistence across restarts | **None** — must re-load every boot |
| `chrome.webRequest` | Supported |
| `chrome.devtools.*`, `chrome.scripting` | Supported |
| `chrome.runtime`, `chrome.tabs`, `chrome.storage`, `chrome.management` | Partial (`storage.local` only) |

Electron's docs state plainly that arbitrary Chrome Web Store extensions are a
**non-goal** of the project.

### The consequence

**ModHeader cannot be mirrored as a Chrome extension.** Real ModHeader is
Manifest V3 and modifies headers via `declarativeNetRequest`, because MV3
removed blocking `webRequest`. An MV3 clone inside Electron would install,
render its UI, and then silently fail to modify a single header.

**The native path is strictly more powerful.** `session.webRequest` in the main
process is not bound by MV3 rules: it handles request *and* response headers,
has no rule-count ceiling, and has no service-worker lifecycle to fight.

### Load-bearing gotcha

Electron permits **only one listener per `webRequest` event per session**. If
each plugin registers its own, they silently clobber one another. **The plugin
host owns the listener and multiplexes plugins through it.** Cheap now,
painful to retrofit.

---

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | In-house plugins are **native TS modules**, not Chrome extensions | `declarativeNetRequest` does not exist; native gets response headers too |
| D2 | **Own minimal CRX loader** for user-uploaded extensions | **Required** for MIT release: `electron-chrome-extensions` is GPL-3 and would virally block open-sourcing. A CRX is a zip + header |
| D3 | v1 plugins: **Letterhead, Folio, Imprint, Mailroom** (headers, JSON, cookies/storage, mock+HAR) | Covers the team's actual Chrome dependencies. All written from scratch — §12 |
| D5 | **Distinctive naming**, stationery/post family, with a function descriptor in the UI | Brand identity + self-teaching dock; also zero linguistic overlap with "ModHeader" (§12) |
| D4 | **Complete module** — full browser + all plugins in one delivery | No thin-shell phase; the tab/session model is built properly first so plugins never need rework |

`electron-chrome-extensions` v4.9.0 was evaluated and **rejected**: dual-licensed
GPL-3 / paid commercial. GPL-3 is viral — linking it makes an MIT release
**impossible**. This is a hard blocker, not a preference. Its MIT companion
`electron-chrome-web-store` remains available if store installs are ever wanted.

---

## 4. Architecture

### View model

One **`WebContentsView` per tab**. Not `<webview>` (discouraged by Electron),
not `BrowserView` (deprecated).

The React browser chrome is the `BrowserWindow`'s own renderer; tab views
composite *above* it.

> **Trap:** native views ignore DOM stacking. Toolbar dropdowns, the omnibox
> suggestion list, and plugin popups will render *underneath* the page content.
> They need a dedicated transparent overlay `WebContentsView`. This is designed
> in from the start, not bolted on.

### Sessions

| Mode | Partition |
|---|---|
| Normal | `persist:profile-default` |
| Private | `session.fromPartition('private-<uuid>')` — no `persist:` prefix = in-memory, destroyed with the window |
| Named profile | `persist:profile-<id>` — separate logins per environment |

### DevTools

Full Chrome DevTools already ships with Electron — Console, Sources, Elements,
Network, Performance, Application, Memory. Docking into our own UI uses
`setDevToolsWebContents` pointed at a second `WebContentsView` we position.

### Device simulation

- `webContents.enableDeviceEmulation()` — viewport, scale, device pixel ratio
- CDP via `webContents.debugger` for the rest:
  - `Emulation.setDeviceMetricsOverride` (`mobile: true`)
  - `Emulation.setTouchEmulationEnabled`
  - `Network.emulateNetworkConditions` — throttling profiles
  - `Emulation.setTimezoneOverride` / `setGeolocationOverride`
  - UA override incl. UA-CH `userAgentMetadata`

### Internal pages

The **`sheaf://`** scheme, served via `protocol.handle()` and registered as
privileged via `protocol.registerSchemesAsPrivileged()` **before `app.ready`**
(else it gets an opaque origin and `fetch`/storage break inside internal pages):

- `sheaf://about` — **requirement 3**: Electron/Chromium/Node/V8 versions,
  platform, arch, GPU status, user-data path, loaded plugin versions.
  Conventional name deliberately — every browser user knows where to look.
- `sheaf://settings`, `sheaf://plugins`, `sheaf://history`, `sheaf://downloads`

---

## 5. Folder structure (requirements 7, 8)

```
electron-browser/
├─ plugins/                      # req 7 — in-house plugin source, one dir each
│  ├─ letterhead/                # HTTP headers — NOT "mod-header", see §12
│  │  ├─ plugin.json             # id, name, version, permissions, ui contributions
│  │  ├─ main/index.ts           # main-process hooks (webRequest, cookies…)
│  │  ├─ renderer/Panel.tsx      # React panel UI
│  │  └─ shared/types.ts
│  ├─ folio/                     # JSON viewer
│  │  ├─ plugin.json
│  │  ├─ content/inject.ts       # runs inside the page
│  │  └─ renderer/Panel.tsx
│  ├─ imprint/                   # cookies & storage
│  └─ mailroom/                  # mock, redirect & record
├─ extensions/                   # third-party unpacked chrome extensions (user-uploaded)
├─ resources/                    # app icons
├─ scripts/                      # make-icons, dev-app-name, verify
├─ src/
│  ├─ main/
│  │  ├─ index.ts                # app lifecycle
│  │  ├─ ipc.ts                  # typed IpcResult envelope
│  │  ├─ windows/                # window + view layout manager (incl. overlay view)
│  │  ├─ tabs/                   # tab model, WebContentsView lifecycle
│  │  ├─ sessions/               # profiles, private sessions, proxy, certs
│  │  ├─ devtools/               # docked devtools views
│  │  ├─ emulation/              # CDP device simulation
│  │  ├─ downloads/              # will-download, progress, cancel/resume
│  │  ├─ permissions/            # setPermissionRequestHandler prompts
│  │  ├─ extensions/            # CRX unpack, registry, boot re-load
│  │  ├─ plugin-host/            # plugin runtime + webRequest multiplexer
│  │  ├─ protocols/              # sheaf:// internal pages
│  │  └─ store/                  # sqlite: settings, history, bookmarks, profiles
│  ├─ preload/
│  │  ├─ chrome.ts               # for the browser UI renderer
│  │  └─ content.ts              # for web content views (plugin content scripts)
│  ├─ renderer/src/
│  │  ├─ components/             # TabStrip, Omnibox, Toolbar, PluginDock, StatusBar
│  │  ├─ pages/                  # About, Settings, Plugins, History, Downloads
│  │  ├─ dialogs/                # Welcome, Help, Reset, Modal
│  │  ├─ state/store.ts          # zustand
│  │  └─ theme/global.css        # data-theme tokens (req 5)
│  └─ shared/                    # types.ts, ipc.ts, plugin-api.ts
```

**Build note:** first-party plugin panels are compiled into the chrome renderer
bundle via a static registry — they are first-party, so runtime loading buys
nothing. The runtime-loading path is Chrome extensions (`extensions/`). Clean
split: `plugins/` = build-time native, `extensions/` = runtime third-party.

---

## 6. Plugin SDK (D1)

Each plugin ships a `plugin.json` manifest and may contribute:

- **`main`** — a module receiving a scoped host API:
  - `onBeforeSendHeaders` / `onHeadersReceived` / `onBeforeRequest`
    (multiplexed by the host — plugins never touch `session.webRequest` directly)
  - `cookies`, `storage`, `tabs` (read tab/session context)
  - persistent settings, scoped to the plugin id
- **`content`** — a script injected into page views via the content preload
- **`renderer`** — a React panel mounted in the plugin dock, plus a toolbar
  button with optional badge

Plugin rules are always evaluated with tab + session context, so per-tab and
per-profile scoping works uniformly across every plugin.

---

## 7. v1 plugins (D3, D5)

Naming follows a **stationery/post family** — HTTP is correspondence. Every
plugin surfaces as `Name — descriptor` in the UI so the dock stays
self-teaching:

| Plugin | UI label | Function |
|---|---|---|
| `letterhead` | **Letterhead** — HTTP headers | The header at the top of a letter |
| `folio` | **Folio** — JSON | A leaf of a structured document |
| `imprint` | **Imprint** — Cookies & storage | What a site leaves behind on you |
| `mailroom` | **Mailroom** — Mock & record | Intercepts, redirects, holds, substitutes, logs |

### Letterhead — HTTP headers
> **Written from scratch. No ModHeader code, ever — see §12.**

Feature parity targets (specification, not implementation): named profiles,
per-row enable/disable, **request and response** headers, set/append/remove,
URL regex filters, resource-type filters, tab-scoped locking, comments,
import/export JSON, toolbar badge showing active profile.
Built on the multiplexed `webRequest` hooks.

### Folio — JSON
Detect `application/json` via `onHeadersReceived`, then render a tree from the
page's text content: collapse/expand, search, raw/parsed toggle, copy-path,
syntax highlight, virtualized for large documents.

### Imprint — cookies & storage
`session.cookies` API plus a content script for local/session storage. Edit,
add, delete, import/export.

### Mailroom — mock & record
Rules engine: stub a response, redirect a URL, delay, force-fail. Plus one-click
HAR capture via CDP for repro handoff to backend teams. (Shares the rule-scoping
model with Letterhead — both evaluate against tab + session context.)

---

## 8. Browser features (requirements 1, 4)

Tabs, new tab, tab reorder/detach, private windows, back/forward/reload/home,
omnibox with history + search-engine suggestions, find-in-page
(`webContents.findInPage`), zoom, context menus, bookmarks, history, downloads
manager, permission prompts, basic-auth dialogs (`app.on('login')`), certificate
error handling, print, favicon/title tracking, full DevTools, device simulation.

Theme (requirement 5): `data-theme` token CSS ported from QueryVault, light/dark
toggle persisted in the settings table.

From the reference apps (requirement 9): welcome dialog, username greeting,
reset application, help section. Ported in spirit, not verbatim — **the
reference's live-weather feature is deliberately NOT ported**: it called
commercial/non-commercial-only APIs and sent the user's IP to a third party. The
greeting and sky come from the system clock instead. See "the phone-home audit".

---

## 9. Backlog / future ideation

**Deferred from v1 (not selected, but recommended):**
- **Cert bypass + CORS relax toggles** — scoped, per-profile replacement for
  `--disable-web-security` / `--ignore-certificate-errors`. Strongest security
  argument for the project; worth reconsidering.

**Further ideas:**
- **Workspaces** — a named bundle of tabs + header profile + environment +
  proxy + device emulation, shareable as JSON via a Git repo. "Open the QA
  workspace" configures everything at once. This is what makes it a *team* tool
  rather than a browser with panels.
- JWT decoder — auto-detect `Authorization: Bearer`, decode, warn on expiry
- Environment switcher / proxy switcher (`session.setProxy`) per profile
- API client (Postman-lite) reusing browser session cookies
- Screenshot + annotate (`webContents.capturePage`) for ticket attachments
- Console log export / error watcher
- GraphQL payload pretty-printer
- Managed policy: IT-pushed defaults, allowed hosts, pinned tabs
- Command palette (Cmd+K)
- Telemetry off by default

---

## 10. Risks & non-goals

- **No Widevine DRM** — Netflix, Spotify, and some internal training/video
  portals will not play. **This is not a codec problem.** Electron's default
  build ships proprietary codecs (H.264/AAC), so MP4, YouTube and HTML5 video
  work fine. (Electron publishes a *separate* `ffmpeg-*.zip` asset — that's the
  non-proprietary build you'd swap in to *remove* those codecs.)

  The blocker is the **Widevine CDM**: Netflix/Spotify use EME + Widevine, and
  Electron does not bundle the CDM binary (proprietary, Google-licensed).
  `requestMediaKeySystemAccess('com.widevine.alpha')` simply fails. Netflix
  additionally performs a **VMP (Verified Media Path)** check before issuing a
  DRM licence.

  Castlabs' **ECS** fork solves both (installs the CDM on first launch, free VMP
  self-signing via their EVS portal) but is a **poor fit for an MIT project**:
  it replaces Electron with a vendor fork, ties releases to a vendor signing
  portal, and the CDM itself stays proprietary.

  **Decision: DRM streaming is an explicit non-goal.** This is a developer
  browser.
- **No Chrome Web Store, no MV3 DNR extensions, no password manager, no
  autofill, no sync.** Requirement 6 loads *some* extensions, not most.
  **Publish a compatibility matrix** rather than promising "loads Chrome plugins."
- **This is a browser — it renders hostile content, and we now own the patch
  cadence.** Chromium CVEs reach Electron weeks behind Chrome. Shipping this
  internally is a standing security commitment, not a one-time build. Needs a
  named owner and an auto-update channel from day one.
- **Code signing: declined (2026-07-16).** No Developer ID / EV cert. First
  launch is warned on macOS and Windows; users clear it once (README). The one
  hard consequence is that **macOS auto-update won't work** — Mac updates are
  manual. Accepted for an internal/OSS dev tool.
- Content views must run `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`, with a strict `setWindowOpenHandler`.

---

## 11. Build order (D4 — complete module, single delivery)

### Status

**Done — foundation, browser core, standard browser features, the overlay view,
plugin host, all four plugins (Letterhead, Folio, Imprint, Mailroom), and the
third-party extension loader.** `npm run verify` drives the real app and passes
**54/54**. The whole plugin motivation (D3) is delivered.

**Third-party Chrome extension loader (req 6, D2).** Own CRX loader, no GPL
dependency:
- Unpacks `.crx` ourselves (a CRX is a header + ZIP; `src/main/extensions/crx.ts`
  strips the CRX2/CRX3 header, `adm-zip` (MIT) unzips the rest). Also accepts an
  unpacked folder.
- A registry in `userData/extensions` + `loadAllExtensions()` on every boot,
  since Electron doesn't remember extensions across restarts.
- Loads into the **default profile only**, never a private window.
- Managed at **`sheaf://extensions`** (Tools ▸ Extensions): install / enable /
  disable / remove, with honest copy about Electron's limited support.
- Verified end-to-end: an installed extension's content script actually runs on
  a page, and stops after removal.

**`window.sheafInternal`** — a narrow, allow-listed IPC bridge the content
preload exposes **only to `sheaf://` documents** (checked per-document load).
It's how interactive internal pages (extensions manager, home, welcome, help)
reach main without giving any untrusted page IPC access.

**Basics from the reference apps (req 5, req 9) — done, ported browser-native.**
Because native tab views composite over the chrome, these are internal pages in
the tab, not floating modals:
- **`sheaf://welcome`** — first-launch onboarding (just a name) → home.
- **`sheaf://home`** — new-tab/home page: time-aware greeting with the user's
  name over a sky driven entirely by the **system clock** (`shared/skyArt.ts`)
  — **no weather API, no IP geolocation, no network call of any kind** — plus
  search and quick links.
- **`sheaf://help`** — tools, keyboard shortcuts, extension how-to, about, and a
  CONFIRM-gated **factory reset** (wipes SQLite + sessions + extensions, then
  relaunches).
- **Theme toggle** — toolbar button cycling dark / light / system (☾ ☀︎ ◐),
  persisted; internal pages follow it via `data-theme`. The engine already
  existed; this added the control.
- **Home button** in the toolbar.

**Docked DevTools + device simulation (req 4) — done.**
- **DevTools dock** into a `WebContentsView` we position via
  `setDevToolsWebContents`, *not* Electron's built-in `mode:'bottom'` — the
  built-in docking is relative to the native window and knows nothing about our
  chrome height or plugin dock, so it can't compose with our layout. Dock
  bottom/right, toggle, per-tab, disposed with the tab.
  Verified present: **Elements, Console, Sources, Network, Application**
  (+ Performance, Memory, Security, Lighthouse, Recorder). They're Chrome's own
  panels — we only dock them.
- **Device simulation** uses `enableDeviceEmulation` + `setUserAgent`, **not**
  the CDP debugger: `webContents.debugger` can't attach while DevTools is open
  (one debugger per webContents), so a CDP emulator would break DevTools and
  vice versa. This path coexists — verified with both on at once. Presets
  letterbox the page to the device's CSS size and swap the UA (which also fixes
  the "we announce ourselves as Electron" leak on emulated devices).
  Throttling / touch / geolocation need CDP, so they stay in DevTools' own
  device toolbar — a deliberate boundary, not an omission.
- `layout()` now composes three things in order: plugin dock width → DevTools
  strip → device letterbox. All three can be active together.

**Uploads & downloads — verified, not assumed.**
- **Uploads** need no code: Chromium's own file picker backs `<input type=file>`
  inside the content view, and `sandbox: true` doesn't block it. A test proves a
  File reaches an input and a multipart POST reaches a real server.
- **Downloads** now **save to the OS Downloads folder without prompting**
  (Chrome's default). Previously, with no `setSavePath`, Electron opened a modal
  save dialog on every download. Names uniquify (`report (1).pdf`) rather than
  clobber. A toolbar button with an in-flight badge was added — the
  `push:downloads` event existed but nothing in the UI listened to it.

### Review round 1 — fixes (2026-07-16)

1. **Letterhead's `Append` silently did nothing** (reported: a User-Agent append
   never reached the server). Append on an existing header returned an **array**
   `[old, new]`, but Electron's `onBeforeSendHeaders` takes
   `Record<string,string>` for request headers — an array is invalid, so the
   header was dropped entirely. Now request appends join into one string, with
   the separator the header actually wants: `user-agent` → space (RFC 9110
   product tokens), `cookie` → `; `, everything else → `, `. Response headers
   still append as an array, which is correct there. Regression-tested against a
   real server.
2. **New rules default to `Append`** (was `Set`).
3. **URL filters support globs** — `example.com/*` matches any path/query/
   fragment. One `matchesUrlFilter` in shared, used by Letterhead and Mailroom
   so they can't drift: `/regex/` → regex, contains `*` → glob, else substring.
   Note a glob is literal: `example.com/*` does **not** match `example.com:8080/…`
   (the port sits before the slash).
4. **Blank rules can't stack up** — Add now highlights the empty field instead
   of appending another empty row (the report showed eight).
5. **Theme applies to already-open pages** via `nativeTheme.themeSource`, which
   forces `prefers-color-scheme` in every page — internal pages *and* real
   websites — instead of only affecting new loads.
6. **DevTools dock is draggable.** The divider is its own native view: a DOM
   divider in the chrome would be painted under the page/DevTools views, and
   mid-drag the pointer leaves the thin grip — so on mousedown main **expands
   the transparent splitter over the whole content area** to keep receiving
   mousemove, then shrinks it back. Clamped to 15–85% so neither pane collapses.
7. **Custom device profiles** at `sheaf://devices`, merged with the built-ins.
8. **Home page art**: icon + a time-of-day scene (dawn/day/dusk/night), drawn
   from scratch — original SVG/CSS geometry, never stock imagery. The hero stays
   light on the scene in both themes (dimming it for light mode looked muddy).
   *(Superseded by round 3: the weather-driven variants and `weatherArt.ts` are
   gone; it's `shared/skyArt.ts`, clock-driven only.)*
9. **Greeting chip** at the right end of the tab strip — deliberately *not* in
   the URL bar: the toolbar is already dense and the omnibox must stay a wide,
   clean field, while that strip area was empty drag space. *(Round 3 dropped
   the temperature/condition from it — clock only.)*

Also fixed while here: **settings changed on an internal page never reached the
chrome** (a device added at `sheaf://devices` wouldn't appear in the toolbar
dropdown until restart). Main now broadcasts `push:settings` to every window.

### Review round 2 — fixes (2026-07-16)

1. **Live ripple when a Letterhead rule fires.** Main coalesces fired rule ids
   on a 150ms timer — the webRequest hook is the hot path, and a page load would
   otherwise send dozens of IPC messages — then broadcasts them. The toolbar icon
   ripples, and inside the panel only the rule that *actually matched* gets a
   live dot. Tested both ways: the matching rule ripples, a non-matching one
   never does.
2. **Animated sky** — drifting clouds, birds by day, stars at night, a wind
   gust. All CSS keyframes over generated SVG (`SKY_FX_CSS` + `sceneAnimation`),
   so no stock assets and no network. Honors `prefers-reduced-motion`.
   *(Round 3 removed the rain/snow variants with the weather API.)*
3. **Help rewritten** against the reference apps' structure (About / Why it
   exists / How to / Built with / Security / Contributing), including the honest
   notes: no telemetry, private windows keep nothing, pages are sandboxed,
   clipboard is `sheaf://`-only, and the app is unsigned. *(Round 3 replaced the
   "weather is opt-in" note with "no network calls of its own".)*
4. **Open-source surface**: report-an-issue + contributing in the README,
   CONTRIBUTING and the in-app Help. The repo URL was **not** known, so rather
   than guess a plausible-looking URL (which would ship silently wrong) it is a
   single flagged constant — `SHEAF_REPO` in `src/shared/repo.ts`. While it's a
   placeholder the Help page says so in red instead of rendering dead links.
5. **Greeting chip was unreadable in light mode.** The sky icons use near-white
   fills because they're drawn for the dark home scene; on a light toolbar the
   moon was invisible. `skyIcon` takes a `variant`: `scene` (light, on the
   gradient) vs `ui` (`currentColor`, readable in both themes).

### Review round 3 — the phone-home audit (2026-07-16)

**Live weather is removed.** It called two APIs whose terms we were breaching,
and I'd ported them from the reference app without auditing — the exact licence
check that's a hard rule for npm dependencies (§12), which I simply never
applied to *network APIs*. Same class of risk, missed.

| Service | Terms | Verdict |
|---|---|---|
| `ipapi.co` (IP → city) | Paid service; free tier is *"not meant for use in production or deployments"* | **Violation.** Also sent every user's IP to a third party to decorate a new tab. |
| `open-meteo.com` | *"free API services for non-commercial purposes"* only; names commercial entities explicitly | **Violation** for an in-house corporate tool. |

Replaced with `shared/skyArt.ts`: the greeting, icon (sun / sunrise / sunset /
moon), scene and animation all derive from the **system clock**. No network, no
licence, no IP leaving the machine.

**Audit of everything else with similar behaviour — two more found and fixed:**

1. **The bookmarks bar pinged every bookmarked site.** It built
   `${origin}/favicon.ico` and handed it to `<img>`, so merely *having Sheaf
   open* sent the user's IP to every bookmarked origin, unprompted, without
   visiting them. Chrome paints from a local favicon cache instead. Fixed:
   icons are captured once at bookmark time (from the page you're already on, so
   nothing new is disclosed) and stored as a **data URI**; rendering makes no
   requests.
2. **Chromium downloads spellcheck dictionaries from Google's CDN.** Electron's
   spellchecker is on by default and fetches Hunspell dictionaries from
   `redirector.gvt1.com` on **Windows and Linux** — handing Google an IP and a
   locale. macOS uses the OS spellchecker and downloads nothing. Fixed:
   spellcheck is enabled only on macOS.

**Clean after audit:** our own code has exactly one `fetch` (Folio re-reading the
page it's already on — same origin, cached). The only outbound hosts referenced
anywhere are the user's chosen search engine and the GitHub help links, both
user-initiated. Runtime deps are `better-sqlite3` + `adm-zip` — neither makes
network calls (`prebuild-install` is install-time only).

**Enforced by tests**, not just asserted: a recorder attaches to both sessions,
*proves it can see a known request* (so the check can't pass vacuously), then
asserts the home page makes zero outbound requests, that no
weather/geoip/Google/telemetry host is ever contacted, and that no bookmark
stores a remote favicon URL.

**Remaining:** auto-update wiring (Windows/Linux only — macOS can't, unsigned).
**Blocked on you:** the GitHub org/repo URL → set `SHEAF_REPO` once.

**Mailroom (mock/redirect + HAR)** extends the plugin host with two new
multiplexed events: `onBeforeRequest` (blocking — redirect / block / delay /
stub) and `onCompleted` (informational — HAR capture). Rules match by URL
substring or `/regex/`, persisted like Letterhead.
- **Stub** serves a fake body via a registered **`sheaf-stub://`** scheme, not a
  `data:` URL — Chromium blocks top-level navigation to `data:` and won't let
  `fetch` follow a redirect into one; a standard scheme has neither limit and
  can set content-type + CORS.
- **Block** cancels (`ERR_BLOCKED_BY_CLIENT`); **delay** awaits then continues;
  **redirect** sends to another URL.
- **HAR** capture toggles recording, correlates request/response by request id,
  and exports a spec-shaped HAR 1.2 log via a native save dialog.

**Imprint (cookies & storage editor)** is a dock-panel plugin like Letterhead,
but stateless — it holds nothing of its own and reads/writes *live* browser
state. Cookies come from the window's `Session`; local/sessionStorage from the
active tab's `webContents` via `executeJavaScript`. Every mutation returns a
fresh snapshot so the panel can't drift from reality. All values are
`JSON.stringify`-escaped before being spliced into page script — a cookie value
can't inject code. Three sections (Cookies / Local / Session), inline edit, add,
delete, clear; an empty state for origin-less pages (`sheaf://`, `about:blank`).

**Folio (JSON viewer)** is a **content-script** plugin — a different capability
from Letterhead's main-process hooks. It runs in the page's isolated world via
the content preload, detects JSON documents, and **replaces** Chromium's
built-in viewer (which has no search, copy-path, or collapse-all) with an
interactive tree: syntax colouring, lazy-expanded nodes, filter, copy-path on
any key. Decision recorded: replace, not augment — the built-in viewer lacks
exactly what a developer reaches for, and an in-page script gets full width that
the 340px dock never could.

Folio has two entry points sharing one renderer (`content/tree.ts`):
- **Auto-detect** — a JSON document you navigate to.
- **Scratchpad** (`sheaf://folio`, Tools ▸ JSON Viewer, ⌘⇧U) — paste or type
  JSON and view it as a tree, with a "Paste from clipboard" button, ⌘↵ to
  render, parse errors surfaced inline, and an ← Edit button back to the box.

Clipboard read is granted **only to `sheaf://` pages** via a scoped
`setPermissionRequestHandler` / `setPermissionCheckHandler`; every other
permission is denied. This is a safe default, not the full permission-prompt
system (still future work).

**The native-view overlay is solved.** The omnibox dropdown is its own
`WebContentsView`, sized to the list and re-added on show so it sits above the
tab views. Everywhere the dropdown isn't, the view doesn't exist, so the page
keeps receiving mouse events. Suggestions rank bookmarks over history (an
explicit save beats a visit), score history on frequency *and* recency together,
and always offer search last.

**Standard browser features:** bookmarks (star, bar, SQLite-backed, ⌘D),
find-in-page with match counts and next/previous, zoom with a chip that only
appears off 100%, downloads (capture, pause/cancel/reveal), page context menus
(link/image/selection/editable aware), tab context menus, a full native
application menu, and `sheaf://history` · `sheaf://bookmarks` ·
`sheaf://downloads`.

> Keyboard shortcuts live in the **native menu**, not a renderer keydown
> listener. Menu accelerators fire even when focus is inside a page's
> WebContentsView — a renderer listener never sees those keystrokes at all.

- Scaffold on Electron 43 / Vite 7 / React 19 / Node 24, typecheck clean
- `WebContentsView` tab manager, tab strip, omnibox, nav, private sessions
- SQLite store, theme tokens (light/dark/system), `sheaf://about`
- Plugin host + `webRequest` multiplexer; per-plugin namespaced storage
- **Letterhead**: profiles, request/response rules, set/append/remove, URL
  filters (substring or `/regex/`), enable toggles, live toolbar badge
- Plugin dock: a side panel that **shrinks** the page view rather than floating
  over it — sidesteps the native-view stacking problem entirely
- `scripts/verify.mjs` — captures page content via `capturePage()` in main,
  because Playwright's `page.screenshot()` cannot see native views; spins up a
  local echo server so header assertions don't depend on a third-party site

**Next:** Folio, Imprint, Mailroom; overlay view (omnibox suggestions are
blocked on it); docked DevTools; CRX loader.

### Bugs found in build — worth remembering

1. **`protocol.handle()` only registers on the default session.** Tabs run in
   named partitions, so `sheaf://` was invisible to them and silently failed.
   Must be registered on every session that can host a tab — including each
   private window's throwaway session. Same applies to `pluginHost.attach()`.
2. **Plugins must own their first-run defaults in main.** Returning
   `{profiles: []}` and expecting the panel to seed itself broke, because an
   empty-but-loaded state is truthy — the UI could not distinguish "still
   loading" from "genuinely empty". Defaults belong in `getState()`.
3. **`findInPage` with an explicit `findNext: false` never fires
   `found-in-page`.** Verified on Electron 43.1.1 — the docs say `findNext`
   defaults to `false`, but *passing* it as false silently breaks the search,
   while omitting the key works:

   | Call | Result |
   |---|---|
   | `findInPage(q)` | 2 matches |
   | `findInPage(q, {forward:true})` | 2 matches |
   | `findInPage(q, {forward:true, findNext:true})` | 2 matches |
   | `findInPage(q, {forward:true, findNext:false})` | **no event, ever** |

   Only ever pass `findNext` when it is true. This would have shipped as "find
   silently finds nothing on the first search".
4. **The find input must own its text locally.** Binding it to main's
   round-tripped value makes every keystroke wait on IPC — sluggish, and it
   drops characters when typing fast. Main owns match counts; the field owns
   its text. Same pattern as the omnibox draft.
5. **The omnibox must never navigate to a stale suggestion.** Suggestions are
   computed asynchronously, so pressing Enter right after typing could accept a
   suggestion computed for the *previous* keystroke — sending you to a site you
   never typed. Fix: `omnibox:accept` takes the input's current text, which
   wins unless a suggestion was explicitly chosen (arrow/hover/click) *for that
   exact text*. `selected` starts at `-1`, not `0`.
6. **A view can be positioned, sized, "visible" — and render nothing.**
   `overlay.show()` called `ensure()` (which starts an async `loadURL`) and
   pushed state immediately; the first push landed before the renderer had
   mounted its listener and was silently dropped, so the dropdown was **blank on
   first open every session**. Fix: queue state until `did-finish-load`, and
   warm the view at window construction.

   The tests passed anyway, because they asserted on view bounds and main's
   state. **Assert on what is painted** — `verify.mjs` now counts rendered
   `.sug-item` rows, not just a visible view.
7. **`dispose()` on the window's `closed` event runs after the window is already
   destroyed.** Touching `this.win.contentView` there throws "Object has been
   destroyed" (reported from the field). Child views die with the window, so
   dispose only needs to close its own webContents; guard every `contentView`
   access with `win.isDestroyed()`. The resize handler has the same hazard — it
   can fire mid-close before dispose runs, so `layout()` guards the destroyed
   window too, not just its own flag.

   `verify.mjs` now watches the main process's stderr for `Uncaught Exception`
   and fails the run on any — UI assertions never see a main-process throw. It
   also has a teardown step that opens a second window, opens its dropdown, and
   closes it, reproducing this exact crash.

   Note: warming the overlay at construction means each window is now **three**
   Playwright pages (chrome + overlay + tab content), and `app.firstWindow()`
   may return the overlay. The harness selects the `index.html` page explicitly
   and counts real `BrowserWindow`s, never Playwright page counts.
8. **Content scripts have DOM but were typechecked under the Node config.**
   Folio's content script uses `document`, but `plugins/**/content` fell under
   `tsconfig.node.json` (main process, `lib: ES2022`, no DOM). Preloads and
   content scripts run in a renderer — they have DOM *and* the preload's Node
   surface — so they get their own `tsconfig.preload.json` with `lib` including
   DOM. Keeping DOM *out* of the main config is deliberate: main must never
   touch `document`.
9. **Two plugins can interact — and a test can encode a false assumption.**
   Folio replaces a JSON document's DOM, so the Letterhead tests that read the
   echo response via `innerText` broke. This is correct behaviour (you *want*
   Folio's tree over a JSON API response). The fix made the test read the
   response via a fresh `fetch` instead — which also strengthened it: it now
   proves Letterhead injects headers on `fetch` requests, not just navigations.
10. **Titleless pages kept the previous tab's title.** Electron only updates a
    tab title on `page-title-updated`, which never fires for a page with no
    `<title>` (e.g. a raw JSON response) — so the tab kept showing the last
    page's title. A real browser falls back to the URL. Fix: on `did-navigate`,
    seed the title from `prettyUrl(url)`; a real title overrides it a moment
    later. Found by *looking at a screenshot*, not by a failing assertion —
    the Imprint capture showed "Folio — JSON scratchpad" over the echo server.
11. **The test read the wrong field, not the feature being broken.** Mailroom's
    block worked from the first try (`ERR_BLOCKED_BY_CLIENT`), but the test
    asserted on `tabInfo().error` — and `tabInfo` returns `{url,title,bounds}`
    from the webContents, which has no error field. Cost a long hunt through the
    plugin host and Chromium cancel semantics. Lesson: when a feature passes in
    isolation but fails in the suite, suspect the harness's assertion first.
    Tab errors live in the window state (`tabs:state`), not the webContents.
12. **Stub can't use a `data:` URL.** Chromium blocks top-level navigation to
    `data:` and won't let `fetch` follow a redirect into one. Mailroom serves
    stubs from a registered **`sheaf-stub://`** standard scheme instead, which
    has neither limit and can set content-type + CORS.

### Observations for upcoming work

- **Chromium already renders JSON** with its own pretty-print viewer. Folio must
  decide whether to replace or augment it — this changes Folio's design.
- **The User-Agent leaks `Sheaf/0.1.0 … Electron/43.1.1`.** Electron derives it
  from the app name. Some sites behave differently for unknown UAs; a UA
  override belongs with the device-simulation work.

There are **no calendar phases and no release gates** — everything ships
together. What follows is *dependency order*, which is real: build out of order
and you rewrite work.

```
foundation ──► sessions/tabs ──► plugin host ──► plugins
     │                │               │
     │                ├──► devtools/emulation (needs tab webContents for CDP)
     │                └──► CRX loader (needs session model)
     └──► store / theme / IPC (no dependencies — can start immediately)
```

**Why this order:**
- The **plugin host needs the session/tab model** — header rules are scoped
  per-tab and per-session; there is nothing to scope to before it exists.
- **Letterhead needs the `webRequest` multiplexer** — nothing to register
  against otherwise. Same for Mailroom.
- **Device simulation needs a tab's `webContents`** to attach the CDP debugger.
- **Signing needs an app** to sign.

Anything not on a dependency edge (theme tokens, SQLite store, IPC envelope,
dialogs ported from QueryVault) can proceed in parallel from day one.

### On effort

Code generation is not the bottleneck; a working browser with tabs and plugins
is **days, not weeks**. The long tail is what costs:

1. **`WebContentsView` overlay layering** — fiddly, needs real visual iteration
2. **Cross-platform quirks** — window controls, HiDPI, menus, view layering
   differ across Win/Mac/Linux; found by running, not by reasoning
3. **Code signing — declined.** No longer on the critical path (see §10 and
   §13). Builds ship unsigned; the trade-offs are documented.
4. Review cycles and testing against real sites

---

## 12. Licensing (open-source release)

**The project can ship as MIT.** Verified against the npm registry:

| License | Packages |
|---|---|
| MIT | electron, electron-vite, electron-builder, react, react-dom, zustand, better-sqlite3, vite, @vitejs/plugin-react, monaco-editor, @tanstack/react-table |
| Apache-2.0 | typescript, playwright-core |

Both licences are permissive and MIT-compatible. TypeScript and playwright-core
are **devDependencies** — they compile away or are test-only and never ship in
the binary, so the **runtime dependency tree is pure MIT**.

**Source vs binary.** The repo is MIT. The *distributed binary* embeds Chromium
(BSD-3-Clause + a long third-party list) and ffmpeg (LGPL-2.1). This is
compatible with MIT — permissive plus LGPL *dynamic* linking — but the bundled
licence notices must ship. `electron-builder` handles this automatically.

**Hard constraint:** no GPL dependencies, ever. See D2 — this is why
`electron-chrome-extensions` is rejected outright rather than merely disfavoured.

### Provenance — clean-room rule

Every bundled plugin is **written from scratch**. This is not a preference; it
is forced twice over.

**Architecturally:** ModHeader is MV3 + `declarativeNetRequest`. We are native
`session.webRequest` in the main process. Their code cannot run here at all —
there is nothing to copy that would function.

**Legally:** there is **no permissively-licensed ModHeader source in
existence.** Verified against GitHub:

| Repo | License | Usable for MIT? |
|---|---|---|
| `modheader/modheader` (official) | **None — all rights reserved** | No |
| `bewisse/modheader` | **None — all rights reserved** | No |
| `mahimsafa/modheader` (MV3 port) | **AGPL-3.0** | No |
| `cloudbuy/modheader` | **AGPL-3.0** | No |
| `gacfox/modheader-chrome-extension` | **GPL-3.0** | No |
| `Automattic/a8c-chrome-mod-header` | **None — all rights reserved** | No |

Two things people routinely get wrong:
- **"Public on GitHub" ≠ "free to use."** No licence = all rights reserved =
  default copyright. Reading is fine; copying is infringement.
- **AGPL is worse than GPL** — its copyleft triggers on *network use*, not just
  distribution.

**Rules for all contributors:**
1. **Do not read ModHeader (or any AGPL/GPL/unlicensed extension) source while
   implementing a plugin.** Work from observed behaviour and public docs only.
2. Feature parity is fine — functionality and ideas are not copyrightable
   (17 USC §102(b)). Specific code, names, icons and branding are.
3. **Do not use the ModHeader name or icon.** Its README explicitly asks that
   the project not be impersonated. Ours is **Letterhead** — no linguistic
   overlap with "ModHeader" at all, so confusion is impossible. Never name a
   folder, class, or variable `mod-header` / `modHeader`.
4. Every new dependency gets a licence check *before* it lands. Three separate
   copyleft traps have already surfaced (`electron-chrome-extensions`, and every
   ModHeader repo above). Dev-tool extensions skew copyleft — assume nothing.

> Not legal advice — worth a sign-off from legal before the repo goes public.

---

## 13. Open questions

**Resolved:** product name (Sheaf), URL scheme (`sheaf://`), plugin names
(Letterhead / Folio / Imprint / Mailroom), plugin architecture (D1), extension
loader (D2), licence (MIT).

**Public repository from day one.** Community installs from the GitHub Releases
page. This is a **hard constraint on the code**, not just a policy:

- **No internal hostnames, proxy configs, corporate URLs or default environment
  profiles are ever committed.** Ship empty/neutral defaults; real values live in
  a gitignored local config under `userData`, never in the repo.
- Distribution: **GitHub Releases + `electron-updater`** (GitHub provider).
- Required OSS files from day one: `LICENSE` (MIT), `README`, `CONTRIBUTING`
  (incl. the §12 clean-room rule), `SECURITY.md`.

**Resolved: the app will NOT be code-signed.** Deliberate choice (2026-07-16).
Consequences, now documented in the README "Installing" section and
`electron-builder.yml`:
- macOS: Gatekeeper blocks first launch; users clear quarantine once
  (`xattr -dr com.apple.quarantine`). **macOS auto-update won't work unsigned** —
  Mac releases are downloaded manually.
- Windows: SmartScreen warns until a release builds reputation; auto-update still
  works.
- Linux: no signing gate.

**Resolved 2026-07-18:** repo is **https://github.com/rajeshkumaravel/sheaf-browser**
(`SHEAF_REPO` set; appId `io.github.rajeshkumaravel.sheafbrowser`; npm-style package
name `sheaf-browser`). Product name stays **Sheaf**; public-facing full name is
**Sheaf Browser**.

**Still open — none block starting the foundation:**
3. **Security owner**: who owns the Electron upgrade cadence post-launch?
   A public browser project inherits Chromium's CVE stream.
4. Should named profiles be per-environment (dev/qa/stage/prod) out of the box?
   (Names only — no internal URLs, per the constraint above.)
