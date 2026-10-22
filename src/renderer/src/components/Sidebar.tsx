// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react'
import type { ApiRequest, Environment, Folder, RequestKind } from '../model'
import { sidebarLayout } from '../model'
import type { Suite } from '../suite'
import MethodBadge from './MethodBadge'

export interface Selection {
  type: 'request' | 'suite' | 'env'
  id: string
}

interface Props {
  requests: ApiRequest[]
  folders: Folder[]
  suites: Suite[]
  environments: Environment[]
  activeEnvId: string | null
  selected: Selection
  runningSuites: Set<string>
  onSelect: (selection: Selection) => void
  onNewRequest: (kind: RequestKind) => void
  onDeleteRequest: (id: string) => void
  onMoveRequest: (id: string, folderId: string | null) => void
  onNewFolder: () => string
  onRenameFolder: (id: string, name: string) => void
  onToggleFolder: (id: string) => void
  onDeleteFolder: (id: string) => void
  onNewSuite: () => void
  onDeleteSuite: (id: string) => void
  onNewEnv: () => void
  onDeleteEnv: (id: string) => void
  onActivateEnv: (id: string | null) => void
}

const DRAG_TYPE = 'application/x-hexman-request'
const ROOT = '__root__'

function Sidebar(p: Props): React.JSX.Element {
  const layout = sidebarLayout(p.requests, p.folders)
  const folderNames = new Map(p.folders.map((f) => [f.id, f.name]))
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const isSelected = (type: Selection['type'], id: string): boolean =>
    p.selected.type === type && p.selected.id === id

  const selectable = (selection: Selection): React.HTMLAttributes<HTMLElement> => ({
    role: 'button',
    tabIndex: 0,
    onClick: () => p.onSelect(selection),
    onKeyDown: (e) => {
      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        p.onSelect(selection)
      }
    }
  })

  const dropZone = (folderId: string | null): React.HTMLAttributes<HTMLElement> => ({
    onDragOver: (e) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropTarget(folderId ?? ROOT)
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null)
    },
    onDrop: (e) => {
      e.preventDefault()
      setDropTarget(null)
      const id = e.dataTransfer.getData(DRAG_TYPE)
      if (id) p.onMoveRequest(id, folderId)
    }
  })

  const deleteButton = (label: string, onDelete: () => void): React.JSX.Element => (
    <button
      className="tile-close"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        onDelete()
      }}
    >
      ×
    </button>
  )

  const requestTile = (r: ApiRequest): React.JSX.Element => (
    <div
      key={r.id}
      {...selectable({ type: 'request', id: r.id })}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, r.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      className={`tile${r.saved ? ' tile-saved' : ''}${isSelected('request', r.id) ? ' tile-active' : ''}`}
    >
      <MethodBadge request={r} />
      <span className="tile-name">{r.name}</span>
      {!r.saved && r.folderId && folderNames.has(r.folderId) && (
        <span className="tile-folder">{folderNames.get(r.folderId)}</span>
      )}
      {r.dirty && <span className="dot" title="Unsaved changes" />}
      {deleteButton(`Delete ${r.name}`, () => p.onDeleteRequest(r.id))}
    </div>
  )

  const finishRename = (folder: Folder, value: string): void => {
    setRenaming(null)
    const name = value.trim()
    if (name && name !== folder.name) p.onRenameFolder(folder.id, name)
  }

  return (
    <aside className="sidebar">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true">
          ⬡
        </span>
        <div className="brand-text">
          <span className="brand-name">HEXMAN</span>
          <span className="brand-tagline">From testers to testers</span>
        </div>
      </header>

      <label className="env-picker">
        <span>ENV</span>
        <select
          value={p.activeEnvId ?? ''}
          aria-label="Active environment"
          onChange={(e) => p.onActivateEnv(e.target.value || null)}
        >
          <option value="">No environment</option>
          {p.environments.map((env) => (
            <option key={env.id} value={env.id}>
              {env.name}
            </option>
          ))}
        </select>
      </label>

      <div className="new-row">
        <button className="btn btn-primary" onClick={() => p.onNewRequest('rest')}>
          + REST
        </button>
        <button className="btn btn-violet" onClick={() => p.onNewRequest('graphql')}>
          + GraphQL
        </button>
      </div>

      <div className="sidebar-scroll">
        <div className="section-head">
          <span>Requests</span>
          <button
            className="mini-btn"
            onClick={() => setRenaming(p.onNewFolder())}
            title="New folder"
          >
            + Folder
          </button>
        </div>

        <nav className="tiles" aria-label="Requests">
          {layout.folders.map(({ folder, requests }) => (
            <section
              key={folder.id}
              className={`folder${dropTarget === folder.id ? ' drop' : ''}`}
              {...dropZone(folder.id)}
            >
              <div
                className="folder-head"
                role="button"
                tabIndex={0}
                aria-expanded={!folder.collapsed}
                onClick={() => p.onToggleFolder(folder.id)}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && e.key === 'Enter') p.onToggleFolder(folder.id)
                }}
              >
                <span className={`chevron${folder.collapsed ? '' : ' open'}`} aria-hidden="true">
                  ▸
                </span>
                {renaming === folder.id ? (
                  <input
                    className="folder-input"
                    autoFocus
                    defaultValue={folder.name}
                    aria-label="Folder name"
                    spellCheck={false}
                    onFocus={(e) => e.currentTarget.select()}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') {
                        e.currentTarget.value = folder.name
                        e.currentTarget.blur()
                      }
                    }}
                    onBlur={(e) => finishRename(folder, e.currentTarget.value)}
                  />
                ) : (
                  <span className="folder-name">{folder.name}</span>
                )}
                <span className="count">{requests.length}</span>
                <button
                  className="tile-edit"
                  aria-label={`Rename ${folder.name}`}
                  title="Rename"
                  onClick={(e) => {
                    e.stopPropagation()
                    setRenaming(folder.id)
                  }}
                >
                  ✎
                </button>
                {deleteButton(`Delete folder ${folder.name}`, () => p.onDeleteFolder(folder.id))}
              </div>
              {!folder.collapsed && (
                <div className="folder-items">
                  {requests.map(requestTile)}
                  {requests.length === 0 && <div className="empty-hint">Drag requests here</div>}
                </div>
              )}
            </section>
          ))}

          <div className={`root-zone${dropTarget === ROOT ? ' drop' : ''}`} {...dropZone(null)}>
            {layout.root.map(requestTile)}
          </div>

          {layout.drafts.length > 0 && (
            <>
              <div className="divider">
                <span>Unsaved</span>
              </div>
              {layout.drafts.map(requestTile)}
            </>
          )}
        </nav>

        <div className="section-head">
          <span>Suites</span>
          <button className="mini-btn" onClick={p.onNewSuite} title="New suite">
            + Suite
          </button>
        </div>
        <div className="tiles" aria-label="Suites">
          {p.suites.map((s) => (
            <div
              key={s.id}
              {...selectable({ type: 'suite', id: s.id })}
              className={`tile tile-saved${isSelected('suite', s.id) ? ' tile-active' : ''}`}
            >
              <span className={`method method-suite${p.runningSuites.has(s.id) ? ' running' : ''}`}>
                SUITE
              </span>
              <span className="tile-name">{s.name}</span>
              <span className="count">{s.steps.length}</span>
              {deleteButton(`Delete suite ${s.name}`, () => p.onDeleteSuite(s.id))}
            </div>
          ))}
          {p.suites.length === 0 && (
            <div className="empty-hint">
              Chain saved requests with assertions, threads and loops.
            </div>
          )}
        </div>

        <div className="section-head">
          <span>Environments</span>
          <button className="mini-btn" onClick={p.onNewEnv} title="New environment">
            + Env
          </button>
        </div>
        <div className="tiles" aria-label="Environments">
          {p.environments.map((env) => (
            <div
              key={env.id}
              {...selectable({ type: 'env', id: env.id })}
              className={`tile tile-saved${isSelected('env', env.id) ? ' tile-active' : ''}`}
            >
              <span className="method method-env">ENV</span>
              <span className="tile-name">{env.name}</span>
              {p.activeEnvId === env.id && <span className="active-pill">active</span>}
              {deleteButton(`Delete environment ${env.name}`, () => p.onDeleteEnv(env.id))}
            </div>
          ))}
          {p.environments.length === 0 && (
            <div className="empty-hint">Variables like {'{{baseUrl}}'} per environment.</div>
          )}
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
