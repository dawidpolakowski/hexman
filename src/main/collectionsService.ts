// SPDX-License-Identifier: Apache-2.0
// Which collections folder is connected, and the IPC around it. The path lives in the main
// process (userData/collections.json): the renderer can't point reads or writes elsewhere.
import { app, BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  CollectionsChoice,
  CollectionsReadResult,
  CollectionsWriteResult,
  DiskWorkspace
} from '../shared/collections'
import {
  isCollectionsFolder,
  isEmptyFolder,
  readCollections,
  writeCollections
} from './collections'

const configPath = (): string => join(app.getPath('userData'), 'collections.json')

let root: string | null | undefined // undefined until the config is loaded
let known = new Set<string>()
let pendingChoice: string | null = null

// Reads and writes run one at a time, in the order they were asked for.
let queue: Promise<unknown> = Promise.resolve()
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => {})
  return run
}

/** Resolves once every queued read and write has finished. */
export const collectionsIdle = (): Promise<unknown> => queue

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

async function currentRoot(): Promise<string | null> {
  if (root === undefined) {
    try {
      const config = JSON.parse(await readFile(configPath(), 'utf8'))
      root = typeof config.root === 'string' ? config.root : null
    } catch {
      root = null
    }
  }
  return root ?? null
}

async function setRoot(next: string | null): Promise<void> {
  root = next
  known = new Set()
  await writeFile(configPath(), JSON.stringify({ root: next }), 'utf8')
}

export const getCollectionsRoot = (): Promise<string | null> => serialized(currentRoot)

export async function chooseCollectionsFolder(
  event: IpcMainInvokeEvent
): Promise<CollectionsChoice> {
  const options = {
    title: 'Choose a collections folder',
    properties: ['openDirectory' as const, 'createDirectory' as const]
  }
  const win = BrowserWindow.fromWebContents(event.sender)
  const { canceled, filePaths } = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  if (canceled || !filePaths[0]) return { status: 'canceled' }
  pendingChoice = filePaths[0]
  try {
    return {
      status: 'chosen',
      path: pendingChoice,
      isCollections: await isCollectionsFolder(pendingChoice),
      empty: await isEmptyFolder(pendingChoice)
    }
  } catch (err) {
    return { status: 'error', error: message(err) }
  }
}

/** Connects the folder picked in the last dialog. */
export const connectCollections = (): Promise<string | null> =>
  serialized(async () => {
    if (!pendingChoice) return null
    await setRoot(pendingChoice)
    pendingChoice = null
    return root ?? null
  })

export const disconnectCollections = (): Promise<void> => serialized(() => setRoot(null))

export const readConnected = (): Promise<CollectionsReadResult> =>
  serialized(async () => {
    const dir = await currentRoot()
    if (!dir) return { status: 'disconnected' }
    try {
      const { known: read, ...ws } = await readCollections(dir)
      known = read
      return { status: 'read', root: dir, ...ws }
    } catch (err) {
      return { status: 'error', error: message(err) }
    }
  })

function isDiskWorkspace(v: unknown): v is DiskWorkspace {
  if (typeof v !== 'object' || v === null) return false
  const ws = v as Record<string, unknown>
  return ['requests', 'folders', 'suites', 'environments'].every(
    (k) =>
      Array.isArray(ws[k]) &&
      (ws[k] as unknown[]).every((item) => typeof item === 'object' && item !== null)
  )
}

export const writeConnected = (ws: unknown): Promise<CollectionsWriteResult> =>
  serialized(async () => {
    const dir = await currentRoot()
    if (!dir) return { status: 'disconnected' }
    if (!isDiskWorkspace(ws)) return { status: 'error', error: 'Invalid workspace' }
    try {
      const result = await writeCollections(dir, ws, known)
      known = result.known
      return { status: 'written', written: result.written, deleted: result.deleted }
    } catch (err) {
      return { status: 'error', error: message(err) }
    }
  })
