// SPDX-License-Identifier: Apache-2.0
// Alternative textual representations of a request (cURL, JSON). Each format can serialize a
// request and parse text back into a patch, so the editor can switch views without losing data.
import type { ApiRequest, Method } from './model'
import { METHODS, buildHttpInput, isMethod, isRecord, parseHeaders } from './model'

export type RequestPatch = Pick<
  ApiRequest,
  'kind' | 'method' | 'url' | 'headers' | 'body' | 'variables'
> &
  Partial<Pick<ApiRequest, 'name'>>

export interface TextFormat {
  label: string
  serialize: (r: ApiRequest) => string
  parse: (text: string) => RequestPatch
}

const headerText = (pairs: [string, string][]): string =>
  pairs.map(([k, v]) => `${k}: ${v}`).join('\n')

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** A JSON body shaped like a GraphQL envelope: { query, variables? }. */
function graphqlEnvelope(body: string): { query: string; variables: string } | undefined {
  const parsed = tryJson(body)
  if (!isRecord(parsed) || typeof parsed.query !== 'string') return undefined
  if (Object.keys(parsed).some((k) => k !== 'query' && k !== 'variables')) return undefined
  const { variables } = parsed
  return {
    query: parsed.query,
    variables: variables == null ? '' : JSON.stringify(variables, null, 2)
  }
}

/* ======================= cURL ======================= */

export function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
}

export function toCurl(r: ApiRequest): string {
  const input = buildHttpInput(r)
  const head = ['curl']
  if (input.method === 'HEAD') head.push('--head')
  else if (input.method !== 'GET') head.push(`-X ${input.method}`)
  head.push(shellQuote(input.url))

  const lines = [head.join(' ')]
  const headers = Object.entries(input.headers)
  const hasBody = !!input.body && input.method !== 'GET' && input.method !== 'HEAD'
  // fetch sends string bodies as text/plain unless told otherwise; say so explicitly.
  if (hasBody && !headers.some(([k]) => k.toLowerCase() === 'content-type')) {
    headers.push(['Content-Type', 'text/plain;charset=UTF-8'])
  }
  for (const [k, v] of headers) lines.push(`-H ${shellQuote(`${k}: ${v}`)}`)
  if (hasBody) lines.push(`--data-raw ${shellQuote(input.body!)}`)
  return lines.join(' \\\n  ')
}

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '\\': '\\',
  "'": "'",
  '"': '"',
  '0': '\0',
  e: '\x1b'
}

/** Splits a POSIX-shell command line into words (quotes, escapes, $'…', line continuations). */
export function tokenize(src: string): string[] {
  const tokens: string[] = []
  let cur = ''
  let inWord = false
  let i = 0
  const end = (): void => {
    if (inWord) tokens.push(cur)
    cur = ''
    inWord = false
  }

  while (i < src.length) {
    const c = src[i]
    if (c === '\\' && src[i + 1] === '\n') {
      i += 2
    } else if (c === '\\' && src[i + 1] === '\r' && src[i + 2] === '\n') {
      i += 3
    } else if (/\s/.test(c)) {
      end()
      i++
    } else if (c === "'") {
      const close = src.indexOf("'", i + 1)
      if (close < 0) throw new Error('Unterminated single quote')
      cur += src.slice(i + 1, close)
      inWord = true
      i = close + 1
    } else if (c === '$' && src[i + 1] === "'") {
      i += 2
      inWord = true
      while (src[i] !== "'") {
        if (i >= src.length) throw new Error("Unterminated $'…' string")
        if (src[i] === '\\') {
          const e = src[i + 1]
          const hex = e === 'x' ? /^[\da-f]{1,2}/i : e === 'u' ? /^[\da-f]{4}/i : null
          const digits = hex?.exec(src.slice(i + 2))?.[0]
          if (digits) {
            cur += String.fromCharCode(parseInt(digits, 16))
            i += 2 + digits.length
          } else {
            cur += ESCAPES[e] ?? `\\${e}`
            i += 2
          }
        } else {
          cur += src[i++]
        }
      }
      i++
    } else if (c === '"') {
      i++
      inWord = true
      while (src[i] !== '"') {
        if (i >= src.length) throw new Error('Unterminated double quote')
        if (src[i] === '\\' && '"\\$`\n'.includes(src[i + 1])) {
          if (src[i + 1] !== '\n') cur += src[i + 1]
          i += 2
        } else {
          cur += src[i++]
        }
      }
      i++
    } else if (c === '\\' && i + 1 < src.length) {
      cur += src[i + 1]
      inWord = true
      i += 2
    } else {
      cur += c
      inWord = true
      i++
    }
  }
  end()
  return tokens
}

/** Undoes Windows-shell quoting: cmd's ^ escapes (Chrome "Copy as cURL (cmd)") and ` continuations. */
function normalizeShell(text: string): string {
  let out = text.replace(/`\r?\n/g, ' ')
  if (/\^"|\^\r?\n/.test(out)) out = out.replace(/\^\r?\n/g, ' ').replace(/\^(.)/g, '$1')
  return out
}

type Option =
  | 'method'
  | 'header'
  | 'data'
  | 'data-raw'
  | 'data-urlencode'
  | 'json'
  | 'user'
  | 'agent'
  | 'referer'
  | 'cookie'
  | 'url'
  | 'ignore'

const WITH_VALUE: Record<string, Option> = {
  '-X': 'method',
  '--request': 'method',
  '-H': 'header',
  '--header': 'header',
  '-d': 'data',
  '--data': 'data',
  '--data-ascii': 'data',
  '--data-binary': 'data',
  '--data-raw': 'data-raw',
  '--data-urlencode': 'data-urlencode',
  '--json': 'json',
  '-u': 'user',
  '--user': 'user',
  '-A': 'agent',
  '--user-agent': 'agent',
  '-e': 'referer',
  '--referer': 'referer',
  '-b': 'cookie',
  '--cookie': 'cookie',
  '--url': 'url',
  // valid curl options that don't change the request itself
  '-o': 'ignore',
  '--output': 'ignore',
  '-m': 'ignore',
  '--max-time': 'ignore',
  '--connect-timeout': 'ignore',
  '-x': 'ignore',
  '--proxy': 'ignore',
  '-w': 'ignore',
  '--write-out': 'ignore',
  '--retry': 'ignore',
  '--cacert': 'ignore',
  '--cert': 'ignore',
  '-E': 'ignore',
  '--key': 'ignore',
  '-c': 'ignore',
  '--cookie-jar': 'ignore',
  '--max-redirs': 'ignore',
  '--resolve': 'ignore'
}

const UNSUPPORTED: Record<string, string> = {
  '-F': 'Multipart forms (-F)',
  '--form': 'Multipart forms (--form)',
  '-T': 'File uploads (-T)',
  '--upload-file': 'File uploads (--upload-file)'
}

function base64(s: string): string {
  let bin = ''
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b)
  return btoa(bin)
}

function urlencodeArg(value: string): string {
  const eq = value.indexOf('=')
  if (eq < 0) return encodeURIComponent(value)
  const name = value.slice(0, eq)
  return `${name ? `${name}=` : ''}${encodeURIComponent(value.slice(eq + 1))}`
}

export interface ParsedCurl {
  method: Method
  url: string
  headers: [string, string][]
  body: string
}

export function parseCurl(text: string): ParsedCurl {
  const tokens = tokenize(normalizeShell(text))
  if (!tokens.length || !/(^|[\\/])curl(\.exe)?$/i.test(tokens[0])) {
    throw new Error('A cURL command must start with "curl"')
  }

  let method: string | undefined
  let url: string | undefined
  let get = false
  let head = false
  let json = false
  const headers: [string, string][] = []
  const data: string[] = []
  const setUrl = (value: string): void => {
    if (url !== undefined) throw new Error('Only one URL per request is supported')
    url = value
  }

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]
    let option: Option | undefined = WITH_VALUE[token]
    let value: string | undefined
    // short options can carry their value: -XPOST, -H'Accept: */*'
    if (!option && /^-[A-Za-z]./.test(token) && WITH_VALUE[token.slice(0, 2)]) {
      option = WITH_VALUE[token.slice(0, 2)]
      value = token.slice(2)
    }

    if (option) {
      if (value === undefined) {
        if (i + 1 >= tokens.length) throw new Error(`Missing value for ${token}`)
        value = tokens[++i]
      }
      if (/^(data|data-urlencode|json)$/.test(option) && value.startsWith('@')) {
        throw new Error('Reading data from files (@file) is not supported')
      }
      switch (option) {
        case 'method':
          method = value.toUpperCase()
          break
        case 'header': {
          const colon = value.indexOf(':')
          if (colon <= 0) throw new Error(`Invalid header "${value}"`)
          const v = value.slice(colon + 1).trim()
          if (v) headers.push([value.slice(0, colon).trim(), v])
          break
        }
        case 'data':
        case 'data-raw':
          data.push(value)
          break
        case 'data-urlencode':
          data.push(urlencodeArg(value))
          break
        case 'json':
          json = true
          data.push(value)
          break
        case 'user':
          headers.push(['Authorization', `Basic ${base64(value)}`])
          break
        case 'agent':
          headers.push(['User-Agent', value])
          break
        case 'referer':
          headers.push(['Referer', value])
          break
        case 'cookie':
          if (value.includes('=')) headers.push(['Cookie', value])
          break
        case 'url':
          setUrl(value)
          break
      }
      continue
    }

    if (UNSUPPORTED[token]) throw new Error(`${UNSUPPORTED[token]} are not supported yet`)
    if (token === '-G' || token === '--get') get = true
    else if (token === '-I' || token === '--head') head = true
    else if (!(token.startsWith('-') && token.length > 1)) setUrl(token) // other flags: -s, -L, --compressed…
  }

  if (!url) throw new Error('Missing URL')
  // curl assumes http:// without a scheme; a leading {{variable}} supplies its own
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(url) && !url.startsWith('{{')) url = `http://${url}`

  const has = (name: string): boolean => headers.some(([k]) => k.toLowerCase() === name)
  let body = ''
  if (data.length && get) {
    url += (url.includes('?') ? '&' : '?') + data.join('&')
  } else if (data.length) {
    body = data.join(json ? '' : '&')
    if (json) {
      if (!has('content-type')) headers.push(['Content-Type', 'application/json'])
      if (!has('accept')) headers.push(['Accept', 'application/json'])
    } else if (!has('content-type')) {
      headers.push(['Content-Type', 'application/x-www-form-urlencoded'])
    }
  }

  const finalMethod = method ?? (head ? 'HEAD' : body ? 'POST' : 'GET')
  if (!isMethod(finalMethod)) throw new Error(`Unsupported method ${finalMethod}`)
  return { method: finalMethod, url, headers, body }
}

export function curlToPatch(text: string): RequestPatch {
  const { method, url, headers, body } = parseCurl(text)
  const gql = graphqlEnvelope(body)
  if (gql) {
    const rest = headers.filter(
      ([k, v]) => !(k.toLowerCase() === 'content-type' && v === 'application/json')
    )
    return {
      kind: 'graphql',
      method,
      url,
      headers: headerText(rest),
      body: gql.query,
      variables: gql.variables
    }
  }
  return { kind: 'rest', method, url, headers: headerText(headers), body, variables: '' }
}

export const looksLikeCurl = (text: string): boolean => /^\s*curl(\.exe)?\s/i.test(text)

/* ======================= JSON ======================= */

const DOC_KEYS = ['name', 'method', 'url', 'headers', 'body', 'query', 'variables']

export function toJsonDoc(r: ApiRequest): string {
  const doc: Record<string, unknown> = {
    name: r.name,
    method: r.method,
    url: r.url,
    headers: parseHeaders(r.headers)
  }
  if (r.kind === 'graphql') {
    doc.query = r.body
    if (r.variables.trim()) doc.variables = tryJson(r.variables) ?? r.variables
  } else if (r.body) {
    const parsed = tryJson(r.body)
    doc.body = typeof parsed === 'object' && parsed !== null ? parsed : r.body
  }
  return JSON.stringify(doc, null, 2)
}

const asText = (v: unknown): string =>
  v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 2)

export function jsonDocToPatch(text: string): RequestPatch {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch (err) {
    throw new Error(`Invalid JSON: ${(err as Error).message}`)
  }
  if (!isRecord(doc)) throw new Error('Expected a JSON object')
  for (const key of Object.keys(doc)) {
    if (!DOC_KEYS.includes(key)) throw new Error(`Unknown field "${key}"`)
  }

  const isGql = doc.query !== undefined
  if (isGql && doc.body !== undefined) {
    throw new Error('Use either "body" (REST) or "query" (GraphQL), not both')
  }
  if (!isGql && doc.variables !== undefined) throw new Error('"variables" needs a GraphQL "query"')
  if (isGql && typeof doc.query !== 'string') throw new Error('"query" must be a string')

  const method = typeof doc.method === 'string' ? doc.method.toUpperCase() : doc.method
  const resolved = method ?? (isGql ? 'POST' : 'GET')
  if (!isMethod(resolved)) throw new Error(`"method" must be one of ${METHODS.join(', ')}`)

  if (doc.url !== undefined && typeof doc.url !== 'string')
    throw new Error('"url" must be a string')
  if (doc.name !== undefined && (typeof doc.name !== 'string' || !doc.name.trim())) {
    throw new Error('"name" must be a non-empty string')
  }

  const headers = doc.headers ?? {}
  if (!isRecord(headers)) throw new Error('"headers" must be an object of "Name": "value"')
  for (const [k, v] of Object.entries(headers)) {
    if (!['string', 'number', 'boolean'].includes(typeof v)) {
      throw new Error(`Header "${k}" must have a text value`)
    }
  }

  const patch: RequestPatch = {
    kind: isGql ? 'graphql' : 'rest',
    method: resolved,
    url: (doc.url as string | undefined) ?? '',
    headers: headerText(Object.entries(headers).map(([k, v]) => [k, String(v)])),
    body: isGql ? (doc.query as string) : asText(doc.body),
    variables: isGql ? asText(doc.variables) : ''
  }
  if (doc.name !== undefined) patch.name = doc.name as string
  return patch
}

/* ======================= registry ======================= */

export type View = 'form' | 'curl' | 'json'

export const FORMATS: Record<Exclude<View, 'form'>, TextFormat> = {
  curl: { label: 'cURL', serialize: toCurl, parse: curlToPatch },
  json: { label: 'JSON', serialize: toJsonDoc, parse: jsonDocToPatch }
}
