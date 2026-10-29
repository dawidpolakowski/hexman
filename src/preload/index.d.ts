import { ElectronAPI } from '@electron-toolkit/preload'
import type { OpenFileResult, SaveFileInput, SaveFileResult } from '../shared/files'
import type { HttpRequestInput, HttpResult } from '../shared/http'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      sendRequest: (input: HttpRequestInput) => Promise<HttpResult>
      saveFile: (input: SaveFileInput) => Promise<SaveFileResult>
      openFile: () => Promise<OpenFileResult>
    }
  }
}
