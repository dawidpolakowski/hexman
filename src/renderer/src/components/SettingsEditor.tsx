// SPDX-License-Identifier: Apache-2.0
import type { NetworkSettings } from '../../../shared/http'
import { DEFAULT_NETWORK, TIMEOUT_LIMITS } from '../../../shared/http'
import NumberField from './NumberField'

interface Props {
  network: NetworkSettings
  collectionsRoot: string | null
  onChange: (patch: Partial<NetworkSettings>) => void
  onChooseFolder: () => void
  onReloadFolder: () => void
  onDisconnectFolder: () => void
}

function SettingsEditor(p: Props): React.JSX.Element {
  const { network, onChange } = p
  return (
    <section className="editor settings-editor">
      <div className="title-row">
        <span className="method method-env">SET</span>
        <h1 className="settings-title">Settings</h1>
      </div>

      <div className="field">
        <span className="field-label">Collections folder</span>
        <div className="folder-row">
          <span
            className={`folder-path${p.collectionsRoot ? '' : ' none'}`}
            title={p.collectionsRoot ?? undefined}
          >
            {p.collectionsRoot ?? 'Not connected: everything is kept inside Hexman'}
          </span>
          <button className="btn" onClick={p.onChooseFolder}>
            {p.collectionsRoot ? 'Change…' : 'Choose folder…'}
          </button>
          {p.collectionsRoot && (
            <>
              <button className="btn" onClick={p.onReloadFolder}>
                Reload
              </button>
              <button className="btn" onClick={p.onDisconnectFolder}>
                Disconnect
              </button>
            </>
          )}
        </div>
        <p className="hint">
          Hexman keeps saved requests, suites and environments in this folder as plain JSON files:
          one directory per sidebar folder (collection), one <code>.request.json</code> file per
          request, plus <code>_suites</code> and <code>_environments</code>. To share a collection,
          copy its directory into someone else&apos;s folder, or keep the whole folder in git.
          Changes made outside Hexman show up when you come back to the window.
        </p>
      </div>

      <div className="field">
        <span className="field-label">Network</span>
        <div className="settings-row">
          <NumberField
            label="Timeout (seconds)"
            value={Math.round(network.timeoutMs / 1000)}
            min={TIMEOUT_LIMITS.min / 1000}
            max={TIMEOUT_LIMITS.max / 1000}
            onChange={(s) => onChange({ timeoutMs: s * 1000 })}
          />
        </div>
        <p className="hint">
          Applies to every request and suite sample. Default {DEFAULT_NETWORK.timeoutMs / 1000} s.
        </p>
      </div>

      <div className="field">
        <label className="check-row">
          <input
            type="checkbox"
            checked={network.verifyTls}
            onChange={(e) => onChange({ verifyTls: e.target.checked })}
          />
          <span>Verify TLS certificates</span>
        </label>
        <p className="hint">
          Turn this off for test servers with self-signed or expired certificates (like{' '}
          <code>curl -k</code>). Leave it on for anything else.
        </p>
        {!network.verifyTls && (
          <p className="settings-warn">TLS verification is off: Hexman accepts any certificate.</p>
        )}
      </div>

      <div className="field">
        <label className="text-field">
          <span className="field-label">Proxy</span>
          <input
            className="settings-input"
            value={network.proxy}
            placeholder="http://proxy.company.local:8080"
            spellCheck={false}
            aria-label="Proxy URL"
            onChange={(e) => onChange({ proxy: e.target.value })}
          />
        </label>
        <p className="hint">
          Empty: Hexman uses <code>HTTPS_PROXY</code>, <code>HTTP_PROXY</code> and{' '}
          <code>NO_PROXY</code> from the environment if they are set, and connects directly
          otherwise. Credentials go in the URL: <code>http://user:pass@host:port</code>.
        </p>
      </div>
    </section>
  )
}

export default SettingsEditor
