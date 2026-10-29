// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {} }))
const { isSaveFileInput, readTextFile, writeTextFile } = await import('./files')

const dir = mkdtempSync(join(tmpdir(), 'hexman-files-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('workspace files', () => {
  it('writes and reads back UTF-8 text', async () => {
    const path = join(dir, 'ws.json')
    expect(await writeTextFile(path, '{"name":"Zażółć"}')).toEqual({ status: 'saved', path })
    expect(readFileSync(path, 'utf8')).toBe('{"name":"Zażółć"}')
    expect(await readTextFile(path)).toEqual({
      status: 'opened',
      path,
      content: '{"name":"Zażółć"}'
    })
  })

  it('reports a missing file as an error', async () => {
    const result = await readTextFile(join(dir, 'missing.json'))
    expect(result.status).toBe('error')
  })

  it('refuses files over the size limit', async () => {
    const path = join(dir, 'big.json')
    writeFileSync(path, Buffer.alloc(50 * 1024 * 1024 + 1))
    expect(await readTextFile(path)).toEqual({
      status: 'error',
      error: 'The file is larger than 50 MB'
    })
  })

  it('validates save requests coming over IPC', () => {
    expect(isSaveFileInput({ suggestedName: 'a.json', content: '{}' })).toBe(true)
    expect(isSaveFileInput({ suggestedName: 'a.json' })).toBe(false)
    expect(isSaveFileInput(null)).toBe(false)
  })
})
