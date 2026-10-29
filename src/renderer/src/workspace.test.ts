// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import type { StorageLike } from './model'
import { KEYS, createFolder, createRequest, toSaved } from './model'
import { createStep, createSuite } from './suite'
import type { Workspace } from './workspace'
import {
  BACKUP_KEY,
  SCHEMA_KEY,
  SCHEMA_VERSION,
  importSummary,
  mergeById,
  migrateStorage,
  parseWorkspace,
  rawSnapshot,
  serializeWorkspace
} from './workspace'

function memoryStorage(initial: Record<string, string> = {}): StorageLike & {
  data: Record<string, string>
} {
  const data = { ...initial }
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v
    }
  }
}

const saved = (over: Parameters<typeof createRequest>[0] = []): ReturnType<typeof toSaved> =>
  toSaved({ ...createRequest(over), saved: true })

describe('schema migrations', () => {
  it('stamps a fresh profile with the current schema', () => {
    const storage = memoryStorage()
    expect(migrateStorage(storage)).toEqual({ status: 'current', from: 1, to: 1 })
    expect(storage.data[SCHEMA_KEY]).toBe(String(SCHEMA_VERSION))
    expect(storage.data[BACKUP_KEY]).toBeUndefined()
  })

  it('treats data saved before versioning as schema 1', () => {
    const storage = memoryStorage({ [KEYS.requests]: '[]' })
    expect(migrateStorage(storage, {}, 1).status).toBe('current')
  })

  it('backs up the old data, then runs each pending migration in order', () => {
    const storage = memoryStorage({ [KEYS.folders]: '[{"id":"f","name":"Old"}]' })
    const ran: number[] = []
    const result = migrateStorage(
      storage,
      {
        2: (s) => {
          ran.push(2)
          s.setItem(KEYS.folders, '[{"id":"f","name":"New"}]')
        },
        3: () => ran.push(3)
      },
      3
    )
    expect(result).toEqual({ status: 'migrated', from: 1, to: 3 })
    expect(ran).toEqual([2, 3])
    expect(storage.data[SCHEMA_KEY]).toBe('3')
    const backup = JSON.parse(storage.data[BACKUP_KEY])
    expect(backup).toMatchObject({ format: 'hexman-backup', schema: 1 })
    expect(backup.data[KEYS.folders]).toBe('[{"id":"f","name":"Old"}]')
  })

  it('does not migrate when the backup cannot be written', () => {
    const storage = memoryStorage({ [KEYS.folders]: '[]' })
    const failing: StorageLike = {
      getItem: storage.getItem,
      setItem: () => {
        throw new Error('QuotaExceededError')
      }
    }
    let ran = false
    expect(() => migrateStorage(failing, { 2: () => (ran = true) }, 2)).toThrow(/Could not back up/)
    expect(ran).toBe(false)
  })

  it('leaves data from a newer Hexman untouched', () => {
    const storage = memoryStorage({ [SCHEMA_KEY]: '9', [KEYS.requests]: '[]' })
    expect(migrateStorage(storage)).toEqual({ status: 'newer', from: 9, to: SCHEMA_VERSION })
    expect(storage.data[SCHEMA_KEY]).toBe('9')
  })
})

describe('workspace export / import', () => {
  const folder = createFolder([])
  const request = { ...saved(), name: 'Login', folderId: folder.id }
  const suite = { ...createSuite([]), steps: [createStep(request.id)] }
  const ws: Workspace = {
    requests: [request],
    folders: [folder],
    suites: [suite],
    environments: [{ id: 'env', name: 'Staging', vars: 'baseUrl=https://staging' }]
  }

  it('round-trips through the file format', () => {
    const text = serializeWorkspace(ws, new Date('2026-10-29T10:00:00Z'))
    expect(JSON.parse(text)).toMatchObject({
      format: 'hexman-workspace',
      schema: SCHEMA_VERSION,
      exportedAt: '2026-10-29T10:00:00.000Z'
    })
    expect(parseWorkspace(text)).toEqual(ws)
  })

  it('rejects files that are not workspace exports', () => {
    expect(() => parseWorkspace('nope')).toThrow('not valid JSON')
    expect(() => parseWorkspace('{"requests":[]}')).toThrow('not a Hexman workspace')
    expect(() => parseWorkspace('{"format":"hexman-workspace","schema":99}')).toThrow(
      /newer Hexman \(schema 99\)/
    )
  })

  it('repairs or drops broken records instead of failing', () => {
    const text = JSON.stringify({
      format: 'hexman-workspace',
      schema: 1,
      requests: [{ id: 'r', name: 'R', method: 'BREW', url: 7 }, { name: 'no id' }, 'junk'],
      folders: 'not a list'
    })
    const parsed = parseWorkspace(text)
    expect(parsed.requests).toEqual([
      {
        id: 'r',
        name: 'R',
        kind: 'rest',
        method: 'GET',
        url: '',
        headers: '',
        body: '',
        variables: '',
        folderId: null
      }
    ])
    expect(parsed.folders).toEqual([])
  })

  it('imports a raw backup file', () => {
    const storage = memoryStorage({
      [KEYS.requests]: JSON.stringify([request]),
      [KEYS.environments]: JSON.stringify(ws.environments)
    })
    const parsed = parseWorkspace(JSON.stringify(rawSnapshot(storage)))
    expect(parsed.requests).toEqual([request])
    expect(parsed.environments).toEqual(ws.environments)
    expect(parsed.suites).toEqual([])
  })

  it('replaces items with a known id in place and appends new ones', () => {
    const a = { id: 'a', name: 'A' }
    const b = { id: 'b', name: 'B' }
    expect(
      mergeById(
        [a, b],
        [
          { id: 'a', name: 'A2' },
          { id: 'c', name: 'C' }
        ]
      )
    ).toEqual([{ id: 'a', name: 'A2' }, b, { id: 'c', name: 'C' }])
  })

  it('summarizes how many items an import adds and replaces', () => {
    const other = saved([request as never])
    const incoming: Workspace = { ...ws, requests: [request, other], suites: [] }
    const current: Workspace = { requests: [request], folders: [], suites: [], environments: [] }
    expect(importSummary(current, incoming)).toEqual([
      { label: 'Requests', total: 2, replacing: 1 },
      { label: 'Folders', total: 1, replacing: 0 },
      { label: 'Suites', total: 0, replacing: 0 },
      { label: 'Environments', total: 1, replacing: 0 }
    ])
  })
})
