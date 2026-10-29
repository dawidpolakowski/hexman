// SPDX-License-Identifier: Apache-2.0
import { EnvHttpProxyAgent, ProxyAgent, fetch, type Dispatcher } from 'undici'
import type { HttpRequestInput, HttpResult, NetworkSettings, SendOptions } from '../shared/http'
import { normalizeNetwork } from '../shared/http'

const MAX_BODY_CHARS = 2_000_000
const NO_BODY_METHODS = new Set(['GET', 'HEAD'])

// One connection pool per distinct TLS/proxy setup, so keep-alive connections are reused.
const dispatchers = new Map<string, Dispatcher>()

function dispatcherFor({ verifyTls, proxy }: NetworkSettings): Dispatcher {
  const key = JSON.stringify([verifyTls, proxy])
  let dispatcher = dispatchers.get(key)
  if (!dispatcher) {
    const tls = { rejectUnauthorized: verifyTls }
    dispatcher = proxy
      ? new ProxyAgent({ uri: proxy, requestTls: tls, proxyTls: tls })
      : new EnvHttpProxyAgent({ connect: tls, requestTls: tls, proxyTls: tls })
    dispatchers.set(key, dispatcher)
  }
  return dispatcher
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID'
])

function describeError(err: unknown): string {
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause : undefined
  const text =
    (err instanceof Error ? err.message : String(err)) + (cause ? `: ${cause.message}` : '')
  const code = (cause as NodeJS.ErrnoException | undefined)?.code
  return code && TLS_CODES.has(code)
    ? `${text}. For a test server with a self-signed certificate, turn off TLS verification in Settings.`
    : text
}

const running = new Map<string, AbortController>()

/** Aborts a request started with this id; returns false when it isn't running. */
export function cancelRequest(id: string): boolean {
  const controller = running.get(id)
  controller?.abort('canceled')
  return !!controller
}

export async function sendRequest(
  input: HttpRequestInput,
  options: SendOptions = {}
): Promise<HttpResult> {
  let url: URL
  try {
    url = new URL(input.url)
  } catch {
    return { ok: false, error: 'Invalid URL' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: `Unsupported protocol: ${url.protocol}` }
  }

  const network = normalizeNetwork(options.network)
  let dispatcher: Dispatcher
  try {
    dispatcher = dispatcherFor(network)
  } catch (err) {
    return { ok: false, error: `Invalid proxy: ${(err as Error).message}` }
  }

  const method = input.method.toUpperCase()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort('timeout'), network.timeoutMs)
  if (options.id) running.set(options.id, controller)
  const started = performance.now()

  try {
    const res = await fetch(url, {
      method,
      headers: input.headers,
      body: NO_BODY_METHODS.has(method) || !input.body ? undefined : input.body,
      signal: controller.signal,
      dispatcher
    })
    const bytes = new Uint8Array(await res.arrayBuffer())
    const durationMs = Math.round(performance.now() - started)
    const text = new TextDecoder().decode(bytes)
    const truncated = text.length > MAX_BODY_CHARS
    return {
      ok: true,
      response: {
        status: res.status,
        statusText: res.statusText,
        durationMs,
        sizeBytes: bytes.byteLength,
        headers: [...res.headers.entries()],
        body: truncated ? text.slice(0, MAX_BODY_CHARS) : text,
        truncated
      }
    }
  } catch (err) {
    if (controller.signal.reason === 'timeout')
      return { ok: false, error: `Timed out after ${network.timeoutMs / 1000}s` }
    if (controller.signal.reason === 'canceled') return { ok: false, error: 'Canceled' }
    return { ok: false, error: describeError(err) }
  } finally {
    clearTimeout(timer)
    if (options.id && running.get(options.id) === controller) running.delete(options.id)
  }
}
