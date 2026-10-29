import { app, BrowserWindow, ipcMain, session, type IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import type { SendOptions } from '../shared/http'
import { openFileDialog, saveFileDialog } from './files'
import { cancelRequest, sendRequest } from './http'
import { denyPermissions, fromApp, hardenWindow, isHttpRequestInput } from './security'

const devUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1360,
    height: 840,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: '#010409',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  hardenWindow(mainWindow, devUrl)

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Registers an IPC handler that ignores calls from anything but the app's own page. */
function handle(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromApp(event, devUrl)) throw new Error(`Rejected ${channel} from an unknown sender`)
    return listener(event, ...args)
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.hexman.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  denyPermissions(session.defaultSession)

  handle('http:send', (_event, input, options) =>
    isHttpRequestInput(input)
      ? sendRequest(
          input,
          (typeof options === 'object' && options !== null ? options : {}) as SendOptions
        )
      : { ok: false, error: 'Invalid request' }
  )
  handle('http:cancel', (_event, id) => typeof id === 'string' && cancelRequest(id))
  handle('file:save', saveFileDialog)
  handle('file:open', (event) => openFileDialog(event))

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
