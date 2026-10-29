// SPDX-License-Identifier: Apache-2.0
// The collections folder: the saved workspace mirrored to plain JSON files, one per item.

export type DiskRecord = Record<string, unknown>

export interface DiskWorkspace {
  requests: DiskRecord[] // folderId comes from the directory a request file sits in
  folders: DiskRecord[]
  suites: DiskRecord[]
  environments: DiskRecord[]
}

export type CollectionsReadResult =
  | ({ status: 'read'; root: string; problems: string[] } & DiskWorkspace)
  | { status: 'disconnected' }
  | { status: 'error'; error: string }

export type CollectionsWriteResult =
  | { status: 'written'; written: number; deleted: number }
  | { status: 'disconnected' }
  | { status: 'error'; error: string }

/** A folder picked in the dialog, not connected yet: the renderer confirms first. */
export type CollectionsChoice =
  | { status: 'chosen'; path: string; isCollections: boolean; empty: boolean }
  | { status: 'canceled' }
  | { status: 'error'; error: string }
