// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react'
import type { ApiRequest, Folder } from '../model'
import type { Suite, SuiteStep } from '../suite'
import { LIMITS, createStep, plannedSamples, summarize } from '../suite'
import type { RunState } from '../useSuiteRuns'
import MethodBadge from './MethodBadge'

interface Props {
  suite: Suite
  requests: ApiRequest[]
  folders: Folder[]
  run: RunState | undefined
  envName: string | null
  onChange: (patch: Partial<Suite>) => void
  onRun: () => void
  onStop: () => void
}

function NumberField(p: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}): React.JSX.Element {
  const [text, setText] = useState(String(p.value))
  const [prev, setPrev] = useState(p.value)
  if (p.value !== prev) {
    setPrev(p.value)
    setText(String(p.value))
  }
  return (
    <label className="num-field">
      <span>{p.label}</span>
      <input
        type="number"
        min={p.min}
        max={p.max}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const n = Number(e.target.value)
          if (e.target.value !== '' && Number.isInteger(n) && n >= p.min && n <= p.max)
            p.onChange(n)
        }}
        onBlur={() => setText(String(p.value))}
      />
    </label>
  )
}

const pct = (part: number, whole: number): string =>
  whole ? `${((part / whole) * 100).toFixed(part === whole || part === 0 ? 0 : 1)}%` : '0%'

function SuiteEditor({
  suite,
  requests,
  folders,
  run,
  envName,
  onChange,
  onRun,
  onStop
}: Props): React.JSX.Element {
  const byId = new Map(requests.map((r) => [r.id, r]))
  const label = (r: ApiRequest): string => {
    const folder = folders.find((f) => f.id === r.folderId)
    return folder ? `${folder.name} / ${r.name}` : r.name
  }
  const saved = requests.filter((r) => r.saved)

  const updateStep = (id: string, patch: Partial<SuiteStep>): void =>
    onChange({ steps: suite.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
  const moveStep = (index: number, delta: number): void => {
    const steps = [...suite.steps]
    const [step] = steps.splice(index, 1)
    steps.splice(index + delta, 0, step)
    onChange({ steps })
  }

  const running = run?.running ?? false
  const summary = run ? summarize(suite.steps, run.samples) : null
  const elapsed = run ? (run.endedAt ?? run.now) - run.startedAt : 0
  const failures = run
    ? run.samples
        .filter((s) => s.failures.length > 0)
        .slice(-50)
        .reverse()
    : []
  const stepLabel = (stepId: string): string => {
    const index = suite.steps.findIndex((s) => s.id === stepId)
    const r = byId.get(suite.steps[index]?.requestId ?? '')
    return `${index + 1}. ${r ? r.name : 'Removed step'}`
  }

  let verdict = { text: 'Passed', cls: 'chip-ok' }
  if (running) verdict = { text: 'Running', cls: 'chip-muted' }
  else if (run?.stopped) verdict = { text: 'Stopped', cls: 'chip-warn' }
  else if (summary?.total.errors) verdict = { text: 'Failed', cls: 'chip-bad' }

  return (
    <div className="suite">
      <section className="editor">
        <div className="title-row">
          <span className="method method-suite">SUITE</span>
          <input
            className="name-input"
            value={suite.name}
            spellCheck={false}
            aria-label="Suite name"
            onChange={(e) => onChange({ name: e.target.value })}
          />
          <span className="env-note">{envName ? `env: ${envName}` : 'no environment'}</span>
          {running ? (
            <button className="btn btn-stop" onClick={onStop}>
              ■ Stop
            </button>
          ) : (
            <button
              className="btn btn-send btn-run"
              onClick={onRun}
              disabled={suite.steps.length === 0}
            >
              ▶ Run
            </button>
          )}
        </div>
        <div className="thread-group">
          <span className="field-label">Thread group</span>
          <NumberField
            label="Threads"
            value={suite.threads}
            min={1}
            max={LIMITS.threads}
            onChange={(threads) => onChange({ threads })}
          />
          <NumberField
            label="Ramp-up (s)"
            value={suite.rampUp}
            min={0}
            max={LIMITS.rampUp}
            onChange={(rampUp) => onChange({ rampUp })}
          />
          <NumberField
            label="Loops"
            value={suite.loops}
            min={1}
            max={LIMITS.loops}
            onChange={(loops) => onChange({ loops })}
          />
          <span className="tg-total">= {plannedSamples(suite)} samples</span>
        </div>
      </section>

      <section className="editor">
        <div className="field-head">
          <span className="field-label">Steps · assertions</span>
        </div>
        <div className="steps">
          {suite.steps.map((step, i) => {
            const r = byId.get(step.requestId)
            return (
              <div className="step" key={step.id}>
                <span className="step-index">{i + 1}</span>
                {r ? <MethodBadge request={r} /> : <span className="method">?</span>}
                <span className={`step-name${r ? '' : ' missing'}`}>
                  {r ? label(r) : 'Request was deleted'}
                </span>
                <label className="assert">
                  <span>Status</span>
                  <input
                    value={step.status}
                    placeholder="any"
                    spellCheck={false}
                    onChange={(e) => updateStep(step.id, { status: e.target.value })}
                  />
                </label>
                <label className="assert">
                  <span>Max ms</span>
                  <input
                    value={step.maxMs}
                    placeholder="—"
                    inputMode="numeric"
                    onChange={(e) => updateStep(step.id, { maxMs: e.target.value })}
                  />
                </label>
                <label className="assert assert-wide">
                  <span>Body contains</span>
                  <input
                    value={step.contains}
                    placeholder="—"
                    spellCheck={false}
                    onChange={(e) => updateStep(step.id, { contains: e.target.value })}
                  />
                </label>
                <div className="step-actions">
                  <button
                    className="tile-edit"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() => moveStep(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    className="tile-edit"
                    aria-label="Move down"
                    disabled={i === suite.steps.length - 1}
                    onClick={() => moveStep(i, 1)}
                  >
                    ↓
                  </button>
                  <button
                    className="tile-edit danger"
                    aria-label="Remove step"
                    onClick={() => onChange({ steps: suite.steps.filter((s) => s.id !== step.id) })}
                  >
                    ×
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        <select
          className="add-step"
          value=""
          aria-label="Add step"
          disabled={saved.length === 0}
          onChange={(e) => {
            if (e.target.value) onChange({ steps: [...suite.steps, createStep(e.target.value)] })
          }}
        >
          <option value="">
            {saved.length ? '+ Add step: pick a saved request…' : 'Save a request first to add it'}
          </option>
          {saved.map((r) => (
            <option key={r.id} value={r.id}>
              {r.kind === 'graphql' ? 'GQL' : r.method} · {label(r)}
            </option>
          ))}
        </select>
      </section>

      {run && summary && (
        <section className="editor report">
          <div className="report-head">
            <span className={`chip ${verdict.cls}`}>{verdict.text}</span>
            <div className="progress" aria-label="Progress">
              <div style={{ width: pct(run.samples.length, run.planned) }} />
            </div>
            <span className="stat">
              {run.samples.length}/{run.planned} samples
            </span>
            <span className="stat">{(elapsed / 1000).toFixed(1)} s</span>
            <span className="stat">
              {elapsed ? ((run.samples.length * 1000) / elapsed).toFixed(1) : '0.0'} req/s
            </span>
          </div>
          <table className="summary">
            <thead>
              <tr>
                <th>Step</th>
                <th>Samples</th>
                <th>Avg ms</th>
                <th>Min</th>
                <th>Max</th>
                <th>P90</th>
                <th>Errors</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row) => (
                <tr key={row.stepId}>
                  <td>{stepLabel(row.stepId)}</td>
                  <td>{row.samples}</td>
                  <td>{row.avg}</td>
                  <td>{row.min}</td>
                  <td>{row.max}</td>
                  <td>{row.p90}</td>
                  <td className={row.errors ? 'bad' : 'good'}>{pct(row.errors, row.samples)}</td>
                </tr>
              ))}
              <tr className="total">
                <td>Total</td>
                <td>{summary.total.samples}</td>
                <td>{summary.total.avg}</td>
                <td>{summary.total.min}</td>
                <td>{summary.total.max}</td>
                <td>{summary.total.p90}</td>
                <td className={summary.total.errors ? 'bad' : 'good'}>
                  {pct(summary.total.errors, summary.total.samples)}
                </td>
              </tr>
            </tbody>
          </table>
          {failures.length > 0 && (
            <div className="failures">
              <div className="field-label">Failed samples (latest {failures.length})</div>
              {failures.map((s, i) => (
                <div className="failure" key={i}>
                  <span className="failure-where">
                    T{s.thread + 1} · loop {s.iteration + 1}
                  </span>
                  <span className="failure-step">{stepLabel(s.stepId)}</span>
                  <span className="failure-why">{s.failures.join(' · ')}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

export default SuiteEditor
