// SPDX-License-Identifier: Apache-2.0

export interface HttpRequestInput {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

export interface HttpResponseOutput {
  status: number
  statusText: string
  durationMs: number
  sizeBytes: number
  headers: [string, string][]
  body: string
  truncated: boolean
}

export type HttpResult = { ok: true; response: HttpResponseOutput } | { ok: false; error: string }

/** How requests reach the network; edited in Settings and sent along with every request. */
export interface NetworkSettings {
  timeoutMs: number
  verifyTls: boolean // false accepts self-signed and otherwise invalid certificates
  proxy: string // empty: HTTPS_PROXY / HTTP_PROXY / NO_PROXY from the environment, if set
}

export const DEFAULT_NETWORK: NetworkSettings = { timeoutMs: 30_000, verifyTls: true, proxy: '' }
export const TIMEOUT_LIMITS = { min: 1_000, max: 600_000 }

/** Settings from storage or IPC: anything missing or malformed falls back to the default. */
export function normalizeNetwork(raw: unknown): NetworkSettings {
  const n = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const timeout = typeof n.timeoutMs === 'number' && Number.isFinite(n.timeoutMs) ? n.timeoutMs : 0
  return {
    timeoutMs: timeout
      ? Math.min(TIMEOUT_LIMITS.max, Math.max(TIMEOUT_LIMITS.min, Math.round(timeout)))
      : DEFAULT_NETWORK.timeoutMs,
    verifyTls: n.verifyTls !== false,
    proxy: typeof n.proxy === 'string' ? n.proxy.trim() : ''
  }
}

export interface SendOptions {
  /** Lets the request be canceled with cancelRequest(id) while it runs. */
  id?: string
  network?: Partial<NetworkSettings>
}
