// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react'
import type { HttpRequestInput, HttpResult } from '../../shared/http'
import EnvEditor from './components/EnvEditor'
import RequestEditor from './components/RequestEditor'
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
  sidebarOrder,
  toSaved,
  writeJson
} from './model'
import type { Suite } from './suite'
import { createSuite, persistSuites, restoreSuites } from './suite'
import { useSuiteRuns } from './useSuiteRuns'

function initialRequests(): ApiRequest[] {
  const restored = restore()
  return restored.length > 0 ? restored : [createRequest([])]
}

function App(): React.JSX.Element {
  const [initial] = useState(initialRequests)
  const [requests, setRequests] = useState<ApiRequest[]>(initial)
  const [folders, setFolders] = useState<Folder[]>(restoreFolders)
  const [suites, setSuites] = useState<Suite[]>(restoreSuites)
  const [environments, setEnvironments] = useState<Environment[]>(restoreEnvironments)
  const [activeEnvId, setActiveEnvId] = useState<string | null>(restoreActiveEnv)
  const [selected, setSelected] = useState<Selection>({ type: 'request', id: initial[0].id })
  const [view, setView] = useState<View>('form')
  const [results, setResults] = useState<Record<string, HttpResult>>({})
  const [sending, setSending] = useState<Set<string>>(new Set())
  // Last saved version of each saved request: edits only reach disk on Save.
  const snapshots = useRef(
    new Map<string, SavedRequest>(initial.filter((r) => r.saved).map((r) => [r.id, toSaved(r)]))
  )

  // Folders, suites and environments are saved as you go.
  useEffect(() => writeJson(KEYS.folders, folders), [folders])
  useEffect(() => persistSuites(suites), [suites])
  useEffect(() => writeJson(KEYS.environments, environments), [environments])
  useEffect(() => writeJson(KEYS.activeEnv, activeEnvId), [activeEnvId])

  const activeEnv = environments.find((e) => e.id === activeEnvId) ?? null
  const vars = activeEnv ? parseVars(activeEnv.vars) : {}
  const toInput = (r: ApiRequest): HttpRequestInput => buildHttpInput(resolveRequest(r, vars))

  const { runs, start, stop } = useSuiteRuns((requestId) => {
    const r = requests.find((x) => x.id === requestId)
    return r ? toInput(r) : undefined
  })

  const request =
    selected.type === 'request' ? requests.find((r) => r.id === selected.id) : undefined
  const suite = selected.type === 'suite' ? suites.find((s) => s.id === selected.id) : undefined
  const env = selected.type === 'env' ? environments.find((e) => e.id === selected.id) : undefined
  const shownRequest = request ?? (suite || env ? undefined : requests[0])

  const firstRequest = (list: ApiRequest[] = requests): Selection => ({
    type: 'request',
    id: (sidebarOrder(list, folders)[0] ?? list[0]).id
  })

  /* ---- requests ---- */

  const persistSaved = (list: ApiRequest[]): void => {
    persist(
      list
        .filter((r) => snapshots.current.has(r.id))
        .map((r) => ({ ...r, ...snapshots.current.get(r.id)!, folderId: r.folderId }))
    )
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
      result = await window.api.sendRequest(toInput(r))
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
    </div>
  )
}

export default App
