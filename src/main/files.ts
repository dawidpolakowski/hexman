// SPDX-License-Identifier: Apache-2.0
// Workspace export/import: native save/open dialogs plus guarded file reads and writes.
import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import { readFile, stat, writeFile } from 'node:fs/promises'
import type { OpenFileResult, SaveFileInput, SaveFileResult } from '../shared/files'

export const MAX_FILE_BYTES = 50 * 1024 * 1024
const JSON_FILTERS = [{ name: 'Hexman workspace', extensions: ['json'] }]

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function isSaveFileInput(v: unknown): v is SaveFileInput {
  if (typeof v !== 'object' || v === null) return false
  const { suggestedName, content } = v as Record<string, unknown>
  return typeof suggestedName === 'string' && typeof content === 'string'
}

export async function writeTextFile(path: string, content: string): Promise<SaveFileResult> {
  if (Buffer.byteLength(content) > MAX_FILE_BYTES) {
    return { status: 'error', error: 'The workspace is larger than 50 MB' }
  }
  try {
    await writeFile(path, content, 'utf8')
    return { status: 'saved', path }
  } catch (err) {
    return { status: 'error', error: message(err) }
  }
}

export async function readTextFile(path: string): Promise<OpenFileResult> {
  try {
    if ((await stat(path)).size > MAX_FILE_BYTES) {
      return { status: 'error', error: 'The file is larger than 50 MB' }
    }
    return { status: 'opened', path, content: await readFile(path, 'utf8') }
  } catch (err) {
    return { status: 'error', error: message(err) }
  }
}

const parentWindow = (event: IpcMainInvokeEvent): BrowserWindow | undefined =>
  BrowserWindow.fromWebContents(event.sender) ?? undefined

export async function saveFileDialog(
  event: IpcMainInvokeEvent,
  input: unknown
): Promise<SaveFileResult> {
  if (!isSaveFileInput(input)) return { status: 'error', error: 'Invalid save request' }
  const options = { defaultPath: input.suggestedName, filters: JSON_FILTERS }
  const win = parentWindow(event)
  const { canceled, filePath } = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options)
  if (canceled || !filePath) return { status: 'canceled' }
  return writeTextFile(filePath, input.content)
}

export async function openFileDialog(event: IpcMainInvokeEvent): Promise<OpenFileResult> {
  const options = { filters: JSON_FILTERS, properties: ['openFile' as const] }
  const win = parentWindow(event)
  const { canceled, filePaths } = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  if (canceled || !filePaths[0]) return { status: 'canceled' }
  return readTextFile(filePaths[0])
}
