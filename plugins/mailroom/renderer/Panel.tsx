import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { MailroomState, MockRule } from '@shared/plugins'
import { emptyMockRule } from '@shared/plugins'

export function MailroomPanel(): JSX.Element {
  const [state, setState] = useState<MailroomState | null>(null)
  const [harCount, setHarCount] = useState(0)
  const [note, setNote] = useState('')
  /** Rule whose URL filter is empty and blocking a new row. */
  const [invalidId, setInvalidId] = useState<string | null>(null)

  const apply = (v: { state: MailroomState; harCount: number }) => {
    setState(v.state)
    setHarCount(v.harCount)
  }

  useEffect(() => {
    void (async () => apply(await window.sheaf.invoke('mailroom:get')))()
  }, [])

  if (!state) return <div className="panel-empty">Loading…</div>

  const save = async (next: MailroomState) => apply(await window.sheaf.invoke('mailroom:set', next))

  const patchRule = (id: string, patch: Partial<MockRule>) =>
    save({ ...state, rules: state.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) })

  return (
    <div className="mr">
      <div className="mr-record">
        <label className="mr-toggle">
          <input
            type="checkbox"
            checked={state.recording}
            onChange={(e) => void save({ ...state, recording: e.target.checked })}
          />
          <span>Record network</span>
        </label>
        <span className={`mr-dot${state.recording ? ' on' : ''}`} />
        <span className="mr-har-n">{harCount}</span>
      </div>
      <div className="mr-har-actions">
        <button
          className="mr-btn"
          disabled={harCount === 0}
          onClick={async () => {
            const r = await window.sheaf.invoke('mailroom:exportHar')
            setNote(r.saved ? 'Saved HAR' : '')
            setTimeout(() => setNote(''), 1500)
          }}
        >
          Export HAR
        </button>
        <button
          className="mr-btn"
          disabled={harCount === 0}
          onClick={async () => apply(await window.sheaf.invoke('mailroom:clearHar'))}
        >
          Clear
        </button>
        {note && <span className="mr-note">{note}</span>}
      </div>

      <div className="mr-rules">
        {state.rules.map((rule) => (
          <div className="mr-rule" key={rule.id}>
            <div className="mr-row">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(e) => patchRule(rule.id, { enabled: e.target.checked })}
                title="Enable this rule"
              />
              <select
                className="mr-action"
                value={rule.action}
                onChange={(e) => patchRule(rule.id, { action: e.target.value as MockRule['action'] })}
              >
                <option value="redirect">Redirect</option>
                <option value="block">Block</option>
                <option value="delay">Delay</option>
                <option value="stub">Stub</option>
              </select>
              <button
                className="mr-del"
                title="Delete rule"
                onClick={() => save({ ...state, rules: state.rules.filter((r) => r.id !== rule.id) })}
              >
                ×
              </button>
            </div>
            <input
              className={`mr-input${invalidId === rule.id ? ' invalid' : ''}`}
              placeholder="URL filter — example.com/*, substring, .*regex.* or /regex/"
              spellCheck={false}
              autoFocus={invalidId === rule.id}
              value={rule.urlFilter}
              onChange={(e) => {
                if (invalidId === rule.id && e.target.value.trim()) setInvalidId(null)
                patchRule(rule.id, { urlFilter: e.target.value })
              }}
            />
            {rule.action === 'redirect' && (
              <input
                className="mr-input"
                placeholder="Redirect to URL"
                spellCheck={false}
                value={rule.redirectTo}
                onChange={(e) => patchRule(rule.id, { redirectTo: e.target.value })}
              />
            )}
            {rule.action === 'delay' && (
              <input
                className="mr-input"
                type="number"
                placeholder="Delay (ms)"
                value={rule.delayMs}
                onChange={(e) => patchRule(rule.id, { delayMs: Number(e.target.value) || 0 })}
              />
            )}
            {rule.action === 'stub' && (
              <>
                <input
                  className="mr-input"
                  placeholder="Content-Type"
                  spellCheck={false}
                  value={rule.stubContentType}
                  onChange={(e) => patchRule(rule.id, { stubContentType: e.target.value })}
                />
                <textarea
                  className="mr-textarea"
                  placeholder="Response body"
                  spellCheck={false}
                  value={rule.stubBody}
                  onChange={(e) => patchRule(rule.id, { stubBody: e.target.value })}
                />
              </>
            )}
            {rule.action === 'block' && <div className="mr-hint">Requests matching the filter fail.</div>}
          </div>
        ))}
      </div>

      {invalidId && <div className="lh-warn">Give this rule a URL filter before adding another.</div>}
      <button
        className="mr-add"
        onClick={() => {
          const empty = state.rules.find((r) => !r.urlFilter.trim())
          if (empty) {
            setInvalidId(empty.id)
            return
          }
          setInvalidId(null)
          void save({ ...state, rules: [...state.rules, emptyMockRule()] })
        }}
      >
        Add rule
      </button>
    </div>
  )
}
