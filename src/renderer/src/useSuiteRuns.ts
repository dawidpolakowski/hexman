// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react'
import type { HttpRequestInput, NetworkSettings } from '../../shared/http'
import type { Sample, Suite } from './suite'
import { plannedSamples, runSuite } from './suite'

export interface RunState {
  running: boolean
  stopped: boolean
  planned: number
  samples: Sample[]
  startedAt: number
  now: number // last progress tick, so elapsed time renders without reading the clock
  endedAt: number | null
}

const FLUSH_MS = 200

/** Runs suites in the background; samples are batched into state a few times a second. */
export function useSuiteRuns(
  resolve: (requestId: string, vars: Record<string, string>) => HttpRequestInput | undefined,
  network: NetworkSettings
): {
  runs: Record<string, RunState>
  start: (suite: Suite) => void
  stop: (suiteId: string) => void
} {
  const [runs, setRuns] = useState<Record<string, RunState>>({})
  const controllers = useRef(new Map<string, AbortController>())
  const resolveRef = useRef(resolve)
  const networkRef = useRef(network)
  useEffect(() => {
    resolveRef.current = resolve
    networkRef.current = network
  })

  const patch = (id: string, fn: (run: RunState) => Partial<RunState>): void =>
    setRuns((all) => (all[id] ? { ...all, [id]: { ...all[id], ...fn(all[id]) } } : all))

  const start = (suite: Suite): void => {
    if (controllers.current.has(suite.id) || suite.steps.length === 0) return
    const controller = new AbortController()
    controllers.current.set(suite.id, controller)
    const now = Date.now()
    setRuns((all) => ({
      ...all,
      [suite.id]: {
        running: true,
        stopped: false,
        planned: plannedSamples(suite),
        samples: [],
        startedAt: now,
        now,
        endedAt: null
      }
    }))

    const buffer: Sample[] = []
    const flush = (): void => {
      const batch = buffer.splice(0)
      patch(suite.id, (run) => ({ samples: [...run.samples, ...batch], now: Date.now() }))
    }
    const timer = setInterval(flush, FLUSH_MS)

    runSuite({
      suite,
      resolve: (id, vars) => resolveRef.current(id, vars),
      send: (input) => window.api.sendRequest(input, { network: networkRef.current }),
      onSample: (sample) => buffer.push(sample),
      signal: controller.signal
    }).finally(() => {
      clearInterval(timer)
      flush()
      controllers.current.delete(suite.id)
      patch(suite.id, () => ({ running: false, endedAt: Date.now() }))
    })
  }

  const stop = (suiteId: string): void => {
    const controller = controllers.current.get(suiteId)
    if (!controller) return
    controller.abort()
    patch(suiteId, () => ({ stopped: true }))
  }

  return { runs, start, stop }
}
