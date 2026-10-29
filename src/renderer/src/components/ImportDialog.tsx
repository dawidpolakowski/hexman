// SPDX-License-Identifier: Apache-2.0
import { useEffect } from 'react'
import type { ImportLine } from '../workspace'

interface Props {
  fileName: string
  lines: ImportLine[]
  onConfirm: () => void
  onCancel: () => void
}

function ImportDialog({ fileName, lines, onConfirm, onCancel }: Props): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const shown = lines.filter((l) => l.total > 0)
  const replacing = shown.reduce((n, l) => n + l.replacing, 0)

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="import-title" className="modal-title">
          Import workspace
        </h2>
        <p className="modal-file" title={fileName}>
          {fileName}
        </p>
        <table className="import-summary">
          <tbody>
            {shown.map((l) => (
              <tr key={l.label}>
                <th>{l.label}</th>
                <td>{l.total}</td>
                <td className="import-replacing">
                  {l.replacing > 0 && `${l.replacing} replace existing`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">
          {replacing > 0
            ? 'Items that already exist here are replaced by the imported version. Everything else is added.'
            : 'Everything is added next to what you already have.'}
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" autoFocus onClick={onConfirm}>
            Import
          </button>
        </div>
      </div>
    </div>
  )
}

export default ImportDialog
