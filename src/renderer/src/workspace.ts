// SPDX-License-Identifier: Apache-2.0
// The stored data schema (versioned, migrated with a backup) and the workspace export/import file.
import type { DiskWorkspace } from '../../shared/collections'
import type { Environment, Folder, SavedRequest, StorageLike } from './model'
import {
  KEYS,
  asRecords,
  isRecord,
  normalizeEnvironment,
  normalizeFolder,
  normalizeRequest,
  readJson,
  restore,
  restoreEnvironments,
  restoreFolders,
  toSaved,
  writeJson
} from './model'
import type { Suite } from './suite'
import { normalizeSuite, restoreSuites } from './suite'

/** Bump when stored data changes shape, and add a migration that upgrades the previous version. */
export const SCHEMA_VERSION = 2
export const SCHEMA_KEY = 'hexman.schema'
export const BACKUP_KEY = 'hexman.backup'

export type Migration = (storage: StorageLike) => void

/** MIGRATIONS[n] upgrades stored data from schema n - 1 to schema n. */
export const MIGRATIONS: Record<number, Migration> = {
  // 2: suite steps carry extractors.
  2: (storage) => {
    const suites = readJson(KEYS.suites, storage)
    if (!Array.isArray(suites)) return
    for (const suite of suites) {
      if (!isRecord(suite) || !Array.isArray(suite.steps)) continue
      for (const step of suite.steps) if (isRecord(step) && !step.extract) step.extract = []
    }
    writeJson(KEYS.suites, suites, storage)
  }
}

export type MigrationResult =
  | { status: 'current' | 'migrated'; from: number; to: number }
  | { status: 'newer'; from: number; to: number }

export const BACKUP_FORMAT = 'hexman-backup'

export interface RawSnapshot {
  format: typeof BACKUP_FORMAT
  schema: number
  savedAt: string
  data: Record<string, string>
}

/** Every stored Hexman value, verbatim: a backup that survives any parsing bug. */
export function rawSnapshot(
  storage: StorageLike = localStorage,
  schema = SCHEMA_VERSION,
  now = new Date()
): RawSnapshot {
  const data: Record<string, string> = {}
  for (const key of Object.values(KEYS)) {
    const value = storage.getItem(key)
    if (value !== null) data[key] = value
  }
  return { format: BACKUP_FORMAT, schema, savedAt: now.toISOString(), data }
}

/** The schema stored data was written with; data saved before versioning existed is schema 1. */
export function storedSchema(storage: StorageLike = localStorage): number {
  const stored = readJson(SCHEMA_KEY, storage)
  return typeof stored === 'number' ? stored : 1
}

/**
 * Brings stored data up to the current schema. Before any migration runs, the old data is copied
 * to BACKUP_KEY; if that copy can't be written, nothing is migrated. Data written by a newer
 * Hexman is left alone (status "newer"), so a downgrade can't destroy it.
 */
export function migrateStorage(
  storage: StorageLike = localStorage,
  migrations: Record<number, Migration> = MIGRATIONS,
  target = SCHEMA_VERSION
): MigrationResult {
  const hasData = Object.values(KEYS).some((key) => storage.getItem(key) !== null)
  // A fresh profile starts at the current schema.
  const from =
    readJson(SCHEMA_KEY, storage) === undefined && !hasData ? target : storedSchema(storage)
  if (from > target) return { status: 'newer', from, to: target }

  if (from < target) {
    try {
      storage.setItem(BACKUP_KEY, JSON.stringify(rawSnapshot(storage, from)))
    } catch (err) {
      throw new Error(`Could not back up your data before upgrading it: ${(err as Error).message}`)
    }
    for (let version = from + 1; version <= target; version++) migrations[version]?.(storage)
  }
  writeJson(SCHEMA_KEY, target, storage)
  return { status: from === target ? 'current' : 'migrated', from, to: target }
}

/* ---- export / import ---- */

export interface Workspace {
  requests: SavedRequest[]
  folders: Folder[]
  suites: Suite[]
  environments: Environment[]
}

export const WORKSPACE_FORMAT = 'hexman-workspace'

export function serializeWorkspace(ws: Workspace, now = new Date()): string {
  return JSON.stringify(
    { format: WORKSPACE_FORMAT, schema: SCHEMA_VERSION, exportedAt: now.toISOString(), ...ws },
    null,
    2
  )
}

function memoryStorage(data: Record<string, string>): StorageLike {
  return {
    getItem: (key) => (Object.hasOwn(data, key) ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value
    }
  }
}

/** A raw backup is replayed through the normal migrations, so old backups stay importable. */
function workspaceFromBackup(data: Record<string, unknown>, schema: number): Workspace {
  const values: Record<string, string> = {}
  for (const [key, value] of Object.entries(data))
    if (typeof value === 'string') values[key] = value
  const storage = memoryStorage({ ...values, [SCHEMA_KEY]: String(schema) })
  migrateStorage(storage)
  return {
    requests: restore(storage).map(toSaved),
    folders: restoreFolders(storage),
    suites: restoreSuites(storage),
    environments: restoreEnvironments(storage)
  }
}

/** Reads a workspace export (or a raw backup); throws a readable error when it is neither. */
export function parseWorkspace(text: string): Workspace {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    throw new Error('The file is not valid JSON')
  }
  if (!isRecord(doc) || (doc.format !== WORKSPACE_FORMAT && doc.format !== BACKUP_FORMAT)) {
    throw new Error('The file is not a Hexman workspace export')
  }
  const schema = typeof doc.schema === 'number' ? doc.schema : 1
  if (schema > SCHEMA_VERSION) {
    throw new Error(
      `The file was exported by a newer Hexman (schema ${schema}). Update Hexman to import it.`
    )
  }
  if (doc.format === BACKUP_FORMAT)
    return workspaceFromBackup(isRecord(doc.data) ? doc.data : {}, schema)
  return {
    requests: asRecords(doc.requests).map(normalizeRequest).map(toSaved),
    folders: asRecords(doc.folders).map(normalizeFolder),
    suites: asRecords(doc.suites).map(normalizeSuite),
    environments: asRecords(doc.environments).map(normalizeEnvironment)
  }
}

/**
 * Items with a known id replace the existing one in place and new items are appended; items
 * missing from `incoming` stay only when keepMissing is set.
 */
export function syncById<T extends { id: string }>(
  current: T[],
  incoming: T[],
  keepMissing: boolean
): T[] {
  const byId = new Map(incoming.map((item) => [item.id, item]))
  const kept = current.flatMap((item) => {
    const next = byId.get(item.id)
    return next ? [next] : keepMissing ? [item] : []
  })
  const known = new Set(current.map((item) => item.id))
  return [...kept, ...incoming.filter((item) => !known.has(item.id))]
}

export const mergeById = <T extends { id: string }>(current: T[], incoming: T[]): T[] =>
  syncById(current, incoming, true)

/** Records read from the collections folder, repaired like an import. */
export const workspaceFromDisk = (disk: DiskWorkspace): Workspace => ({
  requests: asRecords(disk.requests).map(normalizeRequest).map(toSaved),
  folders: asRecords(disk.folders).map(normalizeFolder),
  suites: asRecords(disk.suites).map(normalizeSuite),
  environments: asRecords(disk.environments).map(normalizeEnvironment)
})

export interface ImportLine {
  label: string
  total: number
  replacing: number
}

export function importSummary(current: Workspace, incoming: Workspace): ImportLine[] {
  const line = (label: string, have: { id: string }[], add: { id: string }[]): ImportLine => {
    const known = new Set(have.map((item) => item.id))
    return { label, total: add.length, replacing: add.filter((i) => known.has(i.id)).length }
  }
  return [
    line('Requests', current.requests, incoming.requests),
    line('Folders', current.folders, incoming.folders),
    line('Suites', current.suites, incoming.suites),
    line('Environments', current.environments, incoming.environments)
  ]
}

export const isEmptyWorkspace = (ws: Workspace): boolean =>
  !ws.requests.length && !ws.folders.length && !ws.suites.length && !ws.environments.length
