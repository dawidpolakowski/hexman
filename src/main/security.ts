// SPDX-License-Identifier: Apache-2.0
// Keeps the renderer on the app's own page and IPC limited to it.
import { shell, type BrowserWindow, type IpcMainInvokeEvent, type Session } from 'electron'
import type { HttpRequestInput } from '../shared/http'

/** The app's own page: the dev server in development, the bundled file otherwise. */
export function isAppUrl(url: string, devUrl: string | undefined): boolean {
  try {
    const target = new URL(url)
    if (devUrl) return target.origin === new URL(devUrl).origin
    return target.protocol === 'file:'
  } catch {
    return false
  }
}

/** Links meant for the outside world open in the default browser; anything else is dropped. */
export const isExternalLink = (url: string): boolean => /^(https?:|mailto:)/i.test(url)

export function hardenWindow(win: BrowserWindow, devUrl: string | undefined): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalLink(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, devUrl)) event.preventDefault()
  })
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
}

/** Hexman never needs the camera, notifications or any other browser permission. */
export function denyPermissions(session: Session): void {
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
}

/** IPC is only answered for the app's own top-level page. */
export function fromApp(event: IpcMainInvokeEvent, devUrl: string | undefined): boolean {
  const frame = event.senderFrame
  return !!frame && frame === event.sender.mainFrame && isAppUrl(frame.url, devUrl)
}

export function isHttpRequestInput(v: unknown): v is HttpRequestInput {
  if (typeof v !== 'object' || v === null) return false
  const { method, url, headers, body } = v as Record<string, unknown>
  return (
    typeof method === 'string' &&
    typeof url === 'string' &&
    typeof headers === 'object' &&
    headers !== null &&
    Object.values(headers).every((h) => typeof h === 'string') &&
    (body === undefined || typeof body === 'string')
  )
}
