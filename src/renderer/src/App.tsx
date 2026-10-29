// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react'
import type { HttpRequestInput, HttpResult, NetworkSettings } from '../../shared/http'
import ConfirmDialog from './components/ConfirmDialog'
import EnvEditor from './components/EnvEditor'
import ImportDialog from './components/ImportDialog'
import RequestEditor from './components/RequestEditor'
import SettingsEditor from './components/SettingsEditor'
import ResponseView from './components/ResponseView'
import type { Selection } from './components/Sidebar'
import Sidebar from './components/Sidebar'
import SuiteEditor from './components/SuiteEditor'
import type { View } from './formats'
import type { ApiRequest, Environment, Folder, RequestKind, SavedRequest } from './model'
import {
  KEYS,
  buildHttpInput,
  createEnvironment,
  createFolder,
  createRequest,
  headerSuggestions,
  parseVars,
  persist,
  resolveRequest,
  restore,
  restoreActiveEnv,
  restoreEnvironments,
  restoreFolders,
  restoreSettings,
  sidebarOrder,
  toSaved,
  writeJson
} from './model'
import type { Suite } from './suite'
import { createSuite, persistSuites, restoreSuites } from './suite'
import type { LoadMode } from './useCollections'
import { useCollections } from './useCollections'
import { useSuiteRuns } from './useSuiteRuns'
import type { ImportLine, MigrationResult, Workspace } from './workspace'
import {
  BACKUP_KEY,
  importSummary,
  isEmptyWorkspace,
  mergeById,
  parseWorkspace,
  serializeWorkspace,
  syncById
} from './workspace'

interface Notice {
  kind: 'ok' | 'error'
  text: string
  offerBackup?: boolean // after a schema upgrade: lets the user save the pre-upgrade copy
}

interface PendingImport {
  path: string
  ws: Workspace
  lines: ImportLine[]
}

const NOTICE_MS = 8000
const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path

function initialRequests(): ApiRequest[] {
  const restored = restore()
  return restored.length > 0 ? restored : [createRequest([])]
}

function App({ migration }: { migration: MigrationResult }): React.JSX.Element {
  const [initial] = useState(initialRequests)
  const [requests, setRequests] = useState<ApiRequest[]>(initial)
  const [folders, setFolders] = useState<Folder[]>(restoreFolders)
  const [suites, setSuites] = useState<Suite[]>(restoreSuites)
  const [environments, setEnvironments] = useState<Environment[]>(restoreEnvironments)
  const [activeEnvId, setActiveEnvId] = useState<string | null>(restoreActiveEnv)
  const [network, setNetwork] = useState<NetworkSettings>(restoreSettings)
  const [selected, setSelected] = useState<Selection>({ type: 'request', id: initial[0].id })
  const [view, setView] = useState<View>('form')
  const [results, setResults] = useState<Record<string, HttpResult>>({})
  const [sending, setSending] = useState<Set<string>>(new Set())
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [pendingFolder, setPendingFolder] = useState<string | null>(null)
  // Bumped whenever saved requests reach storage, so the collections folder follows.
  const [savedVersion, setSavedVersion] = useState(0)
  const [notice, setNotice] = useState<Notice | null>(() =>
    migration.status === 'migrated'
      ? {
          kind: 'ok',
          text: `Hexman upgraded your data (schema ${migration.from} → ${migration.to}) and kept a copy of the old data.`,
          offerBackup: true
        }
      : null
  )
  // Last saved version of each saved request: edits only reach disk on Save.
  const snapshots = useRef(
    new Map<string, SavedRequest>(initial.filter((r) => r.saved).map((r) => [r.id, toSaved(r)]))
  )

  // Folders, suites and environments are saved as you go.
  useEffect(() => writeJson(KEYS.folders, folders), [folders])
  useEffect(() => persistSuites(suites), [suites])
  useEffect(() => writeJson(KEYS.environments, environments), [environments])
  useEffect(() => writeJson(KEYS.activeEnv, activeEnvId), [activeEnvId])
  useEffect(() => writeJson(KEYS.settings, network), [network])

  useEffect(() => {
    if (!notice || notice.offerBackup) return
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  const activeEnv = environments.find((e) => e.id === activeEnvId) ?? null
  const vars = activeEnv ? parseVars(activeEnv.vars) : {}
  const toInput = (r: ApiRequest, extra: Record<string, string> = {}): HttpRequestInput =>
    buildHttpInput(resolveRequest(r, { ...vars, ...extra }))

  const { runs, start, stop } = useSuiteRuns((requestId, threadVars) => {
    const r = requests.find((x) => x.id === requestId)
    return r ? toInput(r, threadVars) : undefined
  }, network)

  const request =
    selected.type === 'request' ? requests.find((r) => r.id === selected.id) : undefined
  const suite = selected.type === 'suite' ? suites.find((s) => s.id === selected.id) : undefined
  const env = selected.type === 'env' ? environments.find((e) => e.id === selected.id) : undefined
  const settingsShown = selected.type === 'settings'
  const shownRequest = request ?? (suite || env || settingsShown ? undefined : requests[0])

  const firstRequest = (list: ApiRequest[] = requests): Selection => ({
    type: 'request',
    id: (sidebarOrder(list, folders)[0] ?? list[0]).id
  })

  /* ---- requests ---- */

  // Saved requests as they are on disk: the last saved version, in the folder they sit in now.
  const onDisk = (list: ApiRequest[]): ApiRequest[] =>
    list
      .filter((r) => snapshots.current.has(r.id))
      .map((r) => ({ ...r, ...snapshots.current.get(r.id)!, folderId: r.folderId }))

  const persistSaved = (list: ApiRequest[]): void => {
    persist(onDisk(list))
    setSavedVersion((v) => v + 1)
  }

  const updateRequest = (id: string, patch: Partial<ApiRequest>): void => {
    setRequests((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch, dirty: r.saved } : r)))
  }

  const moveRequest = (id: string, folderId: string | null): void => {
    const next = requests.map((r) => (r.id === id ? { ...r, folderId } : r))
    setRequests(next)
    persistSaved(next)
  }

  const saveRequest = (id: string): void => {
    const target = requests.find((r) => r.id === id)
    if (!target) return
    snapshots.current.set(id, toSaved(target))
    const next = requests.map((r) => (r.id === id ? { ...r, saved: true, dirty: false } : r))
    setRequests(next)
    persistSaved(next)
  }

  const addRequest = (kind: RequestKind): void => {
    const fresh = createRequest(requests, kind)
    setRequests([...requests, fresh])
    setSelected({ type: 'request', id: fresh.id })
  }

  const removeRequest = (id: string): void => {
    const ordered = sidebarOrder(requests, folders)
    const index = ordered.findIndex((r) => r.id === id)
    const left = requests.filter((r) => r.id !== id)
    snapshots.current.delete(id)

    if (left.length === 0) {
      const fresh = createRequest([])
      setRequests([fresh])
      setSelected({ type: 'request', id: fresh.id })
    } else {
      setRequests(left)
      if (selected.type === 'request' && selected.id === id) {
        setSelected({ type: 'request', id: (ordered[index + 1] ?? ordered[index - 1]).id })
      }
    }
    setResults((rs) => {
      const next = { ...rs }
      delete next[id]
      return next
    })
    persistSaved(left)
  }

  const send = async (r: ApiRequest): Promise<void> => {
    if (!r.url.trim() || sending.has(r.id)) return
    setSending((s) => new Set(s).add(r.id))
    let result: HttpResult
    try {
      result = await window.api.sendRequest(toInput(r), { id: r.id, network })
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    setResults((rs) => ({ ...rs, [r.id]: result }))
    setSending((s) => {
      const next = new Set(s)
      next.delete(r.id)
      return next
    })
  }

  /* ---- folders ---- */

  const addFolder = (): string => {
    const folder = createFolder(folders)
    setFolders([...folders, folder])
    return folder.id
  }

  const patchFolder = (id: string, patch: (f: Folder) => Partial<Folder>): void =>
    setFolders((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch(f) } : f)))

  const removeFolder = (id: string): void => {
    setFolders(folders.filter((f) => f.id !== id))
    const next = requests.map((r) => (r.folderId === id ? { ...r, folderId: null } : r))
    setRequests(next)
    persistSaved(next)
  }

  /* ---- suites ---- */

  const addSuite = (): void => {
    const created = createSuite(suites)
    setSuites([...suites, created])
    setSelected({ type: 'suite', id: created.id })
  }

  const updateSuite = (id: string, patch: Partial<Suite>): void =>
    setSuites((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  const removeSuite = (id: string): void => {
    stop(id)
    setSuites(suites.filter((s) => s.id !== id))
    if (selected.type === 'suite' && selected.id === id) setSelected(firstRequest())
  }

  /* ---- environments ---- */

  const addEnv = (): void => {
    const created = createEnvironment(environments)
    setEnvironments([...environments, created])
    setSelected({ type: 'env', id: created.id })
    if (!activeEnvId) setActiveEnvId(created.id)
  }

  const updateEnv = (id: string, patch: Partial<Environment>): void =>
    setEnvironments((es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)))

  const removeEnv = (id: string): void => {
    setEnvironments(environments.filter((e) => e.id !== id))
    if (activeEnvId === id) setActiveEnvId(null)
    if (selected.type === 'env' && selected.id === id) setSelected(firstRequest())
  }

  /* ---- export / import ---- */

  const saveBackup = async (): Promise<void> => {
    const result = await window.api.saveFile({
      suggestedName: 'hexman-backup.json',
      content: localStorage.getItem(BACKUP_KEY) ?? '{}'
    })
    if (result.status === 'saved') setNotice({ kind: 'ok', text: `Saved to ${result.path}` })
    if (result.status === 'error') setNotice({ kind: 'error', text: result.error })
  }

  const exportWorkspace = async (): Promise<void> => {
    const ws = { requests: onDisk(requests).map(toSaved), folders, suites, environments }
    const day = new Date().toISOString().slice(0, 10)
    const result = await window.api.saveFile({
      suggestedName: `hexman-workspace-${day}.json`,
      content: serializeWorkspace(ws)
    })
    if (result.status === 'error')
      setNotice({ kind: 'error', text: `Export failed: ${result.error}` })
    if (result.status !== 'saved') return
    const unsaved = requests.filter((r) => r.dirty || (!r.saved && r.url.trim())).length
    const skipped = unsaved ? ` Unsaved changes in ${unsaved} request(s) are not included.` : ''
    setNotice({ kind: 'ok', text: `Exported to ${result.path}.${skipped}` })
  }

  const startImport = async (): Promise<void> => {
    const result = await window.api.openFile()
    if (result.status === 'canceled') return
    if (result.status === 'error') {
      setNotice({ kind: 'error', text: `Import failed: ${result.error}` })
      return
    }
    try {
      const ws = parseWorkspace(result.content)
      if (isEmptyWorkspace(ws)) throw new Error('The file has nothing to import')
      const current = { requests: onDisk(requests).map(toSaved), folders, suites, environments }
      setPendingImport({ path: result.path, ws, lines: importSummary(current, ws) })
    } catch (err) {
      setNotice({ kind: 'error', text: `Import failed: ${(err as Error).message}` })
    }
  }

  const applyImport = ({ path, ws }: PendingImport): void => {
    setPendingImport(null)
    for (const r of ws.requests) snapshots.current.set(r.id, r)
    const next = mergeById(
      requests,
      ws.requests.map((r) => ({ ...r, saved: true, dirty: false }))
    )
    setRequests(next)
    persistSaved(next)
    setFolders(mergeById(folders, ws.folders))
    setSuites(mergeById(suites, ws.suites))
    setEnvironments(mergeById(environments, ws.environments))
    setNotice({ kind: 'ok', text: `Imported ${fileName(path)}` })
  }

  /* ---- collections folder ---- */

  const loadFromFolder = (disk: Workspace, mode: LoadMode, root: string): void => {
    const keep = mode === 'connect' // connecting adds the folder to what's here; later loads mirror it
    const fromDisk = disk.requests.map((r) => ({ ...r, saved: true, dirty: false }))
    const diskIds = new Set(fromDisk.map((r) => r.id))
    // Unsaved edits win over the file; a request edited here but gone from the folder stays.
    const edited = new Map(requests.filter((r) => r.dirty).map((r) => [r.id, r]))
    const saved = syncById(
      requests.filter((r) => r.saved),
      fromDisk,
      keep
    ).map((r) => edited.get(r.id) ?? r)
    const orphans = [...edited.values()].filter((r) => !saved.some((s) => s.id === r.id))
    const next = [...saved, ...orphans, ...requests.filter((r) => !r.saved)]

    for (const r of disk.requests) snapshots.current.set(r.id, r)
    if (!keep) {
      for (const id of [...snapshots.current.keys()]) {
        if (!diskIds.has(id) && !edited.has(id)) snapshots.current.delete(id)
      }
    }
    setRequests(next.length ? next : [createRequest([])])
    persistSaved(next)

    const collapsed = new Map(folders.map((f) => [f.id, f.collapsed]))
    setFolders(
      syncById(
        folders,
        disk.folders.map((f) => ({ ...f, collapsed: collapsed.get(f.id) ?? false })),
        keep
      )
    )
    setSuites(syncById(suites, disk.suites, keep))
    setEnvironments(syncById(environments, disk.environments, keep))
    if (mode === 'connect') {
      const count = disk.requests.length + disk.suites.length + disk.environments.length
      const loaded = count
        ? `Loaded ${count} item(s) from it.`
        : 'Your saved items are now kept there as files.'
      setNotice({ kind: 'ok', text: `Connected to ${root}. ${loaded}` })
    }
  }

  const collections = useCollections(
    () => ({ requests: onDisk(requests).map(toSaved), folders, suites, environments }),
    JSON.stringify([savedVersion, folders.map((f) => [f.id, f.name]), suites, environments]),
    loadFromFolder,
    (text) => setNotice({ kind: 'error', text })
  )

  const chooseFolder = async (): Promise<void> => {
    const choice = await window.api.chooseCollectionsFolder()
    if (choice.status === 'error') setNotice({ kind: 'error', text: choice.error })
    if (choice.status !== 'chosen') return
    if (choice.isCollections || choice.empty) await connectFolder()
    else setPendingFolder(choice.path)
  }

  const connectFolder = async (): Promise<void> => {
    setPendingFolder(null)
    if (await window.api.connectCollections()) await collections.load('connect')
  }

  const disconnectFolder = async (): Promise<void> => {
    await collections.disconnect()
    setNotice({
      kind: 'ok',
      text: 'Disconnected. Your items stay in Hexman; the files stay in the folder.'
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && shownRequest) {
        e.preventDefault()
        saveRequest(shownRequest.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const runningSuites = new Set(
    Object.entries(runs)
      .filter(([, run]) => run.running)
      .map(([id]) => id)
  )

  return (
    <div className="shell">
      <Sidebar
        requests={requests}
        folders={folders}
        suites={suites}
        environments={environments}
        activeEnvId={activeEnvId}
        selected={shownRequest ? { type: 'request', id: shownRequest.id } : selected}
        runningSuites={runningSuites}
        onSelect={setSelected}
        onNewRequest={addRequest}
        onDeleteRequest={removeRequest}
        onMoveRequest={moveRequest}
        onNewFolder={addFolder}
        onRenameFolder={(id, name) => patchFolder(id, () => ({ name }))}
        onToggleFolder={(id) => patchFolder(id, (f) => ({ collapsed: !f.collapsed }))}
        onDeleteFolder={removeFolder}
        onNewSuite={addSuite}
        onDeleteSuite={removeSuite}
        onNewEnv={addEnv}
        onDeleteEnv={removeEnv}
        onActivateEnv={setActiveEnvId}
        onImport={startImport}
        onExport={exportWorkspace}
      />
      <main className={`workspace${shownRequest ? '' : ' workspace-scroll'}`}>
        {shownRequest && (
          <>
            <RequestEditor
              key={shownRequest.id}
              request={shownRequest}
              folders={folders}
              vars={vars}
              view={view}
              sending={sending.has(shownRequest.id)}
              headerHints={headerSuggestions(requests, shownRequest)}
              onViewChange={setView}
              onChange={(patch) => updateRequest(shownRequest.id, patch)}
              onMove={(folderId) => moveRequest(shownRequest.id, folderId)}
              onSend={() => send(shownRequest)}
              onCancel={() => window.api.cancelRequest(shownRequest.id)}
              onSave={() => saveRequest(shownRequest.id)}
            />
            <ResponseView
              result={results[shownRequest.id] ?? null}
              sending={sending.has(shownRequest.id)}
            />
          </>
        )}
        {suite && (
          <SuiteEditor
            key={suite.id}
            suite={suite}
            requests={requests}
            folders={folders}
            run={runs[suite.id]}
            envName={activeEnv?.name ?? null}
            onChange={(patch) => updateSuite(suite.id, patch)}
            onRun={() => start(suite)}
            onStop={() => stop(suite.id)}
          />
        )}
        {settingsShown && (
          <SettingsEditor
            network={network}
            collectionsRoot={collections.root}
            onChange={(patch) => setNetwork((n) => ({ ...n, ...patch }))}
            onChooseFolder={chooseFolder}
            onReloadFolder={() => collections.load('rescan')}
            onDisconnectFolder={disconnectFolder}
          />
        )}
        {env && (
          <EnvEditor
            key={env.id}
            env={env}
            active={env.id === activeEnvId}
            onChange={(patch) => updateEnv(env.id, patch)}
            onActivate={() => setActiveEnvId(env.id)}
          />
        )}
      </main>
      {pendingImport && (
        <ImportDialog
          fileName={fileName(pendingImport.path)}
          lines={pendingImport.lines}
          onConfirm={() => applyImport(pendingImport)}
          onCancel={() => setPendingImport(null)}
        />
      )}
      {pendingFolder && (
        <ConfirmDialog
          title="Use this folder for collections?"
          confirmLabel="Use this folder"
          onConfirm={connectFolder}
          onCancel={() => setPendingFolder(null)}
        >
          <p className="modal-file" title={pendingFolder}>
            {pendingFolder}
          </p>
          <p className="hint">
            It already has files and isn&apos;t a Hexman collections folder yet. Hexman adds its own
            files next to them and never deletes files it didn&apos;t create. An empty folder is
            usually the better choice.
          </p>
        </ConfirmDialog>
      )}
      {notice && (
        <div className={`notice notice-${notice.kind}`} role="status">
          <span className="notice-text">{notice.text}</span>
          {notice.offerBackup && (
            <button className="mini-btn" onClick={saveBackup}>
              Save copy…
            </button>
          )}
          <button className="tile-close" aria-label="Dismiss" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  )
}

export default App
