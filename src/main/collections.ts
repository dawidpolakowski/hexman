// SPDX-License-Identifier: Apache-2.0
// The collections folder mirrors the saved workspace as plain JSON files, so a collection is
// shared by copying its directory (or by keeping the whole folder in git):
//
//   <root>/hexman-collections.json            marks the folder as a Hexman collections folder
//   <root>/<Request>.request.json             requests outside any folder
//   <root>/<Folder>/collection.json           a sidebar folder ("collection") and its id
//   <root>/<Folder>/<Request>.request.json
//   <root>/_suites/<Suite>.suite.json
//   <root>/_environments/<Environment>.env.json
//
// Hexman only ever deletes files it read or wrote itself: anything else in the folder
// (a collection copied in a moment ago, a broken file) is left alone.
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DiskRecord, DiskWorkspace } from '../shared/collections'

export const MARKER = 'hexman-collections.json'
const COLLECTION = 'collection.json'
const SUITES = '_suites'
const ENVIRONMENTS = '_environments'
const EXT = { request: '.request.json', suite: '.suite.json', environment: '.env.json' }
const MAX_FILE_BYTES = 5 * 1024 * 1024

/* ---- names ---- */

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i

/** A file or directory name that is valid on Windows, macOS and Linux. */
export function safeName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80)
  if (!cleaned) return 'Untitled'
  return WINDOWS_RESERVED.test(cleaned) ? `_${cleaned}` : cleaned
}

/** Hands out names unique within one directory, case-insensitively: "Login", "Login (2)"… */
function uniqueNames(reserved: string[] = []): (name: string) => string {
  const used = new Set(reserved.map((n) => n.toLowerCase()))
  return (name) => {
    let candidate = name
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${name} (${n})`
    used.add(candidate.toLowerCase())
    return candidate
  }
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/* ---- layout ---- */

/** Every file the workspace should have, by path relative to the root (with "/" separators). */
export function layout(ws: DiskWorkspace): Map<string, string> {
  const files = new Map<string, string>([
    [MARKER, json({ format: 'hexman-collections', version: 1 })]
  ])

  const rootNames = uniqueNames([SUITES, ENVIRONMENTS])
  const folderDirs = new Map<string, string>()
  for (const f of ws.folders) {
    const id = str(f.id)
    if (!id || folderDirs.has(id)) continue
    const dir = rootNames(safeName(str(f.name)))
    folderDirs.set(id, dir)
    files.set(`${dir}/${COLLECTION}`, json({ id, name: str(f.name) }))
  }

  const namesIn = new Map<string, (name: string) => string>()
  const place = (dir: string, name: string, ext: string): string => {
    if (!namesIn.has(dir)) namesIn.set(dir, uniqueNames())
    const file = `${namesIn.get(dir)!(safeName(name))}${ext}`
    return dir ? `${dir}/${file}` : file
  }

  for (const r of ws.requests) {
    const dir = folderDirs.get(str(r.folderId)) ?? ''
    const { id, name, kind, method, url, headers, body, variables } = r
    const content = { id, name, kind, method, url, headers, body, variables }
    files.set(place(dir, str(name), EXT.request), json(content))
  }
  for (const s of ws.suites) files.set(place(SUITES, str(s.name), EXT.suite), json(s))
  for (const e of ws.environments) {
    files.set(place(ENVIRONMENTS, str(e.name), EXT.environment), json(e))
  }
  return files
}

/* ---- reading ---- */

export interface ReadOutcome extends DiskWorkspace {
  problems: string[]
  known: Set<string> // files read successfully: the only ones a later write may delete
}

async function entries(dir: string): Promise<{ name: string; isDir: boolean }[]> {
  try {
    const list = await readdir(dir, { withFileTypes: true })
    return list
      .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

export async function isCollectionsFolder(root: string): Promise<boolean> {
  try {
    return (await stat(join(root, MARKER))).isFile()
  } catch {
    return false
  }
}

export async function isEmptyFolder(root: string): Promise<boolean> {
  return (await entries(root)).length === 0
}

export async function readCollections(root: string): Promise<ReadOutcome> {
  const out: ReadOutcome = {
    requests: [],
    folders: [],
    suites: [],
    environments: [],
    problems: [],
    known: new Set()
  }
  const seen = { requests: new Set<string>(), folders: new Set<string>(), other: new Set<string>() }

  const readRecord = async (rel: string): Promise<DiskRecord | undefined> => {
    try {
      const path = join(root, rel)
      if ((await stat(path)).size > MAX_FILE_BYTES) throw new Error('larger than 5 MB')
      const value: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('not a JSON object')
      }
      out.known.add(rel)
      return value as DiskRecord
    } catch (err) {
      out.problems.push(`${rel}: ${(err as Error).message}`)
      return undefined
    }
  }

  // Ids come from the file; a missing one, or a duplicate (a copied collection), gets an id
  // derived from the path, which the next write stores in the file. The name follows the file
  // or directory name, so renaming it in the file manager renames the item.
  const identify = (rec: DiskRecord, rel: string, ids: Set<string>, baseName: string): void => {
    let id = str(rec.id)
    if (!id || ids.has(id)) id = id ? `${id}~${rel}` : `file:${rel}`
    ids.add(id)
    rec.id = id
    const name = str(rec.name)
    rec.name = name && safeName(name) === baseName ? name : baseName
  }

  const readItems = async (
    dir: string,
    ext: string,
    list: DiskRecord[],
    ids: Set<string>,
    extra: DiskRecord = {}
  ): Promise<void> => {
    const files = (await entries(join(root, dir)))
      .filter((e) => !e.isDir && e.name.endsWith(ext))
      .map((e) => ({ ...e, base: e.name.slice(0, -ext.length) }))
      .sort((a, b) => a.base.localeCompare(b.base)) // "Login" before "Login (2)"
    for (const e of files) {
      const rel = dir ? `${dir}/${e.name}` : e.name
      const rec = await readRecord(rel)
      if (!rec) continue
      identify(rec, rel, ids, e.base)
      list.push({ ...rec, ...extra })
    }
  }

  await readItems('', EXT.request, out.requests, seen.requests, { folderId: null })
  for (const e of await entries(root)) {
    if (!e.isDir || e.name.startsWith('.')) continue
    if (e.name === SUITES) await readItems(SUITES, EXT.suite, out.suites, seen.other)
    else if (e.name === ENVIRONMENTS) {
      await readItems(ENVIRONMENTS, EXT.environment, out.environments, seen.other)
    } else if (!e.name.startsWith('_')) {
      // Any other directory is a collection, even without collection.json (named after it).
      const hasMeta = (await entries(join(root, e.name))).some((f) => f.name === COLLECTION)
      const meta = hasMeta ? ((await readRecord(`${e.name}/${COLLECTION}`)) ?? {}) : {}
      const folder: DiskRecord = { ...meta }
      if (!str(folder.id)) folder.id = `dir:${e.name}`
      identify(folder, e.name, seen.folders, e.name)
      out.folders.push({ id: folder.id, name: folder.name })
      await readItems(e.name, EXT.request, out.requests, seen.requests, { folderId: folder.id })
    }
  }
  if (await isCollectionsFolder(root)) out.known.add(MARKER)
  return out
}

/* ---- writing ---- */

/**
 * Writes the files whose content changed and deletes the known files the workspace no longer
 * has (renamed, moved or deleted items). Returns the new set of known files.
 */
export async function writeCollections(
  root: string,
  ws: DiskWorkspace,
  known: Set<string>
): Promise<{ written: number; deleted: number; known: Set<string> }> {
  const files = layout(ws)
  let written = 0
  let deleted = 0
  for (const [rel, content] of files) {
    const path = join(root, rel)
    const current = await readFile(path, 'utf8').catch(() => null)
    if (current === content) continue
    await mkdir(dirname(path), { recursive: true })
    // Write then rename, so nobody (git, an editor, the next scan) sees a half-written file.
    const tmp = `${path}.${process.pid}.tmp`
    await writeFile(tmp, content, 'utf8')
    await rename(tmp, path)
    written++
  }
  for (const rel of known) {
    if (files.has(rel)) continue
    await rm(join(root, rel), { force: true })
    deleted++
    // Drop a collection directory once it is empty; rmdir refuses non-empty ones.
    if (rel.includes('/')) await rmdir(join(root, dirname(rel))).catch(() => {})
  }
  return { written, deleted, known: new Set(files.keys()) }
}
