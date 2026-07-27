# Contributing to Sheaf

Thanks for helping. Sheaf browseris MIT licensed and developed in the open.

> The repository lives at **https://github.com/rajeshkumaravel/sheaf-browser**.
> That URL is defined once — `SHEAF_REPO` in
> [src/shared/repo.ts](src/shared/repo.ts) — and every link in the app, README
> and this file derives from it.

## Reporting a bug

Open an issue with: what you did, what you expected, what happened, and the
versions from `sheaf://about`. If a bundled tool misbehaved, name it and paste
the rule. **Security issues go privately** via [SECURITY.md](SECURITY.md) — not
a public issue.

## Proposing a change

Small fixes: open a PR. Anything that changes architecture or adds a dependency:
open an issue first — a rejected dependency (see the licence rules below) is a
frustrating thing to discover at review time.

## Provenance — read this before writing a plugin

Sheaf browseris MIT licensed. Keeping it that way constrains what you may read, not
just what you may copy.

### The clean-room rule

**Do not read the source of ModHeader, or any AGPL / GPL / unlicensed browser
extension, while implementing a Sheaf browserplugin.** Work from observed behaviour and
public documentation only.


| Repo | License | Usable? |
|---|---|---|
| `modheader/modheader` (official) | None — all rights reserved | No |
| `bewisse/modheader` | None — all rights reserved | No |
| `mahimsafa/modheader` (MV3 port) | AGPL-3.0 | No |
| `cloudbuy/modheader` | AGPL-3.0 | No |
| `gacfox/modheader-chrome-extension` | GPL-3.0 | No |
| `Automattic/a8c-chrome-mod-header` | None — all rights reserved | No |

Two things people routinely get wrong:

- **"Public on GitHub" does not mean "free to use."** No license means all
  rights reserved. Reading is fine; copying is infringement.
- **AGPL is stricter than GPL** — its copyleft triggers on *network use*, not
  only distribution.

### What is and isn't allowed

- **Allowed:** feature parity. Functionality, ideas and methods of operation are
  not copyrightable (17 USC §102(b)). Building a header editor that does what
  ModHeader does is fine.
- **Not allowed:** copying code, names, icons or branding.
- **Not allowed:** naming anything `mod-header`, `modHeader`, or similar — in a
  folder, class, variable or UI string. ModHeader's own README asks that the
  project not be impersonated. Our header plugin is **Letterhead**.

### Dependencies

**Every new dependency needs a license check before it lands.** MIT, BSD and
Apache-2.0 are fine. **GPL and AGPL are not** — they are viral and would make an
MIT release impossible.

This has already bitten us three times: `electron-chrome-extensions` (GPL-3, and
the reason Sheaf browserships its own CRX loader), plus every ModHeader repo above.
Developer-tool extensions skew heavily copyleft. Assume nothing; check.

## Public repository

Sheaf browserbrowseris public from day one. **Never commit internal hostnames, proxy
configuration, corporate URLs, or environment profiles.** Real values belong in
the local config under `userData` (gitignored), never in the repository.

## Setup

```bash
nvm use              # Node 24 — see .nvmrc
npm install
npm run dev
```

## Before opening a PR

```bash
npm run typecheck    # must be clean
npm run verify       # drives the real app end-to-end
```

`npm run verify` launches the built app and walks the core flows, writing
screenshots to `shots/`. It exits non-zero on the first failure. If you change
tab, session or navigation behaviour, add a step to `scripts/verify.mjs`.

## Architecture notes worth knowing

- **One `webRequest` listener per event, per session.** Electron allows only
  one. The plugin host owns it and multiplexes plugins through it — a plugin
  must never register its own, or it will silently clobber the others.
- **Native views ignore DOM stacking.** Page content is a `WebContentsView`
  composited *above* the chrome renderer. Anything the UI needs to draw over the
  page cannot simply be a DOM element.
- **`src/preload/content.ts` runs next to hostile code.** It must never expose
  the chrome IPC surface, Node, or anything a page could pivot through.

See [PLAN.md](PLAN.md) for the full architecture and the reasoning behind it.
