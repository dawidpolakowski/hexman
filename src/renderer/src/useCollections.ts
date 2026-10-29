// SPDX-License-Identifier: Apache-2.0
// Keeps the app and the connected collections folder in step: the folder is loaded on start and
// whenever the window regains focus (so a collection copied in shows up), and saved changes are
// written back shortly after they happen.
import { useEffect, useRef, useState } from 'react'
import type { DiskWorkspace } from '../../shared/collections'
import type { Workspace } from './workspace'
import { workspaceFromDisk } from './workspace'

const WRITE_DELAY_MS = 300

export type LoadMode = 'connect' | 'rescan'

/** What goes to disk: folders without their collapsed state, which is per machine. */
const toDisk = (ws: Workspace): DiskWorkspace => ({
  requests: ws.requests as unknown as DiskWorkspace['requests'],
  folders: ws.folders.map(({ id, name }) => ({ id, name })),
  suites: ws.suites as unknown as DiskWorkspace['suites'],
  environments: ws.environments as unknown as DiskWorkspace['environments']
})

export function useCollections(
  /** The saved workspace as it is now; read when writing, never during render. */
  getWorkspace: () => Workspace,
  /** Changes whenever the saved workspace does. */
  changeKey: string,
  onLoaded: (ws: Workspace, mode: LoadMode, root: string) => void,
  onProblem: (text: string) => void
): {
  root: string | null
  load: (mode: LoadMode) => Promise<void>
  disconnect: () => Promise<void>
} {
  const [root, setRoot] = useState<string | null>(null)
  const ready = useRef(false) // a folder is connected and has been read
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef({ getWorkspace, onLoaded, onProblem })
  useEffect(() => {
    latest.current = { getWorkspace, onLoaded, onProblem }
  })

  const write = async (): Promise<void> => {
    clearTimeout(timer.current)
    timer.current = undefined
    if (!ready.current) return
    const result = await window.api.writeCollections(toDisk(latest.current.getWorkspace()))
    if (result.status === 'error') {
      latest.current.onProblem(`Could not write to the collections folder: ${result.error}`)
    }
  }

  const load = async (mode: LoadMode): Promise<void> => {
    // Flush pending edits first, so reading the folder never undoes them.
    if (timer.current) await write()
    const result = await window.api.readCollections()
    if (result.status === 'disconnected') {
      ready.current = false
      setRoot(null)
      return
    }
    if (result.status === 'error') {
      latest.current.onProblem(`Could not read the collections folder: ${result.error}`)
      return
    }
    ready.current = true
    setRoot(result.root)
    latest.current.onLoaded(workspaceFromDisk(result), mode, result.root)
    if (result.problems.length) {
      const shown = result.problems.slice(0, 3).join('; ')
      const more = result.problems.length > 3 ? ` and ${result.problems.length - 3} more` : ''
      latest.current.onProblem(`Skipped files in the collections folder: ${shown}${more}`)
    }
  }

  const disconnect = async (): Promise<void> => {
    if (timer.current) await write()
    ready.current = false
    await window.api.disconnectCollections()
    setRoot(null)
  }

  const loadRef = useRef(load)
  const writeRef = useRef(write)
  useEffect(() => {
    loadRef.current = load
    writeRef.current = write
  })

  // On start: load the connected folder, if there is one.
  useEffect(() => {
    void loadRef.current('rescan')
  }, [])

  // Write shortly after the saved workspace changes.
  useEffect(() => {
    if (!ready.current) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void writeRef.current(), WRITE_DELAY_MS)
  }, [changeKey])

  // Files changed outside Hexman (a copied collection, a git pull) appear on focus;
  // pending edits are written before the window goes away.
  useEffect(() => {
    const onFocus = (): void => {
      if (ready.current) void loadRef.current('rescan')
    }
    const onUnload = (): void => {
      if (timer.current) void writeRef.current()
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [])

  return { root, load, disconnect }
}
