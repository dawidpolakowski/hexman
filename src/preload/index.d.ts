import { ElectronAPI } from '@electron-toolkit/preload'
import type { HttpRequestInput, HttpResult } from '../shared/http'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      sendRequest: (input: HttpRequestInput) => Promise<HttpResult>
    }
  }
}
