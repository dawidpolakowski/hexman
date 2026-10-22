// SPDX-License-Identifier: Apache-2.0
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sendRequest } from './http'

let server: Server
let base: string

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      if (req.url === '/missing') res.statusCode = 404
      res.end(
        JSON.stringify({
          method: req.method,
          auth: req.headers.authorization ?? null,
          body: Buffer.concat(chunks).toString()
        })
      )
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server.close()
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
