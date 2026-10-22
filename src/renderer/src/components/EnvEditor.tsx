// SPDX-License-Identifier: Apache-2.0
import type { Environment } from '../model'
import { DYNAMIC_VARS, parseVars } from '../model'

interface Props {
  env: Environment
  active: boolean
  onChange: (patch: Partial<Environment>) => void
  onActivate: () => void
}

function EnvEditor({ env, active, onChange, onActivate }: Props): React.JSX.Element {
  const count = Object.keys(parseVars(env.vars)).length

  return (
    <section className="editor env-editor">
      <div className="title-row">
        <span className="method method-env">ENV</span>
        <input
          className="name-input"
          value={env.name}
          spellCheck={false}
          aria-label="Environment name"
          onChange={(e) => onChange({ name: e.target.value })}
        />
        {active ? (
          <span className="chip chip-ok">active</span>
        ) : (
          <button className="btn btn-primary" onClick={onActivate}>
            Use this environment
          </button>
        )}
      </div>
      <div className="field">
        <div className="field-head">
          <span className="field-label">Variables · {count}</span>
        </div>
        <textarea
          className="env-vars"
          aria-label="Environment variables"
          value={env.vars}
          placeholder={'baseUrl=https://api.example.com\ntoken=secret'}
          spellCheck={false}
          onChange={(e) => onChange({ vars: e.target.value })}
        />
      </div>
      <p className="hint">
        One <code>name=value</code> per line, <code>#</code> starts a comment. Use them anywhere in
        a request as <code>{'{{name}}'}</code>. Built in:{' '}
        {DYNAMIC_VARS.map((v) => (
          <code key={v}>{`{{${v}}}`}</code>
        ))}
        . Stored locally, unencrypted.
      </p>
    </section>
  )
}

export default EnvEditor
