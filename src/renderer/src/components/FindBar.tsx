import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { FindState } from '@shared/types'

interface Props {
  find: FindState
  onQuery: (q: string, forward: boolean, findNext: boolean) => void
  onClose: () => void
}

export function FindBar({ find, onQuery, onClose }: Props): JSX.Element {
  // The query is local state, deliberately. Binding the input to main's
  // round-tripped value makes every keystroke wait on IPC — it feels sluggish
  // and drops characters when typing fast. Main owns the match counts; the
  // text field owns itself.
  const [query, setQuery] = useState(find.query)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const step = (forward: boolean) => {
    if (query) onQuery(query, forward, true)
  }

  return (
    <div className="findbar">
      <input
        ref={ref}
        className="find-input"
        placeholder="Find in page"
        spellCheck={false}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          onQuery(e.target.value, true, false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            step(!e.shiftKey)
          } else if (e.key === 'Escape') {
            onClose()
          }
        }}
      />
      <span className="find-count">{query ? `${find.activeMatch}/${find.totalMatches}` : ''}</span>
      <button className="find-btn" onClick={() => step(false)} disabled={!find.totalMatches} title="Previous (⇧⏎)">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M2 6.5L5 3.5l3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button className="find-btn" onClick={() => step(true)} disabled={!find.totalMatches} title="Next (⏎)">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button className="find-btn" onClick={onClose} title="Close (Esc)">
        <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden>
          <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
