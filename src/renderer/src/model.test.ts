// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import type { ApiRequest, Folder } from './model'
import {
  KEYS,
  buildHttpInput,
  createFolder,
  createRequest,
  headerSuggestions,
  insertHeader,
  nextName,
  parseHeaders,
  parseVars,
  persist,
  prettyBody,
  resolveRequest,
  restore,
  restoreFolders,
  sidebarLayout,
  sidebarOrder,
  substitute
} from './model'

function memoryStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const data = { ...initial }
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v
    }
  }
}

const make = (over: Partial<ApiRequest> = {}): ApiRequest => ({
  ...createRequest([]),
  ...over
})

describe('naming', () => {
  it('starts at Request 1', () => {
    expect(nextName([])).toBe('Request 1')
  })

  it('continues after the highest number, ignoring custom names', () => {
    expect(nextName([{ name: 'Request 1' }, { name: 'Login' }, { name: 'Request 7' }])).toBe(
      'Request 8'
    )
  })

  it('numbers new requests sequentially', () => {
    const a = createRequest([])
    const b = createRequest([a])
    expect([a.name, b.name]).toEqual(['Request 1', 'Request 2'])
  })

  it('uses its own counter per prefix', () => {
    expect(createFolder([{ id: 'f', name: 'Folder 2', collapsed: false }]).name).toBe('Folder 3')
    expect(nextName([{ name: 'Request 4' }], 'Suite')).toBe('Suite 1')
  })

  it('creates GraphQL requests as POST', () => {
    expect(createRequest([], 'graphql').method).toBe('POST')
  })
})

describe('sidebar layout', () => {
  const users: Folder = { id: 'users', name: 'Users', collapsed: false }
  const list = [
    make({ id: 'draft-a', saved: false }),
    make({ id: 'root', saved: true }),
    make({ id: 'in-users', saved: true, folderId: 'users' }),
    make({ id: 'draft-in-users', saved: false, folderId: 'users' }),
    make({ id: 'orphan', saved: true, folderId: 'deleted-folder' })
  ]

  it('groups saved requests by folder and keeps unsaved drafts at the bottom', () => {
    const layout = sidebarLayout(list, [users])
    expect(layout.folders[0].requests.map((r) => r.id)).toEqual(['in-users'])
    expect(layout.root.map((r) => r.id)).toEqual(['root', 'orphan'])
    expect(layout.drafts.map((r) => r.id)).toEqual(['draft-a', 'draft-in-users'])
  })

  it('flattens to the visual order', () => {
    expect(sidebarOrder(list, [users]).map((r) => r.id)).toEqual([
      'in-users',
      'root',
      'orphan',
      'draft-a',
      'draft-in-users'
    ])
  })
})

describe('headers', () => {
  it('parses Key: Value lines, keeping colons in values', () => {
    expect(
      parseHeaders('Accept: application/json\r\nX-Url: http://a:80/\n\n bad line \n: nokey')
    ).toEqual({
      Accept: 'application/json',
      'X-Url': 'http://a:80/'
    })
  })

  it('suggests headers from other saved requests first, most used on top', () => {
    const current = make({ id: 'me', headers: 'Accept: application/json' })
    const others = [
      make({ saved: true, headers: 'X-Tenant: acme\nAuthorization: Bearer abc' }),
      make({ saved: true, headers: 'X-Tenant: acme\nAccept: application/json' }),
      make({ saved: false, headers: 'X-Draft: ignored' })
    ]
    const { used, common } = headerSuggestions([current, ...others], current)
    expect(used).toEqual(['X-Tenant: acme', 'Authorization: Bearer abc'])
    expect(common).not.toContain('Accept: application/json') // already set
    expect(common).toContain('Content-Type: application/json')
  })

  it('appends a header, or replaces one with the same name', () => {
    expect(insertHeader('', 'Accept: */*')).toBe('Accept: */*')
    expect(insertHeader('A: 1\n\n', 'B: 2')).toBe('A: 1\nB: 2')
    expect(insertHeader('accept: text/html\nB: 2', 'Accept: */*')).toBe('Accept: */*\nB: 2')
  })
})

describe('environments', () => {
  it('parses name=value lines with comments', () => {
    expect(parseVars('# local\nbaseUrl = http://x:1\n\ntoken=a=b\nnot a var')).toEqual({
      baseUrl: 'http://x:1',
      token: 'a=b'
    })
  })

  it('substitutes variables and dynamic values', () => {
    expect(substitute('{{baseUrl}}/u/{{ id }}', { baseUrl: 'http://x', id: '7' })).toBe(
      'http://x/u/7'
    )
    expect(substitute('{{$uuid}}', {})).toMatch(/^[0-9a-f-]{36}$/)
    expect(substitute('{{$timestamp}}', {})).toMatch(/^\d{10}$/)
  })

  it('fails loudly on undefined variables', () => {
    expect(() => substitute('{{baseUrl}}/x', {})).toThrow('Undefined variable {{baseUrl}}')
  })

  it('resolves every part of a request', () => {
    const r = resolveRequest(
      make({
        url: '{{base}}/x',
        headers: 'Authorization: Bearer {{token}}',
        body: '{"t":"{{token}}"}',
        variables: '{"id":"{{id}}"}'
      }),
      { base: 'http://h', token: 't0k', id: '9' }
    )
    expect([r.url, r.headers, r.body, r.variables]).toEqual([
      'http://h/x',
      'Authorization: Bearer t0k',
      '{"t":"t0k"}',
      '{"id":"9"}'
    ])
  })
})

describe('buildHttpInput', () => {
  it('passes REST bodies through and trims the URL', () => {
    const input = buildHttpInput(make({ method: 'POST', url: ' http://x/ ', body: '{"a":1}' }))
    expect(input).toMatchObject({ method: 'POST', url: 'http://x/', body: '{"a":1}' })
  })

  it('wraps GraphQL in a JSON envelope with a default content type', () => {
    const input = buildHttpInput(
      make({
        kind: 'graphql',
        method: 'POST',
        url: 'http://x/g',
        body: '{ me { id } }',
        variables: '{"n":2}'
      })
    )
    expect(input.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(input.body!)).toEqual({ query: '{ me { id } }', variables: { n: 2 } })
  })

  it('does not override an explicit content type', () => {
    const input = buildHttpInput(
      make({ kind: 'graphql', url: 'http://x', headers: 'content-type: application/graphql' })
    )
    expect(input.headers).toEqual({ 'content-type': 'application/graphql' })
  })

  it('throws a readable error on invalid GraphQL variables', () => {
    expect(() =>
      buildHttpInput(make({ kind: 'graphql', url: 'http://x', variables: '{nope' }))
    ).toThrow(/Invalid variables JSON/)
  })
})

describe('prettyBody', () => {
  it('formats JSON and leaves other types alone', () => {
    expect(prettyBody('{"a":1}', 'application/json; charset=utf-8')).toBe('{\n  "a": 1\n}')
    expect(prettyBody('{"a":1}', 'text/plain')).toBe('{"a":1}')
    expect(prettyBody('not json', 'application/json')).toBe('not json')
  })
})

describe('persistence', () => {
  it('stores only saved requests, with their folder, and restores them clean', () => {
    const storage = memoryStorage()
    const saved = make({
      id: 's',
      name: 'Login',
      saved: true,
      dirty: true,
      url: 'http://x',
      folderId: 'f1'
    })
    const draft = make({ id: 'd', saved: false })
    persist([saved, draft], storage)

    const restored = restore(storage)
    expect(restored).toHaveLength(1)
    expect(restored[0]).toMatchObject({
      id: 's',
      name: 'Login',
      url: 'http://x',
      folderId: 'f1',
      saved: true,
      dirty: false
    })
  })

  it('survives corrupt storage', () => {
    expect(restore(memoryStorage({ [KEYS.requests]: '{{' }))).toEqual([])
    expect(restore(memoryStorage({ [KEYS.requests]: '{"a":1}' }))).toEqual([])
    expect(restore(memoryStorage())).toEqual([])
    expect(restoreFolders(memoryStorage({ [KEYS.folders]: '[1, {"id":"x"}]' }))).toEqual([])
  })

  it('falls back to safe defaults for unknown fields', () => {
    const raw = JSON.stringify([{ id: 'x', name: 'N', method: 'WAT', kind: 'soap', folderId: 3 }])
    expect(restore(memoryStorage({ [KEYS.requests]: raw }))[0]).toMatchObject({
      method: 'GET',
      kind: 'rest',
      url: '',
      folderId: null
    })
  })
})
