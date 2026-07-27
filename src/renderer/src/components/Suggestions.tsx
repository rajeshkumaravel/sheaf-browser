import type { JSX } from 'react'
import type { OmniboxState, SuggestionKind } from '@shared/types'

interface Props {
  state: OmniboxState
  onPick: (index: number) => void
  onHover: (index: number) => void
}

function Icon({ kind }: { kind: SuggestionKind }): JSX.Element {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }
  switch (kind) {
    case 'bookmark':
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
          <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" {...common} strokeLinejoin="round" />
        </svg>
      )
    case 'search':
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
          <circle cx="7" cy="7" r="4.5" {...common} />
          <path d="M10.5 10.5L14 14" {...common} strokeLinecap="round" />
        </svg>
      )
    case 'history':
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="8" r="6" {...common} />
          <path d="M8 4.5V8l2.5 1.5" {...common} strokeLinecap="round" />
        </svg>
      )
    default:
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="8" r="6" {...common} />
          <path d="M2 8h12M8 2c1.8 2 1.8 10 0 12M8 2C6.2 4 6.2 12 8 14" {...common} />
        </svg>
      )
  }
}

export function Suggestions({ state, onPick, onHover }: Props): JSX.Element {
  return (
    <div className="sug">
      {state.items.map((item, i) => (
        <div
          key={`${item.kind}:${item.url}`}
          className={`sug-item${i === state.selected ? ' on' : ''}`}
          onMouseEnter={() => onHover(i)}
          // mousedown, not click: the omnibox input blurs on mousedown, which
          // would close this view before a click ever lands.
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(i)
          }}
        >
          <span className="sug-icon">
            <Icon kind={item.kind} />
          </span>
          <span className="sug-title">{item.title}</span>
          <span className="sug-url">
            {item.kind === 'search' ? 'Search' : item.url.replace(/^https?:\/\/(www\.)?/, '')}
          </span>
        </div>
      ))}
    </div>
  )
}
