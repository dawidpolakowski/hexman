// SPDX-License-Identifier: Apache-2.0
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DiskWorkspace } from '../shared/collections'
import { MARKER, layout, readCollections, safeName, writeCollections } from './collections'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hexman-collections-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const request = (
  id: string,
  name: string,
  folderId: string | null = null
): DiskWorkspace['requests'][number] => ({
  id,
  name,
  kind: 'rest',
  method: 'GET',
  url: `{{baseUrl}}/${id}`,
  headers: '',
  body: '',
  variables: '',
  folderId
})

const workspace = (): DiskWorkspace => ({
  requests: [
    request('r1', 'Get user', 'f1'),
    request('r2', 'Login'),
    request('r3', 'Get user', 'f1')
  ],
  folders: [{ id: 'f1', name: 'Users' }],
  suites: [{ id: 's1', name: 'Smoke', threads: 1, rampUp: 0, loops: 1, steps: [] }],
  environments: [{ id: 'e1', name: 'Local', vars: 'baseUrl=http://localhost' }]
})

const read = (rel: string): unknown => JSON.parse(readFileSync(join(root, rel), 'utf8'))

describe('collections folder', () => {
  it('makes names safe on every OS', () => {
    expect(safeName('Users / Admin: *new*')).toBe('Users _ Admin_ _new_')
    expect(safeName('CON')).toBe('_CON')
    expect(safeName('  trailing dots... ')).toBe('trailing dots')
    expect(safeName('')).toBe('Untitled')
  })

  it('lays out one directory per collection and one file per item', () => {
    expect([...layout(workspace()).keys()]).toEqual([
      MARKER,
      'Users/collection.json',
      'Users/Get user.request.json',
      'Login.request.json',
      'Users/Get user (2).request.json',
      '_suites/Smoke.suite.json',
      '_environments/Local.env.json'
    ])
  })

  it('writes the workspace and reads it back', async () => {
    const { written } = await writeCollections(root, workspace(), new Set())
    expect(written).toBe(7)
    expect(read('Users/Get user.request.json')).toEqual({
      id: 'r1',
      name: 'Get user',
      kind: 'rest',
      method: 'GET',
      url: '{{baseUrl}}/r1',
      headers: '',
      body: '',
      variables: ''
    })
    const back = await readCollections(root)
    expect(back.problems).toEqual([])
    expect(back.folders).toEqual([{ id: 'f1', name: 'Users' }])
    expect(back.requests.map((r) => [r.id, r.name, r.folderId])).toEqual([
      ['r2', 'Login', null],
      ['r1', 'Get user', 'f1'],
      ['r3', 'Get user (2)', 'f1'] // the file name wins over a clashing name
    ])
    expect(back.suites[0]).toMatchObject({ id: 's1', name: 'Smoke' })
    expect(back.environments[0]).toMatchObject({ id: 'e1', vars: 'baseUrl=http://localhost' })
  })

  it('only rewrites files whose content changed', async () => {
    const first = await writeCollections(root, workspace(), new Set())
    const again = await writeCollections(root, workspace(), first.known)
    expect(again).toMatchObject({ written: 0, deleted: 0 })
  })

  it('moves renamed items and removes deleted ones, including empty collection directories', async () => {
    const { known } = await writeCollections(root, workspace(), new Set())
    const ws = workspace()
    ws.folders = [{ id: 'f1', name: 'People' }]
    ws.requests = ws.requests.filter((r) => r.id !== 'r2')
    const result = await writeCollections(root, ws, known)
    expect(result.deleted).toBe(4)
    expect(existsSync(join(root, 'Users'))).toBe(false)
    expect(existsSync(join(root, 'Login.request.json'))).toBe(false)
    expect(existsSync(join(root, 'People/Get user.request.json'))).toBe(true)
  })

  it('never deletes files it did not read or write', async () => {
    const { known } = await writeCollections(root, workspace(), new Set())
    writeFileSync(join(root, 'Ping.request.json'), JSON.stringify({ id: 'p', name: 'Ping' }))
    writeFileSync(join(root, 'notes.txt'), 'keep me')
    await writeCollections(root, { ...workspace(), requests: [] }, known)
    expect(existsSync(join(root, 'Ping.request.json'))).toBe(true)
    expect(existsSync(join(root, 'notes.txt'))).toBe(true)
  })

  it('reads a copied collection as a separate one, with fresh ids', async () => {
    await writeCollections(root, workspace(), new Set())
    cpSync(join(root, 'Users'), join(root, 'Users copy'), { recursive: true })
    const back = await readCollections(root)
    expect(back.folders.map((f) => [f.id, f.name])).toEqual([
      ['f1', 'Users'],
      ['f1~Users copy', 'Users copy']
    ])
    const copies = back.requests.filter((r) => r.folderId === 'f1~Users copy')
    expect(copies.map((r) => r.id)).toEqual([
      'r1~Users copy/Get user.request.json',
      'r3~Users copy/Get user (2).request.json'
    ])
  })

  it('accepts hand-made folders and files without ids, and reports broken files', async () => {
    mkdirSync(join(root, 'Orders'))
    writeFileSync(join(root, 'Orders', 'List.request.json'), JSON.stringify({ method: 'GET' }))
    writeFileSync(join(root, 'Orders', 'Broken.request.json'), '{ nope')
    const back = await readCollections(root)
    expect(back.folders).toEqual([{ id: 'dir:Orders', name: 'Orders' }])
    expect(back.requests).toEqual([
      { id: 'file:Orders/List.request.json', name: 'List', method: 'GET', folderId: 'dir:Orders' }
    ])
    expect(back.problems).toEqual([expect.stringContaining('Orders/Broken.request.json')])
    expect(back.known.has('Orders/Broken.request.json')).toBe(false)
  })
})
