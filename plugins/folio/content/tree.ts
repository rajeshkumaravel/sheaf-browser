/**
 * Folio's JSON tree renderer, shared by both entry points: the auto-detect
 * content script (a JSON document you navigate to) and the sheaf://folio paste
 * scratchpad. One renderer, so the two can never drift.
 *
 * Everything is built with createElement, never innerHTML: values are untrusted
 * and must never be parsed as markup.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

const AUTO_OPEN_DEPTH = 2

/** Builds the full Folio view (toolbar + tree) for `data`, fully wired. */
export function buildFolioView(data: Json): HTMLElement {
  const root = document.createElement('div')
  root.className = 'folio'

  const toolbar = document.createElement('div')
  toolbar.className = 'folio-bar'

  const search = document.createElement('input')
  search.className = 'folio-search'
  search.placeholder = 'Filter keys and values…'
  search.spellcheck = false

  const count = document.createElement('span')
  count.className = 'folio-count'

  const tree = document.createElement('div')
  tree.className = 'folio-tree'

  const setAll = (open: boolean) =>
    tree.querySelectorAll<HTMLElement>('.folio-node').forEach((n) => toggleNode(n, open))

  toolbar.append(
    search,
    count,
    mkButton('Expand all', () => setAll(true)),
    mkButton('Collapse all', () => setAll(false)),
    mkButton('Copy', () => void navigator.clipboard?.writeText(JSON.stringify(data, null, 2)))
  )

  root.append(toolbar, tree)
  renderNode(tree, undefined, data, 0, '$')

  let timer: number | undefined
  search.addEventListener('input', () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => applyFilter(tree, search.value.trim().toLowerCase(), count), 120)
  })

  return root
}

function mkButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = 'folio-btn'
  b.textContent = label
  b.addEventListener('click', onClick)
  return b
}

function renderNode(
  parent: HTMLElement,
  key: string | number | undefined,
  value: Json,
  depth: number,
  path: string
): void {
  const isObj = value !== null && typeof value === 'object'
  const node = document.createElement('div')
  node.className = 'folio-node'
  node.style.setProperty('--depth', String(depth))

  const row = document.createElement('div')
  row.className = 'folio-row'

  if (isObj) {
    const entries = Array.isArray(value)
      ? value.map((v, i) => [i, v] as const)
      : Object.entries(value as Record<string, Json>)

    const twist = document.createElement('span')
    twist.className = 'folio-twist'
    row.append(twist)

    if (key !== undefined) row.append(mkKey(key, path))

    const summary = document.createElement('span')
    summary.className = 'folio-summary'
    const open = Array.isArray(value) ? '[' : '{'
    const close = Array.isArray(value) ? ']' : '}'
    summary.textContent = `${open}${entries.length ? ` ${entries.length} ` : ''}${close}`
    row.append(summary)

    node.append(row)

    const children = document.createElement('div')
    children.className = 'folio-children'
    node.append(children)

    let built = false
    const build = () => {
      if (built) return
      built = true
      for (const [k, v] of entries) {
        renderNode(children, k, v, depth + 1, `${path}${Array.isArray(value) ? `[${k}]` : `.${k}`}`)
      }
    }

    if (depth < AUTO_OPEN_DEPTH) {
      build()
      node.classList.add('open')
    }
    row.addEventListener('click', () => {
      build()
      toggleNode(node, !node.classList.contains('open'))
    })
  } else {
    node.classList.add('leaf')
    const twist = document.createElement('span')
    twist.className = 'folio-twist'
    row.append(twist)
    if (key !== undefined) row.append(mkKey(key, path))
    row.append(mkValue(value))
    node.append(row)
  }

  parent.append(node)
}

function mkKey(key: string | number, path: string): HTMLElement {
  const el = document.createElement('span')
  el.className = 'folio-key'
  el.textContent = typeof key === 'number' ? String(key) : JSON.stringify(key).slice(1, -1)
  el.title = `${path} — click to copy path`
  el.addEventListener('click', (e) => {
    e.stopPropagation()
    void navigator.clipboard?.writeText(path)
    el.classList.add('copied')
    window.setTimeout(() => el.classList.remove('copied'), 600)
  })
  return el
}

function mkValue(value: Json): HTMLElement {
  const el = document.createElement('span')
  const t = value === null ? 'null' : typeof value
  el.className = `folio-val folio-${t}`
  el.textContent = typeof value === 'string' ? JSON.stringify(value) : String(value)
  return el
}

function toggleNode(node: HTMLElement, open: boolean): void {
  if (!node.querySelector(':scope > .folio-children')) return
  node.classList.toggle('open', open)
}

function applyFilter(tree: HTMLElement, q: string, count: HTMLElement): void {
  if (!q) {
    tree.querySelectorAll<HTMLElement>('.folio-node').forEach((n) => (n.style.display = ''))
    count.textContent = ''
    return
  }
  let matches = 0
  const visit = (node: HTMLElement): boolean => {
    const row = node.querySelector(':scope > .folio-row') as HTMLElement
    const self = (row?.textContent ?? '').toLowerCase().includes(q)
    if (self) matches++
    const kids = node.querySelectorAll<HTMLElement>(':scope > .folio-children > .folio-node')
    let anyChild = false
    kids.forEach((k) => {
      if (visit(k)) anyChild = true
    })
    const show = self || anyChild
    node.style.display = show ? '' : 'none'
    if (anyChild) node.classList.add('open')
    return show
  }
  tree.querySelectorAll<HTMLElement>(':scope > .folio-node').forEach(visit)
  count.textContent = `${matches} match${matches === 1 ? '' : 'es'}`
}

export function injectFolioStyles(): void {
  if (document.getElementById('folio-styles')) return
  const style = document.createElement('style')
  style.id = 'folio-styles'
  style.textContent = `
    .folio-body { margin: 0; background: #ffffff; color: #1a1a1a;
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .folio { display: flex; flex-direction: column; height: 100vh; }
    .folio-bar { display: flex; gap: 8px; align-items: center; padding: 8px 12px;
      border-bottom: 1px solid #e5e5e5; position: sticky; top: 0; background: #fafafa; }
    .folio-search { flex: 1; max-width: 360px; height: 28px; padding: 0 10px;
      border: 1px solid #d4d4d4; border-radius: 6px; font: inherit; }
    .folio-count { color: #888; font-size: 12px; }
    .folio-btn { height: 26px; padding: 0 10px; border: 1px solid #d4d4d4; border-radius: 6px;
      background: #fff; cursor: pointer; font: inherit; font-size: 12px; }
    .folio-btn:hover { background: #f0f0f0; }
    .folio-tree { flex: 1; overflow: auto; padding: 10px 14px;
      font-family: 'SF Mono', ui-monospace, Menlo, monospace; font-size: 12.5px; }
    .folio-row { display: flex; align-items: baseline; gap: 6px; padding: 1px 0;
      padding-left: calc(var(--depth) * 16px); cursor: default; border-radius: 4px; }
    .folio-node:not(.leaf) > .folio-row { cursor: pointer; }
    .folio-row:hover { background: #f2f6ff; }
    .folio-twist { width: 10px; flex: none; color: #999; }
    .folio-node:not(.leaf) > .folio-row .folio-twist::before { content: '▸'; }
    .folio-node.open > .folio-row .folio-twist::before { content: '▾'; }
    .folio-key { color: #7c3aed; cursor: pointer; flex: none; white-space: nowrap; }
    .folio-key:hover { text-decoration: underline; }
    .folio-key::after { content: ':'; color: #999; }
    .folio-key.copied { background: #d1fae5; border-radius: 3px; }
    .folio-val { min-width: 0; overflow-wrap: anywhere; }
    .folio-summary { color: #999; }
    .folio-children { display: none; }
    .folio-node.open > .folio-children { display: block; }
    .folio-string { color: #16a34a; }
    .folio-number { color: #2563eb; }
    .folio-boolean { color: #ca8a04; }
    .folio-null { color: #999; font-style: italic; }

    /* Paste scratchpad (sheaf://folio) */
    .folio-paste { display: flex; flex-direction: column; gap: 12px; max-width: 760px;
      margin: 0 auto; padding: 40px 24px; height: 100vh; box-sizing: border-box; }
    .folio-paste h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }
    .folio-paste p { margin: 0; color: #888; font-size: 13px; }
    .folio-paste textarea { flex: 1; resize: none; padding: 12px; border: 1px solid #d4d4d4;
      border-radius: 8px; font-family: 'SF Mono', ui-monospace, Menlo, monospace; font-size: 12.5px;
      line-height: 1.5; background: #fff; color: #1a1a1a; }
    .folio-paste textarea:focus { outline: none; border-color: #2563eb; }
    .folio-paste-actions { display: flex; gap: 8px; align-items: center; }
    .folio-primary { height: 34px; padding: 0 16px; border: none; border-radius: 7px;
      background: #2563eb; color: #fff; font: inherit; font-weight: 500; cursor: pointer; }
    .folio-primary:hover { background: #1d4ed8; }
    .folio-error { color: #dc2626; font-size: 12.5px; min-height: 16px; }

    @media (prefers-color-scheme: dark) {
      .folio-body { background: #0d0d0d; color: #e5e5e5; }
      .folio-bar { background: #161616; border-color: #262626; }
      .folio-search, .folio-btn { background: #0d0d0d; border-color: #333; color: #e5e5e5; }
      .folio-btn:hover { background: #1f1f1f; }
      .folio-row:hover { background: #1a2030; }
      .folio-key { color: #a970ff; }
      .folio-string { color: #4ade80; }
      .folio-number { color: #60a5fa; }
      .folio-boolean { color: #fbbf24; }
      .folio-paste p { color: #888; }
      .folio-paste textarea { background: #0d0d0d; border-color: #333; color: #e5e5e5; }
      .folio-primary { background: #2563eb; }
    }
  `
  document.head.append(style)
}
