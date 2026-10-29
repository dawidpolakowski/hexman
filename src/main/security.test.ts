// SPDX-License-Identifier: Apache-2.0
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: {} }))
const { fromApp, isAppUrl, isExternalLink, isHttpRequestInput } = await import('./security')

const DEV = 'http://localhost:5173'

const event = (url: string, topLevel = true): IpcMainInvokeEvent => {
  const frame = { url }
  return {
    senderFrame: frame,
    sender: { mainFrame: topLevel ? frame : { url } }
  } as unknown as IpcMainInvokeEvent
}

describe('renderer containment', () => {
  it('recognizes only the app page as the app', () => {
    expect(isAppUrl('file:///C:/Hexman/out/renderer/index.html', undefined)).toBe(true)
    expect(isAppUrl('https://evil.example/', undefined)).toBe(false)
    expect(isAppUrl('http://localhost:5173/index.html', DEV)).toBe(true)
    expect(isAppUrl('http://localhost:5174/', DEV)).toBe(false)
    expect(isAppUrl('not a url', undefined)).toBe(false)
  })

  it('only hands web and mail links to the default browser', () => {
    expect(isExternalLink('https://github.com/dawidpolakowski/Hexman')).toBe(true)
    expect(isExternalLink('mailto:qa@example.com')).toBe(true)
    expect(isExternalLink('file:///C:/Windows/System32/calc.exe')).toBe(false)
    expect(isExternalLink('ms-settings:')).toBe(false)
  })

  it('answers IPC only for the app page, top-level frame', () => {
    expect(fromApp(event('file:///app/index.html'), undefined)).toBe(true)
    expect(fromApp(event('file:///app/index.html', false), undefined)).toBe(false)
    expect(fromApp(event('https://evil.example/'), undefined)).toBe(false)
  })

  it('validates request input coming over IPC', () => {
    expect(isHttpRequestInput({ method: 'GET', url: 'http://x', headers: {} })).toBe(true)
    expect(
      isHttpRequestInput({ method: 'POST', url: 'http://x', headers: { a: 'b' }, body: '' })
    ).toBe(true)
    expect(isHttpRequestInput({ method: 'GET', url: 'http://x', headers: { a: 1 } })).toBe(false)
    expect(isHttpRequestInput({ method: 'GET', url: 'http://x', headers: {}, body: {} })).toBe(
      false
    )
    expect(isHttpRequestInput('GET http://x')).toBe(false)
  })
})
