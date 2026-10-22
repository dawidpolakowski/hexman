// SPDX-License-Identifier: Apache-2.0
// JMeter-style suites: a thread group (threads, ramp-up, loops) runs an ordered list of saved
// requests; every sample is checked against the step's assertions and rolled up into a report.
import type { HttpRequestInput, HttpResult } from '../../shared/http'
import type { StorageLike } from './model'
import { KEYS, isRecord, nextName, readRecords, writeJson } from './model'

export interface SuiteStep {
  id: string
  requestId: string
  status: string // expected status: "2xx", "200", "200,201", "200-299"; empty = any
  maxMs: string // response-time limit in ms; empty = none
  contains: string // text the body must contain; empty = none
}

export interface Suite {
  id: string
  name: string
  threads: number
  rampUp: number // seconds until the last thread starts
  loops: number
  steps: SuiteStep[]
}

export interface Sample {
  stepId: string
  thread: number
  iteration: number
  status: number | null
  ms: number
  failures: string[]
}

export const LIMITS = { threads: 100, loops: 10_000, rampUp: 3600 }

const clampInt = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(n) ? Math.floor(n) : min))

export function createSuite(existing: Suite[]): Suite {
  return {
    id: crypto.randomUUID(),
    name: nextName(existing, 'Suite'),
    threads: 1,
    rampUp: 0,
    loops: 1,
    steps: []
  }
}

export function createStep(requestId: string): SuiteStep {
  return { id: crypto.randomUUID(), requestId, status: '2xx', maxMs: '', contains: '' }
}

export const plannedSamples = (s: Suite): number =>
  clampInt(s.threads, 1, LIMITS.threads) * clampInt(s.loops, 1, LIMITS.loops) * s.steps.length

/* ---- assertions ---- */

export function statusMatches(expected: string, status: number): boolean {
  const checks = expected.split(',').map((raw) => {
    const part = raw.trim()
    const family = /^([1-5])xx$/i.exec(part)
    if (family) return (s: number): boolean => Math.floor(s / 100) === Number(family[1])
    const range = /^(\d{3})\s*-\s*(\d{3})$/.exec(part)
    if (range) return (s: number): boolean => s >= Number(range[1]) && s <= Number(range[2])
    if (/^\d{3}$/.test(part)) return (s: number): boolean => s === Number(part)
    throw new Error(`Invalid expected status "${part}"`)
  })
  return checks.some((check) => check(status))
}

export function assess(
  step: SuiteStep,
  result: HttpResult,
  elapsedMs: number
): Pick<Sample, 'status' | 'ms' | 'failures'> {
  if (!result.ok) return { status: null, ms: elapsedMs, failures: [result.error] }

  const { status, durationMs: ms, body } = result.response
  const failures: string[] = []
  if (step.status.trim()) {
    try {
      if (!statusMatches(step.status, status)) {
        failures.push(`Status ${status}, expected ${step.status.trim()}`)
      }
    } catch (err) {
      failures.push((err as Error).message)
    }
  }
  const limit = Number(step.maxMs)
  if (step.maxMs.trim() && Number.isFinite(limit) && ms > limit) {
    failures.push(`${ms} ms exceeds ${limit} ms`)
  }
  if (step.contains && !body.includes(step.contains)) {
    failures.push(`Body does not contain "${step.contains}"`)
  }
  return { status, ms, failures }
}

/* ---- runner ---- */

export interface RunOptions {
  suite: Suite
  /** Builds the HTTP input for a step's request; undefined when the request is gone. */
  resolve: (requestId: string) => HttpRequestInput | undefined
  send: (input: HttpRequestInput) => Promise<HttpResult>
  onSample: (sample: Sample) => void
  signal: AbortSignal
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

const abortableSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })

export async function runSuite({
  suite,
  resolve,
  send,
  onSample,
  signal,
  sleep = abortableSleep
}: RunOptions): Promise<void> {
  const threads = clampInt(suite.threads, 1, LIMITS.threads)
  const loops = clampInt(suite.loops, 1, LIMITS.loops)
  const rampMs = clampInt(suite.rampUp, 0, LIMITS.rampUp) * 1000

  const worker = async (thread: number): Promise<void> => {
    if (rampMs && thread > 0) await sleep((rampMs * thread) / threads, signal)
    for (let iteration = 0; iteration < loops; iteration++) {
      for (const step of suite.steps) {
        if (signal.aborted) return
        const base = { stepId: step.id, thread, iteration }
        let input: HttpRequestInput | undefined
        try {
          input = resolve(step.requestId)
        } catch (err) {
          onSample({ ...base, status: null, ms: 0, failures: [(err as Error).message] })
          continue
        }
        if (!input) {
          onSample({ ...base, status: null, ms: 0, failures: ['Request no longer exists'] })
          continue
        }
        const started = performance.now()
        const result = await send(input)
        onSample({ ...base, ...assess(step, result, Math.round(performance.now() - started)) })
      }
    }
  }

  await Promise.all(Array.from({ length: threads }, (_, t) => worker(t)))
}

/* ---- report ---- */

export interface SummaryRow {
  samples: number
  errors: number
  avg: number
  min: number
  max: number
  p90: number
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]
}

function summaryRow(samples: Sample[]): SummaryRow {
  const times = samples.map((s) => s.ms).sort((a, b) => a - b)
  return {
    samples: samples.length,
    errors: samples.filter((s) => s.failures.length > 0).length,
    avg: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
    min: times[0] ?? 0,
    max: times[times.length - 1] ?? 0,
    p90: percentile(times, 90)
  }
}

export function summarize(
  steps: SuiteStep[],
  samples: Sample[]
): { rows: (SummaryRow & { stepId: string })[]; total: SummaryRow } {
  return {
    rows: steps.map((step) => ({
      stepId: step.id,
      ...summaryRow(samples.filter((s) => s.stepId === step.id))
    })),
    total: summaryRow(samples)
  }
}

/* ---- persistence ---- */

export function persistSuites(suites: Suite[], storage?: StorageLike): void {
  writeJson(KEYS.suites, suites, storage)
}

export function restoreSuites(storage?: StorageLike): Suite[] {
  const num = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback)
  const text = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
  return readRecords(KEYS.suites, storage).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    threads: num(s.threads, 1),
    rampUp: num(s.rampUp, 0),
    loops: num(s.loops, 1),
    steps: (Array.isArray(s.steps) ? s.steps : [])
      .filter(
        (st): st is Record<string, unknown> => isRecord(st) && typeof st.requestId === 'string'
      )
      .map((st) => ({
        id: text(st.id) || crypto.randomUUID(),
        requestId: st.requestId as string,
        status: text(st.status, '2xx'),
        maxMs: text(st.maxMs),
        contains: text(st.contains)
      }))
  }))
}
