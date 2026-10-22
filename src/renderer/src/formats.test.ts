// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { curlToPatch, jsonDocToPatch, parseCurl, toCurl, toJsonDoc, tokenize } from './formats'
import type { ApiRequest } from './model'
import { createRequest } from './model'

const make = (over: Partial<ApiRequest> = {}): ApiRequest => ({ ...createRequest([]), ...over })

describe('tokenize', () => {
  it('handles quotes, escapes and line continuations', () => {
    expect(tokenize(`curl 'a b' "c \\"d\\"" e\\ f \\\n  -H x`)).toEqual([
      'curl',
      'a b',
      'c "d"',
      'e f',
      '-H',
      'x'
    ])
  })

  it("decodes $'…' strings (Chrome's Copy as cURL)", () => {
    expect(tokenize(`curl $'it\\'s\\n\\u00e9\\x41'`)).toEqual(['curl', "it's\néA"])
  })

  it('reports unterminated quotes', () => {
    expect(() => tokenize(`curl 'oops`)).toThrow('Unterminated single quote')
  })
})

describe('parseCurl', () => {
  it('reads method, URL, headers and body', () => {
    expect(
      parseCurl(`curl -X PUT 'https://api.test/u/1' -H 'Accept: */*' --data-raw '{"a":1}'`)
    ).toEqual({
      method: 'PUT',
      url: 'https://api.test/u/1',
      headers: [
        ['Accept', '*/*'],
        ['Content-Type', 'application/x-www-form-urlencoded']
      ],
      body: '{"a":1}'
    })
  })

  it('defaults to POST with data, GET without, HEAD with -I', () => {
    expect(parseCurl('curl http://x -d a=1').method).toBe('POST')
    expect(parseCurl('curl http://x').method).toBe('GET')
    expect(parseCurl('curl -I http://x').method).toBe('HEAD')
  })

  it('supports attached short options, --json, -u, -A and -G', () => {
    const json = parseCurl(`curl -XPATCH http://x --json '{"a":1}'`)
    expect(json.method).toBe('PATCH')
    expect(json.headers).toEqual([
      ['Content-Type', 'application/json'],
      ['Accept', 'application/json']
    ])
    expect(parseCurl('curl -u user:pass -A bot http://x').headers).toEqual([
      ['Authorization', 'Basic dXNlcjpwYXNz'],
      ['User-Agent', 'bot']
    ])
    expect(parseCurl('curl -G http://x/s -d q=a -d page=2')).toMatchObject({
      method: 'GET',
      url: 'http://x/s?q=a&page=2',
      body: ''
    })
  })

  it('adds http:// when the scheme is missing and ignores unrelated flags', () => {
    expect(parseCurl('curl -sSL --compressed -m 5 example.com/x').url).toBe('http://example.com/x')
  })

  it('reads Windows cmd copies (^ escapes)', () => {
    const cmd =
      'curl ^"https://x.test/a^" ^\n  -H ^"accept: */*^" ^\n  --data-raw ^"^{^\\^"a^\\^":1^}^"'
    expect(parseCurl(cmd)).toMatchObject({
      url: 'https://x.test/a',
      headers: [['accept', '*/*'], expect.anything()],
      body: '{"a":1}'
    })
  })

  it('explains what it cannot do', () => {
    expect(() => parseCurl('wget http://x')).toThrow('must start with "curl"')
    expect(() => parseCurl('curl -H "A: b"')).toThrow('Missing URL')
    expect(() => parseCurl('curl -F f=@a.txt http://x')).toThrow('not supported yet')
    expect(() => parseCurl('curl -d @body.json http://x')).toThrow('@file')
    expect(() => parseCurl('curl http://a http://b')).toThrow('Only one URL')
  })
})

describe('cURL round trip', () => {
  it('keeps a REST request intact', () => {
    const r = make({
      method: 'POST',
      url: 'http://localhost:4010/api/users?x=1&y=2',
      headers: "Content-Type: application/json\nX-Note: it's fine",
      body: '{\n  "name": "Grace"\n}'
    })
    const text = toCurl(r)
    expect(text.split('\n')[0]).toBe("curl -X POST 'http://localhost:4010/api/users?x=1&y=2' \\")
    expect(curlToPatch(text)).toMatchObject({
      kind: 'rest',
      method: 'POST',
      url: r.url,
      headers: r.headers,
      body: r.body
    })
  })

  it('keeps {{variables}} as written', () => {
    const r = make({ url: '{{baseUrl}}/users', headers: 'Authorization: Bearer {{token}}' })
    expect(curlToPatch(toCurl(r))).toMatchObject({ url: '{{baseUrl}}/users' })
    expect(toCurl(r)).toContain("-H 'Authorization: Bearer {{token}}'")
  })

  it('recognises a GraphQL envelope and turns it back into query + variables', () => {
    const r = make({
      kind: 'graphql',
      method: 'POST',
      url: 'http://x/graphql',
      body: 'query { me { id } }',
      variables: '{\n  "n": 2\n}'
    })
    expect(curlToPatch(toCurl(r))).toMatchObject({
      kind: 'graphql',
      headers: '',
      body: r.body,
      variables: r.variables
    })
  })

  it('makes fetch’s implicit text/plain content type explicit', () => {
    expect(toCurl(make({ method: 'POST', url: 'http://x', body: 'hi' }))).toContain(
      "-H 'Content-Type: text/plain;charset=UTF-8'"
    )
  })
})

describe('JSON document', () => {
  it('embeds JSON bodies as objects and round-trips', () => {
    const r = make({
      name: 'Create',
      method: 'POST',
      url: 'http://x',
      headers: 'Content-Type: application/json',
      body: '{"a":[1,2]}'
    })
    const doc = JSON.parse(toJsonDoc(r))
    expect(doc).toEqual({
      name: 'Create',
      method: 'POST',
      url: 'http://x',
      headers: { 'Content-Type': 'application/json' },
      body: { a: [1, 2] }
    })
    expect(jsonDocToPatch(toJsonDoc(r))).toMatchObject({
      name: 'Create',
      method: 'POST',
      headers: 'Content-Type: application/json',
      body: '{\n  "a": [\n    1,\n    2\n  ]\n}'
    })
  })

  it('keeps string bodies (including JSON string literals) verbatim', () => {
    const r = make({ method: 'POST', url: 'http://x', body: '"quoted"' })
    expect(jsonDocToPatch(toJsonDoc(r)).body).toBe('"quoted"')
  })

  it('switches to GraphQL when a query is present', () => {
    expect(jsonDocToPatch('{"url":"http://x","query":"{ a }","variables":{"v":1}}')).toMatchObject({
      kind: 'graphql',
      method: 'POST',
      body: '{ a }',
      variables: '{\n  "v": 1\n}'
    })
  })

  it('validates the document', () => {
    expect(() => jsonDocToPatch('{')).toThrow('Invalid JSON')
    expect(() => jsonDocToPatch('[]')).toThrow('Expected a JSON object')
    expect(() => jsonDocToPatch('{"header":{}}')).toThrow('Unknown field "header"')
    expect(() => jsonDocToPatch('{"method":"FETCH"}')).toThrow('"method" must be one of')
    expect(() => jsonDocToPatch('{"headers":{"A":{}}}')).toThrow('Header "A"')
    expect(() => jsonDocToPatch('{"body":"x","query":"y"}')).toThrow('not both')
  })

  it('leaves the name alone when the document omits it', () => {
    expect(jsonDocToPatch('{"url":"http://x"}')).not.toHaveProperty('name')
  })
})
