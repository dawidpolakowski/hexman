// SPDX-License-Identifier: Apache-2.0
import type { HttpRequestInput, HttpResult } from '../shared/http'

const TIMEOUT_MS = 30_000
const MAX_BODY_CHARS = 2_000_000
const NO_BODY_METHODS = new Set(['GET', 'HEAD'])

export async function sendRequest(input: HttpRequestInput): Promise<HttpResult> {
  let url: URL
  try {
    url = new URL(input.url)
  } catch {
    return { ok: false, error: 'Invalid URL' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: `Unsupported protocol: ${url.protocol}` }
  }

  const method = input.method.toUpperCase()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const started = performance.now()

  try {
    const res = await fetch(url, {
      method,
      headers: input.headers,
      body: NO_BODY_METHODS.has(method) || !input.body ? undefined : input.body,
      signal: controller.signal
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
    if (controller.signal.aborted)
      return { ok: false, error: `Timed out after ${TIMEOUT_MS / 1000}s` }
    const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : ''
    return { ok: false, error: (err instanceof Error ? err.message : String(err)) + cause }
  } finally {
    clearTimeout(timer)
  }
}
