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
