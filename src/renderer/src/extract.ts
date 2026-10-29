// SPDX-License-Identifier: Apache-2.0
// Extractors pull a value out of a response into a variable, like JMeter's post-processors:
// a JSON path, a response header or the first group of a regular expression.
import type { HttpResponseOutput } from '../../shared/http'

export type ExtractSource = 'json' | 'header' | 'regex'

export const EXTRACT_SOURCES: { value: ExtractSource; label: string; placeholder: string }[] = [
  { value: 'json', label: 'JSON', placeholder: '$.data.token' },
  { value: 'header', label: 'Header', placeholder: 'Location' },
  { value: 'regex', label: 'Regex', placeholder: 'id="(\\d+)"' }
]

export interface Extractor {
  id: string
  variable: string // used later as {{variable}}
  source: ExtractSource
  expr: string
}

export const VARIABLE_NAME = /^[\w.-]+$/

export function createExtractor(): Extractor {
  return { id: crypto.randomUUID(), variable: '', source: 'json', expr: '' }
}

export const isExtractSource = (v: unknown): v is ExtractSource =>
  v === 'json' || v === 'header' || v === 'regex'

/* ---- JSON path: $.a.b[0]['c d'][-1] ---- */

const SEGMENT = /^(?:\.([A-Za-z_$][\w$-]*)|\[(-?\d+)\]|\[\s*'([^']*)'\s*\]|\[\s*"([^"]*)"\s*\])/

export function parsePath(path: string): (string | number)[] {
  let rest = path.trim()
  if (rest.startsWith('$')) rest = rest.slice(1)
  else if (/^[A-Za-z_]/.test(rest)) rest = `.${rest}` // "data.token" works too
  const segments: (string | number)[] = []
  while (rest) {
    const m = SEGMENT.exec(rest)
    if (!m) throw new Error(`Invalid JSON path "${path}"`)
    segments.push(m[1] ?? (m[2] !== undefined ? Number(m[2]) : (m[3] ?? m[4])))
    rest = rest.slice(m[0].length)
  }
  return segments
}

/** The value at the path, or undefined when any segment is missing. */
export function readPath(value: unknown, path: string): unknown {
  let current = value
  for (const segment of parsePath(path)) {
    if (Array.isArray(current)) {
      if (segment === 'length') current = current.length
      else if (typeof segment === 'number') current = current.at(segment)
      else return undefined
    } else if (typeof current === 'object' && current !== null) {
      const key = String(segment)
      if (!Object.hasOwn(current, key)) return undefined
      current = (current as Record<string, unknown>)[key]
    } else {
      return undefined
    }
  }
  return current
}

const asText = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v))

/* ---- extraction ---- */

/** The extracted text; throws a readable error when there is nothing to extract. */
export function extractValue(ex: Extractor, response: HttpResponseOutput): string {
  const expr = ex.expr.trim()
  if (!expr) throw new Error('no expression')
  switch (ex.source) {
    case 'json': {
      let doc: unknown
      try {
        doc = JSON.parse(response.body)
      } catch {
        throw new Error('response is not JSON')
      }
      const value = readPath(doc, expr)
      if (value === undefined) throw new Error(`${expr} not found`)
      return asText(value)
    }
    case 'header': {
      const name = expr.toLowerCase()
      const header = response.headers.find(([k]) => k.toLowerCase() === name)
      if (!header) throw new Error(`no ${expr} header`)
      return header[1]
    }
    case 'regex': {
      let re: RegExp
      try {
        re = new RegExp(expr)
      } catch {
        throw new Error(`invalid regex /${expr}/`)
      }
      const m = re.exec(response.body)
      if (!m) throw new Error(`/${expr}/ did not match`)
      return m[1] ?? m[0]
    }
  }
}

/** Runs every extractor that names a variable; failures read "Extract token: $.token not found". */
export function runExtractors(
  extractors: Extractor[],
  response: HttpResponseOutput
): { values: [string, string][]; failures: string[] } {
  const values: [string, string][] = []
  const failures: string[] = []
  for (const ex of extractors) {
    const variable = ex.variable.trim()
    if (!variable) continue
    try {
      if (!VARIABLE_NAME.test(variable)) throw new Error('invalid variable name')
      values.push([variable, extractValue(ex, response)])
    } catch (err) {
      failures.push(`Extract ${variable}: ${(err as Error).message}`)
    }
  }
  return { values, failures }
}
