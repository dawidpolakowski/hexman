// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react'

interface Props {
  hints: { used: string[]; common: string[] }
  onPick: (line: string) => void
}

function HeaderSuggest({ hints, onPick }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const needle = filter.trim().toLowerCase()
  const groups: [string, string[]][] = [
    ['From your requests', hints.used.filter((l) => l.toLowerCase().includes(needle))],
    ['Common', hints.common.filter((l) => l.toLowerCase().includes(needle))]
  ]
  const first = groups.flatMap(([, items]) => items)[0]
  const custom = /^[^:\s][^:]*:/.test(filter.trim()) ? filter.trim() : null

  const pick = (line: string): void => {
    onPick(line)
    setOpen(false)
    setFilter('')
  }

  return (
    <div className="suggest" ref={root}>
      <button
        type="button"
        className="icon-btn"
        aria-label="Add header"
        aria-expanded={open}
        title="Add header"
        onClick={() => setOpen((o) => !o)}
      >
        +
      </button>
      {open && (
        <div
          className="suggest-menu"
          role="menu"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
          }}
        >
          <input
            className="suggest-filter"
            autoFocus
            placeholder="Filter, or type Name: value ↵"
            value={filter}
            spellCheck={false}
            aria-label="Filter headers"
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              const line = custom ?? first
              if (line) pick(line)
            }}
          />
          <div className="suggest-list">
            {groups.map(
              ([title, items]) =>
                items.length > 0 && (
                  <div key={title}>
                    <div className="suggest-title">{title}</div>
                    {items.map((line) => {
                      const colon = line.indexOf(':')
                      return (
                        <button
                          key={line}
                          type="button"
                          role="menuitem"
                          className="suggest-item"
                          onClick={() => pick(line)}
                        >
                          <span className="h-key">{line.slice(0, colon)}</span>
                          <span className="h-val">{line.slice(colon + 1).trim()}</span>
                        </button>
                      )
                    })}
                  </div>
                )
            )}
            {!first && (
              <div className="suggest-empty">
                {custom ? `↵ adds "${custom}"` : 'No matching headers'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default HeaderSuggest
