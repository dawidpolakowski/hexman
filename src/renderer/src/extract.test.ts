// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import type { HttpResponseOutput } from '../../shared/http'
import type { Extractor } from './extract'
import { extractValue, parsePath, readPath, runExtractors } from './extract'

const response = (body: unknown, headers: [string, string][] = []): HttpResponseOutput => ({
  status: 200,
  statusText: 'OK',
  durationMs: 5,
  sizeBytes: 10,
  headers,
  body: typeof body === 'string' ? body : JSON.stringify(body),
  truncated: false
})

const ex = (source: Extractor['source'], expr: string, variable = 'v'): Extractor => ({
  id: 'x',
  variable,
  source,
  expr
})

describe('JSON paths', () => {
  const doc = { data: { token: 'abc', 'user id': 7, items: [{ id: 1 }, { id: 2 }] } }

  it('parses dots, indexes and quoted keys', () => {
    expect(parsePath(`$.data.items[0]['user id']["x"]`)).toEqual([
      'data',
      'items',
      0,
      'user id',
      'x'
    ])
    expect(parsePath('data.token')).toEqual(['data', 'token'])
    expect(() => parsePath('$..data')).toThrow('Invalid JSON path')
  })

  it('reads nested values, negative indexes and array length', () => {
    expect(readPath(doc, '$.data.token')).toBe('abc')
    expect(readPath(doc, `$.data['user id']`)).toBe(7)
    expect(readPath(doc, '$.data.items[-1].id')).toBe(2)
    expect(readPath(doc, '$.data.items.length')).toBe(2)
    expect(readPath(doc, '$.data.missing')).toBeUndefined()
    expect(readPath(doc, '$.data.token.deeper')).toBeUndefined()
    expect(readPath(doc, '$')).toBe(doc)
  })
})

describe('extractors', () => {
  it('extracts JSON values as text', () => {
    const r = response({ token: 'abc', n: 3, ok: true, obj: { a: 1 } })
    expect(extractValue(ex('json', '$.token'), r)).toBe('abc')
    expect(extractValue(ex('json', '$.n'), r)).toBe('3')
    expect(extractValue(ex('json', '$.obj'), r)).toBe('{"a":1}')
    expect(() => extractValue(ex('json', '$.nope'), r)).toThrow('$.nope not found')
    expect(() => extractValue(ex('json', '$.a'), response('<html>'))).toThrow('not JSON')
  })

  it('extracts headers case-insensitively', () => {
    const r = response('', [['location', '/users/43']])
    expect(extractValue(ex('header', 'Location'), r)).toBe('/users/43')
    expect(() => extractValue(ex('header', 'ETag'), r)).toThrow('no ETag header')
  })

  it('extracts the first regex group, or the whole match', () => {
    const r = response('<input name="csrf" value="k9f2">')
    expect(extractValue(ex('regex', 'value="(\\w+)"'), r)).toBe('k9f2')
    expect(extractValue(ex('regex', 'csrf'), r)).toBe('csrf')
    expect(() => extractValue(ex('regex', '(unclosed'), r)).toThrow('invalid regex')
    expect(() => extractValue(ex('regex', 'nomatch'), r)).toThrow('did not match')
  })

  it('collects values and readable failures, skipping unnamed extractors', () => {
    const r = response({ token: 'abc' })
    expect(
      runExtractors(
        [
          ex('json', '$.token', 'token'),
          ex('json', '$.id', 'userId'),
          ex('json', '$.token', ''),
          ex('json', '$.token', 'bad name!')
        ],
        r
      )
    ).toEqual({
      values: [['token', 'abc']],
      failures: ['Extract userId: $.id not found', 'Extract bad name!: invalid variable name']
    })
  })
})
