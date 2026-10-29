import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import DataBlocked from './components/DataBlocked'
import type { MigrationResult } from './workspace'
import { migrateStorage, storedSchema } from './workspace'

// Stored data is brought up to the current schema before anything reads it.
function startup(): React.JSX.Element {
  let migration: MigrationResult
  try {
    migration = migrateStorage()
  } catch (err) {
    return <DataBlocked reason={(err as Error).message} schema={storedSchema()} />
  }
  if (migration.status === 'newer') {
    return (
      <DataBlocked
        reason={`Your data was saved by a newer version of Hexman (schema ${migration.from}, this version reads ${migration.to}). Update Hexman to open it.`}
        schema={migration.from}
      />
    )
  }
  return <App migration={migration} />
}

createRoot(document.getElementById('root')!).render(<StrictMode>{startup()}</StrictMode>)
