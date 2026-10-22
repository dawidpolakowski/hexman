// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react'
import type { TextFormat } from '../formats'
import type { ApiRequest } from '../model'

interface Props {
  format: TextFormat
  request: ApiRequest
  sending: boolean
  onChange: (patch: Partial<ApiRequest>) => void
  onSend: () => void
}

function serialize(
  format: TextFormat,
  request: ApiRequest
): { text: string; error: string | null } {
  try {
    return { text: format.serialize(request), error: null }
  } catch (err) {
    return { text: '', error: (err as Error).message }
  }
}

/** The request as editable text (cURL or JSON); every valid edit flows back into the request. */
function CodeView({ format, request, sending, onChange, onSend }: Props): React.JSX.Element {
  const current = serialize(format, request)
  const [synced, setSynced] = useState(current.text)
  const [text, setText] = useState(current.text)
  const [error, setError] = useState(current.error)
  const [copied, setCopied] = useState(false)

  // The request changed somewhere else (e.g. renamed in the title): show the fresh text.
  if (current.text !== synced) {
    setSynced(current.text)
    setText(current.text)
    setError(current.error)
  }

  const edit = (value: string): void => {
    setText(value)
    try {
      const patch = format.parse(value)
      const next = serialize(format, { ...request, ...patch })
      setError(null)
      setSynced(next.text)
      if (next.text !== current.text) onChange(patch)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="code-view">
      <textarea
        className="code-editor"
        aria-label={`${format.label} source`}
        value={text}
        spellCheck={false}
        onChange={(e) => edit(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !error) {
            e.preventDefault()
            onSend()
          }
        }}
      />
      <div className="code-footer">
        {error ? (
          <span className="code-error">✗ {error}</span>
        ) : (
          <span className="code-ok">✓ In sync with the form</span>
        )}
        <span className="spacer" />
        <button type="button" className="btn" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          className="btn btn-send"
          disabled={!!error || sending || !request.url.trim()}
          onClick={onSend}
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}

export default CodeView
