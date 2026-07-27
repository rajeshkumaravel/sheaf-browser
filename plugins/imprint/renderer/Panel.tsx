import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { CookieItem, ImprintSnapshot, StorageArea } from '@shared/types'

type Section = 'cookies' | 'local' | 'session'

/**
 * Cookie flag chips. Kept to one or two characters to fit the 340px dock, so
 * each one carries an explaining tooltip — and SameSite is rendered distinctly
 * because "S" alone would read as Secure.
 */
const SAMESITE_LABEL: Record<CookieItem['sameSite'], string> = {
  unspecified: '',
  no_restriction: 'SS·N',
  lax: 'SS·L',
  strict: 'SS·St'
}
const SAMESITE_HELP: Record<CookieItem['sameSite'], string> = {
  unspecified: '',
  no_restriction: 'SameSite=None — sent on cross-site requests (requires Secure)',
  lax: 'SameSite=Lax — sent on top-level navigations only',
  strict: 'SameSite=Strict — never sent on cross-site requests'
}

export function ImprintPanel(): JSX.Element {
  const [snap, setSnap] = useState<ImprintSnapshot | null>(null)
  const [section, setSection] = useState<Section>('cookies')

  const refresh = async () => setSnap(await window.sheaf.invoke('imprint:snapshot'))
  useEffect(() => {
    void refresh()
  }, [])

  if (!snap) return <div className="panel-empty">Loading…</div>
  if (!snap.origin) {
    return (
      <div className="panel-empty">
        No cookies or storage here — open an <code>http(s)</code> page first.
      </div>
    )
  }

  return (
    <div className="imp">
      <div className="imp-origin" title={snap.url}>
        {snap.origin}
      </div>
      <div className="imp-tabs">
        {(['cookies', 'local', 'session'] as Section[]).map((s) => (
          <button
            key={s}
            className={`imp-tab${section === s ? ' on' : ''}`}
            onClick={() => setSection(s)}
          >
            {s === 'cookies' ? 'Cookies' : s === 'local' ? 'Local' : 'Session'}
            <span className="imp-tab-n">
              {s === 'cookies' ? snap.cookies.length : Object.keys(snap[s]).length}
            </span>
          </button>
        ))}
      </div>

      {section === 'cookies' ? (
        <Cookies snap={snap} onChange={setSnap} />
      ) : (
        <Storage area={section} snap={snap} onChange={setSnap} />
      )}
    </div>
  )
}

function Cookies({
  snap,
  onChange
}: {
  snap: ImprintSnapshot
  onChange: (s: ImprintSnapshot) => void
}): JSX.Element {
  const set = async (c: Partial<CookieItem> & { name: string; value: string }) =>
    onChange(await window.sheaf.invoke('imprint:setCookie', c))
  const remove = async (name: string) =>
    onChange(await window.sheaf.invoke('imprint:removeCookie', name))

  return (
    <div className="imp-list">
      {snap.cookies.length > 0 && (
        // A legend, so the chips don't require hovering to decode.
        <div className="imp-legend">
          <span title="HttpOnly — page JavaScript cannot read this cookie">
            <b>H</b> HttpOnly
          </span>
          <span title="Secure — only ever sent over HTTPS">
            <b>S</b> Secure
          </span>
          <span title="SameSite — None / Lax / Strict">
            <b className="samesite">SS</b> SameSite
          </span>
        </div>
      )}
      {snap.cookies.length === 0 && <div className="imp-none">No cookies for this origin.</div>}
      {snap.cookies.map((c) => (
        <div className="imp-row" key={c.name}>
          <div className="imp-row-head">
            <span className="imp-name" title={c.name}>
              {c.name}
            </span>
            <div className="imp-flags">
              {c.httpOnly && (
                <span className="imp-flag" title="HttpOnly — page JavaScript cannot read this cookie">
                  H
                </span>
              )}
              {c.secure && (
                <span className="imp-flag" title="Secure — only ever sent over HTTPS">
                  S
                </span>
              )}
              {/* SameSite gets its own outlined style: plain "S" would be
                  ambiguous with Secure above. */}
              {c.sameSite !== 'unspecified' && (
                <span className="imp-flag samesite" title={SAMESITE_HELP[c.sameSite]}>
                  {SAMESITE_LABEL[c.sameSite]}
                </span>
              )}
              <button className="imp-del" title="Delete cookie" onClick={() => void remove(c.name)}>
                ×
              </button>
            </div>
          </div>
          <input
            className="imp-val"
            defaultValue={c.value}
            spellCheck={false}
            // HttpOnly cookies can't be read by page JS, but the session API can
            // still rewrite them — so they stay editable here.
            onBlur={(e) => {
              if (e.target.value !== c.value) void set({ ...c, value: e.target.value })
            }}
          />
          <div className="imp-sub">
            {c.path}
            {c.expirationDate
              ? ` · expires ${new Date(c.expirationDate * 1000).toLocaleDateString()}`
              : ' · session'}
          </div>
        </div>
      ))}
      <AddRow
        placeholderKey="cookie name"
        onAdd={(name, value) => void set({ name, value })}
      />
    </div>
  )
}

function Storage({
  area,
  snap,
  onChange
}: {
  area: StorageArea
  snap: ImprintSnapshot
  onChange: (s: ImprintSnapshot) => void
}): JSX.Element {
  const data = snap[area]
  const keys = Object.keys(data)

  const set = async (key: string, value: string) =>
    onChange(await window.sheaf.invoke('imprint:setStorage', area, key, value))
  const remove = async (key: string) =>
    onChange(await window.sheaf.invoke('imprint:removeStorage', area, key))
  const clear = async () => onChange(await window.sheaf.invoke('imprint:clearStorage', area))

  return (
    <div className="imp-list">
      {keys.length === 0 && <div className="imp-none">Empty.</div>}
      {keys.map((k) => (
        <div className="imp-row" key={k}>
          <div className="imp-row-head">
            <span className="imp-name" title={k}>
              {k}
            </span>
            <button className="imp-del" title="Delete" onClick={() => void remove(k)}>
              ×
            </button>
          </div>
          <input
            className="imp-val"
            defaultValue={data[k]}
            spellCheck={false}
            onBlur={(e) => {
              if (e.target.value !== data[k]) void set(k, e.target.value)
            }}
          />
        </div>
      ))}
      <AddRow placeholderKey="key" onAdd={(key, value) => void set(key, value)} />
      {keys.length > 0 && (
        <button className="imp-clear" onClick={() => void clear()}>
          Clear all
        </button>
      )}
    </div>
  )
}

function AddRow({
  placeholderKey,
  onAdd
}: {
  placeholderKey: string
  onAdd: (key: string, value: string) => void
}): JSX.Element {
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const commit = () => {
    if (!key.trim()) return
    onAdd(key.trim(), value)
    setKey('')
    setValue('')
  }
  return (
    <div className="imp-add">
      <input
        className="imp-add-k"
        placeholder={placeholderKey}
        spellCheck={false}
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <input
        className="imp-add-v"
        placeholder="value"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <button className="imp-add-btn" onClick={commit} disabled={!key.trim()}>
        +
      </button>
    </div>
  )
}
