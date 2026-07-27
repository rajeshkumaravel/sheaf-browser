/**
 * Folio — the JSON viewer, as a content script.
 *
 * Two entry points, one renderer (see tree.ts):
 *   1. Auto-detect: a JSON document you navigate to — replaces the body,
 *      including Chromium's own built-in JSON viewer.
 *   2. Scratchpad: sheaf://folio — paste or type JSON and view it as a tree.
 */
import type { Json } from './tree'
import { buildFolioView, injectFolioStyles } from './tree'

const MARK = 'data-folio'

export function initFolio(): void {
  const run = () => {
    if (document.documentElement.hasAttribute(MARK)) return
    if (isScratchpad()) {
      renderScratchpad()
      return
    }
    void tryRenderDocument()
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true })
  } else {
    run()
  }
}

function isScratchpad(): boolean {
  return location.protocol === 'sheaf:' && location.hostname === 'folio'
}

// ---- auto-detect a JSON document ----

function looksLikeJsonDoc(): boolean {
  if (document.contentType === 'application/json') return true
  const body = document.body
  if (!body) return false
  const text = body.innerText.trim()
  return (
    (text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))
  )
}

async function getJson(): Promise<Json | undefined> {
  const raw = document.body?.innerText ?? ''
  try {
    return JSON.parse(raw) as Json
  } catch {
    /* fall through */
  }
  try {
    const res = await fetch(location.href, { cache: 'force-cache' })
    return (await res.json()) as Json
  } catch {
    return undefined
  }
}

async function tryRenderDocument(): Promise<void> {
  if (!looksLikeJsonDoc()) return
  const data = await getJson()
  if (data === undefined) return
  mount(buildFolioView(data))
}

// ---- scratchpad ----

function renderScratchpad(): void {
  document.documentElement.setAttribute(MARK, '1')
  document.title = 'Folio — JSON scratchpad'
  injectFolioStyles()
  document.body.className = 'folio-body'
  document.body.innerHTML = ''
  document.body.append(buildScratchpad())
}

function buildScratchpad(): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'folio-paste'

  const h1 = document.createElement('h1')
  h1.textContent = 'Folio'
  const sub = document.createElement('p')
  sub.textContent = 'Paste or type JSON, then view it as an interactive tree.'

  const textarea = document.createElement('textarea')
  textarea.placeholder = '{ "paste": "your JSON here" }'
  textarea.spellcheck = false

  const error = document.createElement('div')
  error.className = 'folio-error'

  const actions = document.createElement('div')
  actions.className = 'folio-paste-actions'

  const view = document.createElement('button')
  view.className = 'folio-primary'
  view.textContent = 'View'

  const paste = document.createElement('button')
  paste.className = 'folio-btn'
  paste.textContent = 'Paste from clipboard'

  actions.append(view, paste)
  wrap.append(h1, sub, textarea, error, actions)

  const show = () => {
    const text = textarea.value.trim()
    if (!text) {
      error.textContent = 'Nothing to parse yet.'
      return
    }
    let data: Json
    try {
      data = JSON.parse(text) as Json
    } catch (e) {
      // Surface the parse error with position, like a real JSON tool.
      error.textContent = e instanceof Error ? e.message : 'Invalid JSON'
      return
    }
    // Replace the scratchpad with the tree, plus a way back to edit.
    document.body.innerHTML = ''
    const treeView = buildFolioView(data)
    const edit = document.createElement('button')
    edit.className = 'folio-btn'
    edit.textContent = '← Edit'
    edit.addEventListener('click', () => {
      document.body.innerHTML = ''
      document.body.append(buildScratchpad())
      // Re-fill so the user doesn't lose their input.
      const ta = document.body.querySelector('textarea')
      if (ta) ta.value = text
    })
    treeView.querySelector('.folio-bar')?.prepend(edit)
    document.body.append(treeView)
  }

  view.addEventListener('click', show)
  // Cmd/Ctrl+Enter is the muscle-memory "run" chord.
  textarea.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') show()
  })

  paste.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text) {
        error.textContent = 'Clipboard is empty.'
        return
      }
      textarea.value = text
      error.textContent = ''
      show()
    } catch {
      // Clipboard read can be blocked; the textarea (Cmd+V) always works.
      error.textContent = 'Could not read the clipboard — paste into the box with ⌘V instead.'
    }
  })

  setTimeout(() => textarea.focus(), 0)
  return wrap
}

// ---- shared ----

function mount(view: HTMLElement): void {
  document.documentElement.setAttribute(MARK, '1')
  injectFolioStyles()
  document.body.className = 'folio-body'
  document.body.innerHTML = ''
  document.body.append(view)
}
