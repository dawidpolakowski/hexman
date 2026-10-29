// SPDX-License-Identifier: Apache-2.0
import type { HttpRequestInput } from '../../shared/http'

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
export type Method = (typeof METHODS)[number]
export type RequestKind = 'rest' | 'graphql'

export const isMethod = (m: unknown): m is Method => (METHODS as readonly unknown[]).includes(m)

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export interface ApiRequest {
  id: string
  name: string
  kind: RequestKind
  method: Method
  url: string
  headers: string // one "Key: Value" per line
  body: string // raw body, or the GraphQL query
  variables: string // GraphQL variables (JSON)
  folderId: string | null
  saved: boolean
  dirty: boolean // saved request edited since the last save
}

export type SavedRequest = Omit<ApiRequest, 'saved' | 'dirty'>

export interface Folder {
  id: string
  name: string
  collapsed: boolean
}

export interface Environment {
  id: string
  name: string
  vars: string // one "name=value" per line, used as {{name}}
}

/** "Request 3", "Folder 2"…: one past the highest number already used with that prefix. */
export function nextName(items: { name: string }[], prefix = 'Request'): string {
  const re = new RegExp(`^${prefix} (\\d+)$`)
  let max = 0
  for (const { name } of items) {
    const m = re.exec(name)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${prefix} ${max + 1}`
}

export function createRequest(
  existing: ApiRequest[],
  kind: RequestKind = 'rest',
  folderId: string | null = null
): ApiRequest {
  return {
    id: crypto.randomUUID(),
    name: nextName(existing),
    kind,
    method: kind === 'graphql' ? 'POST' : 'GET',
    url: '',
    headers: '',
    body: '',
    variables: '',
    folderId,
    saved: false,
    dirty: false
  }
}

export function createFolder(existing: Folder[]): Folder {
  return { id: crypto.randomUUID(), name: nextName(existing, 'Folder'), collapsed: false }
}

export function createEnvironment(existing: Environment[]): Environment {
  return { id: crypto.randomUUID(), name: nextName(existing, 'Environment'), vars: '' }
}

/* ---- sidebar ---- */

export interface SidebarLayout {
  folders: { folder: Folder; requests: ApiRequest[] }[]
  root: ApiRequest[]
  drafts: ApiRequest[]
}

/** Saved requests live in their folder (or the root); unsaved drafts always sit at the bottom. */
export function sidebarLayout(requests: ApiRequest[], folders: Folder[]): SidebarLayout {
  const known = new Set(folders.map((f) => f.id))
  const saved = requests.filter((r) => r.saved)
  return {
    folders: folders.map((folder) => ({
      folder,
      requests: saved.filter((r) => r.folderId === folder.id)
    })),
    root: saved.filter((r) => !r.folderId || !known.has(r.folderId)),
    drafts: requests.filter((r) => !r.saved)
  }
}

export function sidebarOrder(requests: ApiRequest[], folders: Folder[]): ApiRequest[] {
  const layout = sidebarLayout(requests, folders)
  return [...layout.folders.flatMap((f) => f.requests), ...layout.root, ...layout.drafts]
}

/* ---- headers ---- */

export function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    const key = line.slice(0, i).trim()
    if (key) out[key] = line.slice(i + 1).trim()
  }
  return out
}

export const COMMON_HEADERS = [
  'Accept: application/json',
  'Content-Type: application/json',
  'Authorization: Bearer {{token}}',
  'Authorization: Basic <base64 user:password>',
  'Cache-Control: no-cache',
  'Accept-Encoding: gzip, deflate, br',
  'Accept-Language: en-US,en;q=0.9',
  'User-Agent: Hexman',
  'X-Request-ID: {{$uuid}}',
  'X-Correlation-ID: {{$uuid}}',
  'If-None-Match: "<etag>"',
  'Content-Type: application/x-www-form-urlencoded',
  'Origin: https://example.com',
  'Cookie: name=value'
]

const headerKey = (line: string): string => line.slice(0, line.indexOf(':')).trim().toLowerCase()

/** Header lines from other saved requests (most used first) and common ones, minus those already set. */
export function headerSuggestions(
  requests: ApiRequest[],
  current: ApiRequest
): { used: string[]; common: string[] } {
  const present = new Set(
    Object.entries(parseHeaders(current.headers)).map(([k, v]) => `${k}: ${v}`)
  )
  const counts = new Map<string, number>()
  for (const r of requests) {
    if (r.id === current.id || !r.saved) continue
    for (const [k, v] of Object.entries(parseHeaders(r.headers))) {
      const line = `${k}: ${v}`
      if (!present.has(line)) counts.set(line, (counts.get(line) ?? 0) + 1)
    }
  }
  const used = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([line]) => line)
  const common = COMMON_HEADERS.filter((line) => !present.has(line) && !counts.has(line))
  return { used, common }
}

/** Adds a header line, replacing an existing header of the same name. */
export function insertHeader(text: string, line: string): string {
  const key = headerKey(line)
  const lines = text.split(/\r?\n/)
  const at = lines.findIndex((l) => l.includes(':') && headerKey(l) === key)
  if (at >= 0) {
    lines[at] = line
    return lines.join('\n')
  }
  const trimmed = text.replace(/\s+$/, '')
  return trimmed ? `${trimmed}\n${line}` : line
}

/* ---- environments ---- */

export function parseVars(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return out
}

const DYNAMIC: Record<string, () => string> = {
  $uuid: () => crypto.randomUUID(),
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $isoTimestamp: () => new Date().toISOString(),
  $randomInt: () => String(Math.floor(Math.random() * 1000))
}

export const DYNAMIC_VARS = Object.keys(DYNAMIC)

/** Replaces {{name}} with environment values and {{$uuid}}-style dynamic values. */
export function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([$\w.-]+)\s*\}\}/g, (_match, name: string) => {
    if (Object.hasOwn(DYNAMIC, name)) return DYNAMIC[name]()
    if (Object.hasOwn(vars, name)) return vars[name]
    throw new Error(`Undefined variable {{${name}}}`)
  })
}

export function resolveRequest(r: ApiRequest, vars: Record<string, string>): ApiRequest {
  const s = (text: string): string => substitute(text, vars)
  return { ...r, url: s(r.url), headers: s(r.headers), body: s(r.body), variables: s(r.variables) }
}

/* ---- sending ---- */

export function buildHttpInput(r: ApiRequest): HttpRequestInput {
  const headers = parseHeaders(r.headers)
  const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')

  if (r.kind === 'graphql') {
    let variables: unknown
    if (r.variables.trim()) {
      try {
        variables = JSON.parse(r.variables)
      } catch (err) {
        throw new Error(`Invalid variables JSON: ${(err as Error).message}`)
      }
    }
    if (!hasContentType) headers['Content-Type'] = 'application/json'
    return {
      method: r.method,
      url: r.url.trim(),
      headers,
      body: JSON.stringify({ query: r.body, variables })
    }
  }

  return { method: r.method, url: r.url.trim(), headers, body: r.body || undefined }
}

export function prettyBody(body: string, contentType: string | undefined): string {
  if (!contentType?.includes('json')) return body
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

/* ---- persistence: saved requests, folders, suites and environments survive a restart ---- */

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export const KEYS = {
  requests: 'hexman.requests.v1',
  folders: 'hexman.folders.v1',
  suites: 'hexman.suites.v1',
  environments: 'hexman.environments.v1',
  activeEnv: 'hexman.activeEnvironment.v1'
}

export function writeJson(key: string, value: unknown, storage: StorageLike = localStorage): void {
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable: keep working in memory */
  }
}

export function readJson(key: string, storage: StorageLike = localStorage): unknown {
  try {
    const raw = storage.getItem(key)
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

/** Records that at least carry a string id and name; anything else is dropped. */
export function asRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (r): r is Record<string, unknown> =>
      isRecord(r) && typeof r.id === 'string' && typeof r.name === 'string'
  )
}

export function readRecords(
  key: string,
  storage: StorageLike = localStorage
): Record<string, unknown>[] {
  return asRecords(readJson(key, storage))
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function toSaved(r: ApiRequest): SavedRequest {
  const { id, name, kind, method, url, headers, body, variables, folderId } = r
  return { id, name, kind, method, url, headers, body, variables, folderId }
}

export function persist(requests: ApiRequest[], storage: StorageLike = localStorage): void {
  writeJson(KEYS.requests, requests.filter((r) => r.saved).map(toSaved), storage)
}

/** A stored or imported request record, repaired into a clean saved request. */
export function normalizeRequest(r: Record<string, unknown>): ApiRequest {
  return {
    id: r.id as string,
    name: r.name as string,
    kind: r.kind === 'graphql' ? 'graphql' : 'rest',
    method: isMethod(r.method) ? r.method : 'GET',
    url: str(r.url),
    headers: str(r.headers),
    body: str(r.body),
    variables: str(r.variables),
    folderId: typeof r.folderId === 'string' ? r.folderId : null,
    saved: true,
    dirty: false
  }
}

export const normalizeFolder = (f: Record<string, unknown>): Folder => ({
  id: f.id as string,
  name: f.name as string,
  collapsed: f.collapsed === true
})

export const normalizeEnvironment = (e: Record<string, unknown>): Environment => ({
  id: e.id as string,
  name: e.name as string,
  vars: str(e.vars)
})

export function restore(storage: StorageLike = localStorage): ApiRequest[] {
  return readRecords(KEYS.requests, storage).map(normalizeRequest)
}

export function restoreFolders(storage: StorageLike = localStorage): Folder[] {
  return readRecords(KEYS.folders, storage).map(normalizeFolder)
}

export function restoreEnvironments(storage: StorageLike = localStorage): Environment[] {
  return readRecords(KEYS.environments, storage).map(normalizeEnvironment)
}

export function restoreActiveEnv(storage: StorageLike = localStorage): string | null {
  const id = readJson(KEYS.activeEnv, storage)
  return typeof id === 'string' ? id : null
}
