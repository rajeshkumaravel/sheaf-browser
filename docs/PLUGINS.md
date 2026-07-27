# The bundled tools

Sheaf ships four tools. Each is **written from scratch** and lives in
[`plugins/`](../plugins) — none is a repackaged Chrome extension, and none can
be, for a reason worth knowing up front.

> **Why these aren't extensions.** Electron does not implement
> `chrome.declarativeNetRequest`, which is how Manifest V3 extensions modify
> headers. A ModHeader-style extension loaded into Sheaf would install, render
> its UI, and then silently fail to change a single header. So Letterhead hooks
> `session.webRequest` in the main process instead — which is *more* capable: it
> sees responses as well as requests, has no rule-count ceiling, and no
> service-worker lifecycle to fight.

| Tool | Button | What it does |
|---|:--:|---|
| [**Letterhead**](#letterhead--http-headers) | `L` | Add, replace or remove HTTP request & response headers |
| [**Folio**](#folio--json) | — | Renders any JSON as a searchable tree |
| [**Imprint**](#imprint--cookies--storage) | `I` | Read and edit cookies, localStorage, sessionStorage |
| [**Mailroom**](#mailroom--mock-redirect--record) | `M` | Stub, redirect, block or delay requests; record a HAR |

---

## URL filters

Letterhead and Mailroom share one matcher, so a filter behaves identically in
both. Three forms, tried most-specific first:

| Form | Example | Matches |
|---|---|---|
| **Substring** | `api.example.com` | any URL containing that text |
| **Glob** | `https://api.example.com/*` | any path, query or fragment under it |
| **Regex** | `/\/v[12]\//` | anything the expression matches (slashes required) |

Two things that bite people:

- A glob is **literal**. `example.com/*` does **not** match
  `example.com:8080/foo` — the port sits between the host and the slash. Use
  `example.com*` or include the port.
- An **empty** filter means "every URL" in Letterhead, but **nothing** in
  Mailroom. That asymmetry is deliberate: a half-typed Letterhead rule is
  harmless, whereas a stray Mailroom rule that matched everything would mock the
  entire web.

---

## Letterhead — HTTP headers

<img src="../screenshots/01-letterhead.png" alt="Letterhead panel with three rules" width="820" />

Rules live inside a **profile**. Switch profiles to swap whole sets — your dev
token vs. staging vs. a colleague's repro.

### Fields

| Field | Meaning |
|---|---|
| **Req / Res** | `Req` rewrites what's sent to the server. `Res` rewrites what the server sent back — useful for faking CORS or cache headers you don't control. |
| **Append** | Adds to an existing value. The separator follows the header: a **space** for `User-Agent` (RFC 9110 product tokens), `; ` for `Cookie`, `, ` for everything else. If the header isn't there, it's created. |
| **Set** | Replaces the value outright, creating it if absent. |
| **Remove** | Deletes the header. |
| **URL filter** | See [URL filters](#url-filters). Blank = every request. |

### The blue pulse

The **L** icon and a rule's dot pulse for as long as that rule applies to the
page you're on. It's derived from the current URL, not from "a request just
fired" — requests are bursty, and an indicator that flashes once tells you
nothing thirty seconds later.

**If it isn't pulsing, your filter doesn't match.** Compare it against the
address bar; that's the fastest way to debug a rule that "isn't working".

### Gotchas

- A page that's already loaded won't change until you reload it.
- Some servers reject unknown or malformed headers outright.
- `Append` on `User-Agent` adds a token after a space, so you get
  `Mozilla/5.0 … Sheaf-QA` — not a comma-joined list.

---

## Folio — JSON

<img src="../screenshots/04-folio.png" alt="Folio rendering a JSON response as a tree" width="820" />

Folio has no button: open any JSON URL and it renders a tree instead of raw
text. It **replaces** Chromium's own JSON viewer, which has no search, no
copy-path and no collapse-all.

- **Filter** — type to show only matching keys/values; matching branches expand.
- **Expand all / Collapse all** — for orienting in something deep.
- **Click a key** to copy its path (`$.customer.tier`) — paste straight into a
  test or a jq expression.
- **Copy** — the whole document, re-indented.

### Scratchpad

JSON from a log, a ticket or a colleague? Open **`sheaf://folio`** (`⌘⇧U`, or
Tools ▸ JSON Viewer), paste it, and press **View** (or `⌘↵`). **Paste from
clipboard** does it in one click. Invalid JSON reports the parse error rather
than a broken tree; **← Edit** returns to the box with your text intact.

---

## Imprint — cookies & storage

<img src="../screenshots/05-imprint.png" alt="Imprint listing cookies for the current origin" width="820" />

Imprint always acts on the **current tab's origin**, shown at the top. Open an
`http(s)` page first — internal pages have no origin to edit.

Three sections, each showing its entry count: **Cookies**, **Local**, **Session**.
Edit a value in place (it saves when you click away), **×** deletes, and the
bottom row adds a new entry. **Clear all** empties a storage area — the quickest
way to test a first-time-visitor flow.

### The flag chips

| Chip | Meaning |
|:--:|---|
| **H** | `HttpOnly` — page JavaScript cannot read this cookie |
| **S** | `Secure` — only ever sent over HTTPS |
| **SS·N** / **SS·L** / **SS·St** | `SameSite` = None / Lax / Strict |

SameSite is drawn as an **outlined** chip because a plain `S` would be
ambiguous with Secure. Hover any chip for the full explanation.

### Notes

- **Editing an HttpOnly cookie works here** even though page JavaScript can't
  touch it — Imprint goes through the browser's cookie store, not the page.
- Changing a session cookie usually needs a reload, and the site may simply
  re-set it.
- Values are escaped before they're applied, so a cookie value can never inject
  script into the page.

---

## Mailroom — mock, redirect & record

<img src="../screenshots/06-mailroom.png" alt="Mailroom rules and network recording" width="820" />

Rules match a URL filter and the **first matching rule wins**.

| Action | What it does | Use it when |
|---|---|---|
| **Stub** | Returns a fake body you type, with a Content-Type you choose | The API doesn't exist yet, or you need one specific payload |
| **Redirect** | Sends the request somewhere else | Point production's bundle at `localhost` |
| **Block** | Makes matching requests fail | See how the page copes with a dead endpoint |
| **Delay** | Holds the request N ms, then lets it through | Find the missing loading states |

### Recording a HAR

Tick **Record network**, reproduce the problem, then **Export HAR**. You get a
spec-shaped HAR 1.2 file — attach it to a ticket and the backend team sees
exactly the requests you saw. **Clear** resets the capture; starting a new
recording clears it for you.

### Notes

- Stubs are served from a registered `sheaf-stub://` scheme, not a `data:` URL —
  Chromium blocks top-level navigation to `data:` and won't let `fetch` follow a
  redirect into one.
- Stubs answer **200**. To simulate a failure, use **Block**.
- A cached page may not re-request at all — hard-reload with `⌘⇧R`.

---

## Writing your own

Plugins live in [`plugins/<name>/`](../plugins) with a `plugin.json` and up to
three parts:

| Part | Runs in | Used by |
|---|---|---|
| `main/` | Main process — `webRequest` hooks, cookies, storage | Letterhead, Mailroom, Imprint |
| `content/` | The page's isolated world (DOM access, nothing privileged) | Folio |
| `renderer/Panel.tsx` | A React panel in the dock | Letterhead, Imprint, Mailroom |

**Never touch `session.webRequest` directly.** Electron allows exactly one
listener per event per session — a second registration silently replaces the
first, with no error, and the other plugins simply stop working. Register with
the plugin host instead (`src/main/plugin-host`), which multiplexes handlers and
guarantees a broken plugin can't wedge navigation.

Before writing anything, read the clean-room rule in
[CONTRIBUTING.md](../CONTRIBUTING.md): every ModHeader source on GitHub is
AGPL, GPL or unlicensed, and reading one while implementing a plugin would
poison Sheaf's MIT licence.
