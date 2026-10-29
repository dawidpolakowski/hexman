import { ElectronAPI } from '@electron-toolkit/preload'
import type { OpenFileResult, SaveFileInput, SaveFileResult } from '../shared/files'
import type { HttpRequestInput, HttpResult, SendOptions } from '../shared/http'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      sendRequest: (input: HttpRequestInput, options?: SendOptions) => Promise<HttpResult>
      cancelRequest: (id: string) => Promise<boolean>
      saveFile: (input: SaveFileInput) => Promise<SaveFileResult>
      openFile: () => Promise<OpenFileResult>
    }
  }
}
