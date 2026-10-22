// SPDX-License-Identifier: Apache-2.0
import type { HttpResult } from '../../../shared/http'
import { prettyBody } from '../model'

interface Props {
  result: HttpResult | null
  sending: boolean
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function statusClass(status: number): string {
  if (status < 300) return 'ok'
  if (status < 400) return 'warn'
  return 'bad'
}

function ResponseView({ result, sending }: Props): React.JSX.Element {
  if (sending) {
    return (
      <section className="response response-empty">
        <div className="pulse">Sending…</div>
      </section>
    )
  }
  if (!result) {
    return (
      <section className="response response-empty">
        <div className="hint">Hit Send to see the response.</div>
      </section>
    )
  }
  if (!result.ok) {
    return (
      <section className="response">
        <div className="response-bar">
          <span className="chip chip-bad">Error</span>
          <span className="error-text">{result.error}</span>
        </div>
      </section>
    )
  }

  const { response } = result
  const contentType = response.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1]

  return (
    <section className="response">
      <div className="response-bar">
        <span className={`chip chip-${statusClass(response.status)}`}>
          {response.status} {response.statusText}
        </span>
        <span className="stat">{response.durationMs} ms</span>
        <span className="stat">{formatSize(response.sizeBytes)}</span>
        {response.truncated && <span className="stat stat-warn">truncated</span>}
      </div>
      <div className="response-grid">
        <pre className="code-block">{prettyBody(response.body, contentType) || '(empty body)'}</pre>
        <dl className="resp-headers">
          {response.headers.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

export default ResponseView
