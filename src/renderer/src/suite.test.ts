// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import type { HttpRequestInput, HttpResult } from '../../shared/http'
import type { Sample, Suite } from './suite'
import {
  assess,
  createStep,
  percentile,
  persistSuites,
  plannedSamples,
  restoreSuites,
  runSuite,
  statusMatches,
  summarize
} from './suite'

const ok = (status: number, body = '', durationMs = 10): HttpResult => ({
  ok: true,
  response: {
    status,
    statusText: '',
    durationMs,
    sizeBytes: body.length,
    headers: [],
    body,
    truncated: false
  }
})

const suiteWith = (over: Partial<Suite> = {}): Suite => ({
  id: 's',
  name: 'Suite 1',
  threads: 1,
  rampUp: 0,
  loops: 1,
  steps: [],
  ...over
})

describe('assertions', () => {
  it('matches status families, exact codes, lists and ranges', () => {
    expect(statusMatches('2xx', 204)).toBe(true)
    expect(statusMatches('2xx', 301)).toBe(false)
    expect(statusMatches('200, 201', 201)).toBe(true)
    expect(statusMatches('400-404', 404)).toBe(true)
    expect(() => statusMatches('ok', 200)).toThrow('Invalid expected status "ok"')
  })

  it('collects every failed assertion', () => {
    const step = { ...createStep('r'), status: '201', maxMs: '50', contains: 'Ada' }
    expect(assess(step, ok(200, 'Grace', 80), 0).failures).toEqual([
      'Status 200, expected 201',
      '80 ms exceeds 50 ms',
      'Body does not contain "Ada"'
    ])
    expect(assess(step, ok(201, 'Ada', 20), 0).failures).toEqual([])
  })

  it('treats transport errors as failures with the measured time', () => {
    expect(assess(createStep('r'), { ok: false, error: 'ECONNREFUSED' }, 12)).toEqual({
      status: null,
      ms: 12,
      failures: ['ECONNREFUSED']
    })
  })
})

describe('runSuite', () => {
  it('runs threads × loops × steps, in step order per iteration', async () => {
    const a = createStep('a')
    const b = { ...createStep('b'), status: '201' }
    const suite = suiteWith({ threads: 3, loops: 2, steps: [a, b] })
    const sent: string[] = []
    const samples: Sample[] = []

    await runSuite({
      suite,
      resolve: (id) => ({ method: 'GET', url: `http://x/${id}`, headers: {} }),
      send: async (input: HttpRequestInput) => {
        sent.push(input.url)
        return ok(200)
      },
      onSample: (s) => samples.push(s),
      signal: new AbortController().signal
    })

    expect(plannedSamples(suite)).toBe(12)
    expect(samples).toHaveLength(12)
    expect(new Set(samples.map((s) => s.thread))).toEqual(new Set([0, 1, 2]))
    const thread0 = samples.filter((s) => s.thread === 0).map((s) => s.stepId)
    expect(thread0).toEqual([a.id, b.id, a.id, b.id])
    expect(samples.filter((s) => s.failures.length)).toHaveLength(6) // every "b" expects 201
  })

  it('reports deleted requests and unresolvable ones without sending', async () => {
    const samples: Sample[] = []
    let calls = 0
    await runSuite({
      suite: suiteWith({ steps: [createStep('gone'), createStep('broken')] }),
      resolve: (id) => {
        if (id === 'broken') throw new Error('Undefined variable {{baseUrl}}')
        return undefined
      },
      send: async () => {
        calls++
        return ok(200)
      },
      onSample: (s) => samples.push(s),
      signal: new AbortController().signal
    })
    expect(calls).toBe(0)
    expect(samples.map((s) => s.failures[0])).toEqual([
      'Request no longer exists',
      'Undefined variable {{baseUrl}}'
    ])
  })

  it('passes extracted values to later steps, separately per thread', async () => {
    const login = {
      ...createStep('login'),
      extract: [{ id: 'e', variable: 'token', source: 'json' as const, expr: '$.token' }]
    }
    const me = createStep('me')
    const sent: string[] = []
    const samples: Sample[] = []
    await runSuite({
      suite: suiteWith({ threads: 2, loops: 2, steps: [login, me] }),
      resolve: (id, vars) => {
        if (id === 'me' && !vars.token) throw new Error('Undefined variable {{token}}')
        return { method: 'GET', url: `http://x/${id}`, headers: { auth: vars.token ?? '' } }
      },
      send: async (input) => {
        sent.push(`${input.url} ${input.headers.auth}`)
        return input.url.endsWith('login')
          ? ok(200, JSON.stringify({ token: `t${sent.length}` }))
          : ok(200)
      },
      onSample: (s) => samples.push(s),
      signal: new AbortController().signal
    })
    expect(samples.every((s) => s.failures.length === 0)).toBe(true)
    expect(sent.filter((s) => s.startsWith('http://x/me')).every((s) => /me t\d+$/.test(s))).toBe(
      true
    )
    const loginSamples = samples.filter((s) => s.stepId === login.id)
    expect(loginSamples.every((s) => s.extracted?.[0][0] === 'token')).toBe(true)
  })

  it('fails the sample when an extractor finds nothing', async () => {
    const samples: Sample[] = []
    await runSuite({
      suite: suiteWith({
        steps: [
          {
            ...createStep('login'),
            extract: [{ id: 'e', variable: 'token', source: 'json', expr: '$.token' }]
          }
        ]
      }),
      resolve: () => ({ method: 'GET', url: 'http://x', headers: {} }),
      send: async () => ok(200, '{"error":"no"}'),
      onSample: (s) => samples.push(s),
      signal: new AbortController().signal
    })
    expect(samples[0].failures).toEqual(['Extract token: $.token not found'])
  })

  it('ramps threads up and stops when aborted', async () => {
    const controller = new AbortController()
    const waits: number[] = []
    const samples: Sample[] = []
    await runSuite({
      suite: suiteWith({ threads: 4, rampUp: 2, loops: 100, steps: [createStep('a')] }),
      resolve: () => ({ method: 'GET', url: 'http://x', headers: {} }),
      send: async () => {
        if (samples.length >= 5) controller.abort()
        return ok(200)
      },
      onSample: (s) => samples.push(s),
      signal: controller.signal,
      sleep: async (ms) => {
        waits.push(ms)
      }
    })
    expect(waits).toEqual([500, 1000, 1500])
    expect(samples.length).toBeLessThan(20)
  })
})

describe('report', () => {
  it('computes percentiles by nearest rank', () => {
    const times = Array.from({ length: 10 }, (_, i) => (i + 1) * 10)
    expect(percentile(times, 90)).toBe(90)
    expect(percentile(times, 100)).toBe(100)
    expect(percentile([], 90)).toBe(0)
  })

  it('summarises per step and in total', () => {
    const a = createStep('a')
    const b = createStep('b')
    const sample = (stepId: string, ms: number, failed = false): Sample => ({
      stepId,
      thread: 0,
      iteration: 0,
      status: 200,
      ms,
      failures: failed ? ['x'] : []
    })
    const { rows, total } = summarize(
      [a, b],
      [sample(a.id, 10), sample(a.id, 30), sample(b.id, 50, true)]
    )
    expect(rows[0]).toMatchObject({ samples: 2, errors: 0, avg: 20, min: 10, max: 30 })
    expect(rows[1]).toMatchObject({ samples: 1, errors: 1, avg: 50 })
    expect(total).toMatchObject({ samples: 3, errors: 1, min: 10, max: 50, p90: 50 })
  })
})

describe('persistence', () => {
  it('round-trips suites and repairs bad fields', () => {
    const data: Record<string, string> = {}
    const storage = {
      getItem: (k: string) => data[k] ?? null,
      setItem: (k: string, v: string) => {
        data[k] = v
      }
    }
    const suite = suiteWith({ threads: 5, steps: [createStep('a')] })
    persistSuites([suite], storage)
    expect(restoreSuites(storage)).toEqual([suite])

    data['hexman.suites.v1'] = JSON.stringify([
      { id: 'x', name: 'X', threads: 'many', steps: [{ requestId: 'r' }, { nope: 1 }] }
    ])
    const [repaired] = restoreSuites(storage)
    expect(repaired).toMatchObject({ threads: 1, loops: 1, rampUp: 0 })
    expect(repaired.steps).toHaveLength(1)
    expect(repaired.steps[0]).toMatchObject({ requestId: 'r', status: '2xx' })
  })
})
