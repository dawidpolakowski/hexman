// SPDX-License-Identifier: Apache-2.0

export interface SaveFileInput {
  suggestedName: string
  content: string
}

export type SaveFileResult =
  { status: 'saved'; path: string } | { status: 'canceled' } | { status: 'error'; error: string }

export type OpenFileResult =
  | { status: 'opened'; path: string; content: string }
  | { status: 'canceled' }
  | { status: 'error'; error: string }
