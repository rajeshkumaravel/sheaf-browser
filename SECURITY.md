# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

> **Repository URL not set yet.** Report privately via GitHub's **Security →
> Report a vulnerability** (private advisories) once the repo exists. The URL
> lives in one constant, `SHEAF_REPO` in [src/shared/repo.ts](src/shared/repo.ts).

Include what you found, how to reproduce it, and the versions from
`sheaf://about`. You'll get an acknowledgement, and we'll agree a disclosure
timeline with you before anything is published.

## What Sheaf is, in security terms

Sheaf is a **browser**: it renders untrusted, hostile content by design. That
shapes everything below.

### What we guarantee

- **No network calls of our own.** Sheaf never phones home. No account, no sync,
  no telemetry, no analytics, no crash reporting, no update ping (see
  "Unsigned & updates"). The only requests are the ones you make by browsing.
  - **No weather API and no IP geolocation.** The home page greeting and sky are
    derived from your system clock. Nothing is sent anywhere to render them.
  - **No remote assets.** All icons/scenes are generated SVG/CSS.
  - **Bookmark icons** are captured once, while you're already on the site, and
    stored locally as data URIs — the bookmarks bar never pings bookmarked sites.
  - **Spellcheck** is enabled only on macOS (OS-provided, no download). On
    Windows/Linux Chromium would fetch dictionaries from Google's CDN, so it's
    disabled there.
  - Enforced by `npm run verify`, which records all traffic and fails if the app
    contacts anything on its own.
- **Local-only data.** Settings, history, bookmarks, downloads and your tool
  rules live in a SQLite file under the app's user-data directory. Nothing is
  uploaded. `sheaf://help` → *Reset Sheaf* erases all of it.
- **Private windows** use a throwaway in-memory session: no history, no
  downloads recorded, no cookies retained.
- **Web content is untrusted.** Every page runs with `sandbox: true`,
  `contextIsolation: true` and `nodeIntegration: false`. The content preload
  exposes nothing privileged to a page.
- **Internal pages only.** The `window.sheafInternal` IPC bridge is exposed only
  to `sheaf://` documents, checked per document load, and is limited to an
  explicit channel allow-list.
- **Clipboard read** is granted only to `sheaf://` pages (for Folio's paste
  scratchpad). Websites cannot read your clipboard.

### What we do not guarantee

- **Sheaf is not code-signed.** macOS Gatekeeper and Windows SmartScreen will
  warn on first launch; see the README. macOS auto-update cannot work for
  unsigned builds, so Mac updates are manual.
- **Third-party extensions you install are not vetted.** They run with whatever
  the Electron extension API grants them, and they may make their own network
  requests. Only load extensions you trust.
- **Mailroom, Letterhead and Imprint are deliberately powerful.** They exist to
  rewrite requests, fake responses and edit cookies. Treat a shared rule set the
  way you'd treat a shared script.
- **DRM is unsupported** — no Widevine CDM.

### Keeping it safe

Sheaf renders hostile content, so **Chromium security fixes matter**. They arrive
with Electron releases, which lag upstream Chrome by days to weeks. Running a
current release is the single most important thing you can do; a stale Sheaf is
a stale Chromium.

## Supported versions

Only the latest release receives security fixes.
