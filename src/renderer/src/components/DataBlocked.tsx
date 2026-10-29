// SPDX-License-Identifier: Apache-2.0
// Shown instead of the app when stored data can't be opened safely (newer schema, failed upgrade).
import { useState } from 'react'
import { rawSnapshot } from '../workspace'

interface Props {
  reason: string
  schema: number
}

function DataBlocked({ reason, schema }: Props): React.JSX.Element {
  const [status, setStatus] = useState('')

  const saveCopy = async (): Promise<void> => {
    const result = await window.api.saveFile({
      suggestedName: 'hexman-backup.json',
      content: JSON.stringify(rawSnapshot(localStorage, schema), null, 2)
    })
    if (result.status === 'saved') setStatus(`Saved to ${result.path}`)
    if (result.status === 'error') setStatus(`Could not save: ${result.error}`)
  }

  return (
    <div className="blocked">
      <div className="modal">
        <h2 className="modal-title">Hexman can&apos;t open your data</h2>
        <p>{reason}</p>
        <p className="hint">Nothing has been changed. You can keep a copy of the data as a file.</p>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={saveCopy}>
            Save a copy…
          </button>
        </div>
        {status && <p className="hint">{status}</p>}
      </div>
    </div>
  )
}

export default DataBlocked
