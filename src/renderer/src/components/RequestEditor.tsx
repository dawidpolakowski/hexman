// SPDX-License-Identifier: Apache-2.0
import type { View } from '../formats'
import { FORMATS, curlToPatch, looksLikeCurl } from '../formats'
import type { ApiRequest, Folder } from '../model'
import { METHODS, insertHeader, substitute } from '../model'
import CodeView from './CodeView'
import HeaderSuggest from './HeaderSuggest'

const VIEWS: [View, string][] = [
  ['form', 'Form'],
  ['curl', 'cURL'],
  ['json', 'JSON']
]

interface Props {
  request: ApiRequest
  folders: Folder[]
  vars: Record<string, string>
  view: View
  sending: boolean
  headerHints: { used: string[]; common: string[] }
  onViewChange: (view: View) => void
  onChange: (patch: Partial<ApiRequest>) => void
  onMove: (folderId: string | null) => void
  onSend: () => void
  onCancel: () => void
  onSave: () => void
}

/** What a URL with {{variables}} resolves to in the active environment. */
function preview(url: string, vars: Record<string, string>): { text: string; bad: boolean } | null {
  if (!url.includes('{{')) return null
  try {
    return { text: substitute(url, vars), bad: false }
  } catch (err) {
    return { text: (err as Error).message, bad: true }
  }
}

function RequestEditor(p: Props): React.JSX.Element {
  const { request, view } = p
  const isGql = request.kind === 'graphql'
  const resolved = preview(request.url, p.vars)

  return (
    <section
      className="editor"
      onKeyDown={(e) => {
        if (view === 'form' && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault()
          p.onSend()
        }
      }}
    >
      <div className="title-row">
        <input
          className="name-input"
          value={request.name}
          spellCheck={false}
          aria-label="Request name"
          onChange={(e) => p.onChange({ name: e.target.value })}
        />
        {p.folders.length > 0 && (
          <select
            className="mini-select"
            aria-label="Folder"
            value={request.folderId ?? ''}
            onChange={(e) => p.onMove(e.target.value || null)}
          >
            <option value="">No folder</option>
            {p.folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}
        <span className={`chip ${request.saved ? 'chip-ok' : 'chip-muted'}`}>
          {request.saved ? (request.dirty ? 'modified' : 'saved') : 'unsaved'}
        </span>
        <div className="segmented" role="group" aria-label="Request view">
          {VIEWS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              onClick={() => p.onViewChange(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="btn btn-save"
          onClick={p.onSave}
          disabled={request.saved && !request.dirty}
          title="Save (Ctrl+S)"
        >
          Save
        </button>
      </div>

      {view === 'form' ? (
        <>
          <form
            className="url-row"
            onSubmit={(e) => {
              e.preventDefault()
              p.onSend()
            }}
          >
            <select
              className="method-select"
              value={request.method}
              aria-label="HTTP method"
              onChange={(e) => p.onChange({ method: e.target.value as ApiRequest['method'] })}
            >
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <input
              className="url-input"
              value={request.url}
              placeholder="{{baseUrl}}/resource — or paste a cURL command"
              spellCheck={false}
              aria-label="URL"
              onChange={(e) => p.onChange({ url: e.target.value })}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text')
                if (!looksLikeCurl(text)) return
                try {
                  p.onChange(curlToPatch(text))
                  e.preventDefault()
                } catch {
                  /* not a complete command: paste it as plain text */
                }
              }}
            />
            {p.sending ? (
              <button className="btn btn-stop" type="button" onClick={p.onCancel}>
                Cancel
              </button>
            ) : (
              <button className="btn btn-send" type="submit" disabled={!request.url.trim()}>
                Send
              </button>
            )}
          </form>
          {resolved && (
            <div className={`url-preview${resolved.bad ? ' bad' : ''}`}>
              {resolved.bad ? '⚠ ' : '→ '}
              {resolved.text}
            </div>
          )}

          <div className="fields">
            <div className="field">
              <div className="field-head">
                <span className="field-label">Headers</span>
                <HeaderSuggest
                  hints={p.headerHints}
                  onPick={(line) => p.onChange({ headers: insertHeader(request.headers, line) })}
                />
              </div>
              <textarea
                aria-label="Headers"
                value={request.headers}
                placeholder={'Authorization: Bearer {{token}}\nAccept: application/json'}
                spellCheck={false}
                onChange={(e) => p.onChange({ headers: e.target.value })}
              />
            </div>
            <div className="field">
              <div className="field-head">
                <span className="field-label">{isGql ? 'Query' : 'Body'}</span>
              </div>
              <textarea
                aria-label={isGql ? 'Query' : 'Body'}
                value={request.body}
                placeholder={isGql ? '{ viewer { login } }' : '{ "hello": "world" }'}
                spellCheck={false}
                onChange={(e) => p.onChange({ body: e.target.value })}
              />
            </div>
            {isGql && (
              <div className="field">
                <div className="field-head">
                  <span className="field-label">Variables (JSON)</span>
                </div>
                <textarea
                  aria-label="Variables"
                  value={request.variables}
                  placeholder={'{ "id": 1 }'}
                  spellCheck={false}
                  onChange={(e) => p.onChange({ variables: e.target.value })}
                />
              </div>
            )}
          </div>
        </>
      ) : (
        <CodeView
          key={view}
          format={FORMATS[view]}
          request={request}
          sending={p.sending}
          onChange={p.onChange}
          onSend={p.onSend}
          onCancel={p.onCancel}
        />
      )}
    </section>
  )
}

export default RequestEditor
