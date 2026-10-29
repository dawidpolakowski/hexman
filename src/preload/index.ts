// SPDX-License-Identifier: Apache-2.0
// Runs sandboxed: only `electron` may be imported. The renderer gets this narrow API and nothing else.
import { contextBridge, ipcRenderer } from 'electron'
import type {
  CollectionsChoice,
  CollectionsReadResult,
  CollectionsWriteResult,
  DiskWorkspace
} from '../shared/collections'
import type { OpenFileResult, SaveFileInput, SaveFileResult } from '../shared/files'
import type { HttpRequestInput, HttpResult, SendOptions } from '../shared/http'

const api = {
  sendRequest: (input: HttpRequestInput, options?: SendOptions): Promise<HttpResult> =>
    ipcRenderer.invoke('http:send', input, options),
  cancelRequest: (id: string): Promise<boolean> => ipcRenderer.invoke('http:cancel', id),
  saveFile: (input: SaveFileInput): Promise<SaveFileResult> =>
    ipcRenderer.invoke('file:save', input),
  openFile: (): Promise<OpenFileResult> => ipcRenderer.invoke('file:open'),
  getCollectionsRoot: (): Promise<string | null> => ipcRenderer.invoke('collections:get'),
  chooseCollectionsFolder: (): Promise<CollectionsChoice> =>
    ipcRenderer.invoke('collections:choose'),
  connectCollections: (): Promise<string | null> => ipcRenderer.invoke('collections:connect'),
  disconnectCollections: (): Promise<void> => ipcRenderer.invoke('collections:disconnect'),
  readCollections: (): Promise<CollectionsReadResult> => ipcRenderer.invoke('collections:read'),
  writeCollections: (ws: DiskWorkspace): Promise<CollectionsWriteResult> =>
    ipcRenderer.invoke('collections:write', ws)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
