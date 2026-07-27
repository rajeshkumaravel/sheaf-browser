import type { JSX } from 'react'
import type { Bookmark } from '@shared/types'

interface Props {
  bookmarks: Bookmark[]
  onOpen: (url: string) => void
  onRemove: (id: string) => void
}

/**
 * PRIVACY: this used to build `${origin}/favicon.ico` and hand it to <img>,
 * which meant that merely having the browser open pinged **every bookmarked
 * site** — handing each one your IP and the fact that you'd launched Sheaf,
 * without you visiting them. Chrome doesn't do that; it paints bookmark icons
 * from a local cache.
 *
 * Icons are now captured once, at bookmark time, while you're already on the
 * site (so nothing new is disclosed) and stored as a data URI. Rendering the
 * bar makes no requests at all.
 */

export function BookmarksBar({ bookmarks, onOpen, onRemove }: Props): JSX.Element {
  const top = bookmarks.filter((b) => b.parentId === null && b.kind === 'bookmark')

  return (
    <div className="bmbar">
      {top.length === 0 ? (
        <span className="bmbar-empty">
          Bookmark a page with ⌘D and it will show up here
        </span>
      ) : (
        top.map((b) => {
          // Only ever a locally-stored data URI — never a remote URL.
          const icon = b.favicon
          return (
            <button
              key={b.id}
              className="bm"
              title={`${b.title}\n${b.url ?? ''}`}
              onClick={() => b.url && onOpen(b.url)}
              onContextMenu={(e) => {
                e.preventDefault()
                // No native menu here: this is a DOM element in the chrome, and
                // a confirm-free delete on right-click would be hostile.
                if (confirm(`Remove bookmark "${b.title}"?`)) onRemove(b.id)
              }}
            >
              {icon ? (
                <img
                  className="bm-icon"
                  src={icon}
                  alt=""
                  onError={(e) => {
                    e.currentTarget.style.visibility = 'hidden'
                  }}
                />
              ) : (
                <span className="bm-icon-blank" />
              )}
              <span className="bm-title">{b.title}</span>
            </button>
          )
        })
      )}
    </div>
  )
}
