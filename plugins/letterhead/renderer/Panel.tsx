import { useState } from 'react'
import type { JSX } from 'react'
import type { HeaderProfile, HeaderRule, LetterheadState } from '@shared/plugins'
import { emptyRule, liveRuleIds } from '@shared/plugins'
import { usePulse, useStore } from '@renderer/state/store'

const NEW_PROFILE = (name: string): HeaderProfile => ({
  id: crypto.randomUUID(),
  name,
  enabled: true,
  rules: [emptyRule()]
})

export function LetterheadPanel(): JSX.Element {
  const state = useStore((s) => s.letterhead)
  const setState = useStore((s) => s.setLetterhead)
  /** Rule whose name field is empty and blocking a new row. */
  const [invalidId, setInvalidId] = useState<string | null>(null)
  // Which rules just touched a real request — a one-shot flash on the row.
  const fired = useStore((s) => s.letterheadFired)
  const firing = usePulse(fired.tick)
  // Which rules apply to the page you're on — a steady pulse that stays lit.
  const win = useStore((s) => s.window)
  const activeUrl = win?.tabs.find((t) => t.id === win.activeTabId)?.url ?? null
  const live = state ? liveRuleIds(state, activeUrl) : []

  const save = (next: LetterheadState) => {
    setState(next)
    void window.sheaf.invoke('letterhead:set', next)
  }

  // main seeds the first profile, so `null` here only ever means "still loading".
  if (!state) return <div className="panel-empty">Loading…</div>

  const profile = state.profiles.find((p) => p.id === state.activeProfileId) ?? null
  if (!profile) return <div className="panel-empty">No profile</div>

  const patchProfile = (patch: Partial<HeaderProfile>) =>
    save({
      ...state,
      profiles: state.profiles.map((p) => (p.id === profile.id ? { ...p, ...patch } : p))
    })

  const patchRule = (id: string, patch: Partial<HeaderRule>) =>
    patchProfile({ rules: profile.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) })

  return (
    <div className="lh">
      <div className="lh-profile">
        <label className="lh-switch" title="Enable this profile">
          <input
            type="checkbox"
            checked={profile.enabled}
            onChange={(e) => patchProfile({ enabled: e.target.checked })}
          />
        </label>
        <select
          className="lh-select"
          value={profile.id}
          onChange={(e) => save({ ...state, activeProfileId: e.target.value })}
        >
          {state.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          className="lh-icon-btn"
          title="New profile"
          onClick={() => {
            const p = NEW_PROFILE(`Profile ${state.profiles.length + 1}`)
            save({ profiles: [...state.profiles, p], activeProfileId: p.id })
          }}
        >
          +
        </button>
      </div>

      <div className="lh-rules">
        {profile.rules.map((rule) => (
          <div
            className={`lh-rule${firing && fired.ids.includes(rule.id) ? ' fired' : ''}`}
            key={rule.id}
          >
            <div className="lh-row">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(e) => patchRule(rule.id, { enabled: e.target.checked })}
                title="Enable this rule"
              />
              {live.includes(rule.id) && (
                <span className="lh-live" title="Active on this page — this rule is being applied" />
              )}
              <select
                className="lh-mini"
                value={rule.target}
                onChange={(e) => patchRule(rule.id, { target: e.target.value as HeaderRule['target'] })}
                title="Request or response headers"
              >
                <option value="request">Req</option>
                <option value="response">Res</option>
              </select>
              <select
                className="lh-mini"
                value={rule.op}
                onChange={(e) => patchRule(rule.id, { op: e.target.value as HeaderRule['op'] })}
              >
                <option value="set">Set</option>
                <option value="append">Append</option>
                <option value="remove">Remove</option>
              </select>
              <button
                className="lh-icon-btn danger"
                title="Delete rule"
                onClick={() => patchProfile({ rules: profile.rules.filter((r) => r.id !== rule.id) })}
              >
                ×
              </button>
            </div>
            <div className="lh-row">
              <input
                className={`lh-input${invalidId === rule.id ? ' invalid' : ''}`}
                placeholder="Header name"
                spellCheck={false}
                autoFocus={invalidId === rule.id}
                value={rule.name}
                onChange={(e) => {
                  if (invalidId === rule.id && e.target.value.trim()) setInvalidId(null)
                  patchRule(rule.id, { name: e.target.value })
                }}
              />
              <input
                className="lh-input"
                placeholder="Value"
                spellCheck={false}
                disabled={rule.op === 'remove'}
                value={rule.value}
                onChange={(e) => patchRule(rule.id, { value: e.target.value })}
              />
            </div>
            <div className="lh-row">
              <input
                className="lh-input dim"
                placeholder="URL filter — example.com/*, substring, .*regex.* or /regex/"
                spellCheck={false}
                value={rule.urlFilter}
                onChange={(e) => patchRule(rule.id, { urlFilter: e.target.value })}
              />
            </div>
          </div>
        ))}
        {invalidId && <div className="lh-warn">Give this header a name before adding another.</div>}
      </div>

      <button
        className="lh-add"
        onClick={() => {
          // Don't stack up blank rows: point at the empty one instead.
          const empty = profile.rules.find((r) => !r.name.trim())
          if (empty) {
            setInvalidId(empty.id)
            return
          }
          setInvalidId(null)
          patchProfile({ rules: [...profile.rules, emptyRule()] })
        }}
      >
        Add header rule
      </button>
    </div>
  )
}
