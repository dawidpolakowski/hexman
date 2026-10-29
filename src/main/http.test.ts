// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { connect, type AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { normalizeNetwork } from '../shared/http'
import { cancelRequest, sendRequest } from './http'

let server: Server
let tlsServer: Server
let proxy: Server
let base: string
let tlsBase: string
let proxyUrl: string
const tunneled: string[] = []

function echo(req: IncomingMessage, res: ServerResponse): void {
  const chunks: Buffer[] = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/missing') res.statusCode = 404
    const reply = (): void => {
      res.end(
        JSON.stringify({
          method: req.method,
          auth: req.headers.authorization ?? null,
          body: Buffer.concat(chunks).toString()
        })
      )
    }
    if (req.url === '/slow') setTimeout(reply, 2000)
    else reply()
  })
}

const listen = async (s: Server): Promise<number> => {
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  return (s.address() as AddressInfo).port
}

beforeAll(async () => {
  server = createServer(echo)
  base = `http://127.0.0.1:${await listen(server)}`

  const fixtures = join(__dirname, 'fixtures')
  tlsServer = createHttpsServer(
    {
      key: readFileSync(join(fixtures, 'self-signed.key')),
      cert: readFileSync(join(fixtures, 'self-signed.crt'))
    },
    echo
  )
  tlsBase = `https://127.0.0.1:${await listen(tlsServer)}`

  // A minimal CONNECT proxy that records where it tunnels to.
  proxy = createServer((_req, res) => res.writeHead(405).end())
  proxy.on('connect', (req: IncomingMessage, client, head) => {
    tunneled.push(req.url ?? '')
    const [host, port] = (req.url ?? '').split(':')
    const upstream = connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.write(head)
      upstream.pipe(client)
      client.pipe(upstream)
    })
    upstream.on('error', () => client.destroy())
    client.on('error', () => upstream.destroy())
  })
  proxyUrl = `http://127.0.0.1:${await listen(proxy)}`
})

afterAll(() => {
  for (const s of [server, tlsServer, proxy]) {
    s.closeAllConnections()
    s.close()
  }
})

describe('sendRequest', () => {
  it('returns status, timing, size and headers', async () => {
    const res = await sendRequest({
      method: 'GET',
      url: `${base}/ok`,
      headers: { Authorization: 'Bearer t' }
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.response.status).toBe(200)
    expect(res.response.sizeBytes).toBeGreaterThan(0)
    expect(res.response.durationMs).toBeGreaterThanOrEqual(0)
    expect(res.response.headers).toContainEqual(['content-type', 'application/json'])
    expect(JSON.parse(res.response.body)).toMatchObject({ method: 'GET', auth: 'Bearer t' })
  })

  it('sends a body for POST', async () => {
    const res = await sendRequest({ method: 'post', url: `${base}/`, headers: {}, body: '{"x":1}' })
    expect(res.ok && JSON.parse(res.response.body).body).toBe('{"x":1}')
  })

  it('ignores the body for GET', async () => {
    const res = await sendRequest({ method: 'GET', url: `${base}/`, headers: {}, body: 'ignored' })
    expect(res.ok && JSON.parse(res.response.body).body).toBe('')
  })

  it('treats HTTP error statuses as responses, not failures', async () => {
    const res = await sendRequest({ method: 'GET', url: `${base}/missing`, headers: {} })
    expect(res.ok && res.response.status).toBe(404)
  })

  it('rejects invalid URLs and non-http protocols', async () => {
    expect(await sendRequest({ method: 'GET', url: 'nope', headers: {} })).toEqual({
      ok: false,
      error: 'Invalid URL'
    })
    const file = await sendRequest({ method: 'GET', url: 'file:///etc/passwd', headers: {} })
    expect(file).toMatchObject({
      ok: false,
      error: expect.stringContaining('Unsupported protocol')
    })
  })

  it('reports connection failures', async () => {
    const res = await sendRequest({ method: 'GET', url: 'http://127.0.0.1:1/', headers: {} })
    expect(res.ok).toBe(false)
  })
})

describe('network settings', () => {
  it('rejects a self-signed certificate and says how to allow it', async () => {
    const res = await sendRequest({ method: 'GET', url: `${tlsBase}/`, headers: {} })
    expect(res).toMatchObject({
      ok: false,
      error: expect.stringContaining('turn off TLS verification in Settings')
    })
  })

  it('accepts a self-signed certificate when TLS verification is off', async () => {
    const res = await sendRequest(
      { method: 'GET', url: `${tlsBase}/`, headers: {} },
      { network: { verifyTls: false } }
    )
    expect(res.ok && res.response.status).toBe(200)
  })

  it('sends requests through the configured proxy', async () => {
    tunneled.length = 0
    const res = await sendRequest(
      { method: 'GET', url: `${base}/via-proxy`, headers: {} },
      { network: { proxy: proxyUrl } }
    )
    expect(res.ok && res.response.status).toBe(200)
    expect(tunneled).toEqual([new URL(base).host])
  })

  it('reports an unusable proxy setting', async () => {
    const res = await sendRequest(
      { method: 'GET', url: `${base}/`, headers: {} },
      { network: { proxy: 'not a url' } }
    )
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining('Invalid proxy') })
  })

  it('times out after the configured time', async () => {
    const res = await sendRequest(
      { method: 'GET', url: `${base}/slow`, headers: {} },
      { network: { timeoutMs: 1000 } }
    )
    expect(res).toEqual({ ok: false, error: 'Timed out after 1s' })
  })

  it('cancels a running request by id', async () => {
    const pending = sendRequest({ method: 'GET', url: `${base}/slow`, headers: {} }, { id: 'r1' })
    await new Promise((r) => setTimeout(r, 100))
    expect(cancelRequest('r1')).toBe(true)
    expect(await pending).toEqual({ ok: false, error: 'Canceled' })
    expect(cancelRequest('r1')).toBe(false)
  })

  it('clamps and defaults settings that arrive over IPC', () => {
    expect(normalizeNetwork(undefined)).toEqual({ timeoutMs: 30_000, verifyTls: true, proxy: '' })
    expect(normalizeNetwork({ timeoutMs: 5, verifyTls: 'no', proxy: ' http://p:8080 ' })).toEqual({
      timeoutMs: 1000,
      verifyTls: true,
      proxy: 'http://p:8080'
    })
    expect(normalizeNetwork({ timeoutMs: 1e9 }).timeoutMs).toBe(600_000)
  })
})
