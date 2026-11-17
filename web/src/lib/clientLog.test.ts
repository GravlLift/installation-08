// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { describeError, installClientErrorReporting, reportClientError, resetClientLogForTests } from './clientLog'

describe('clientLog', () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))

  beforeEach(() => {
    resetClientLogForTests()
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function bodies(): Array<Record<string, string>> {
    return fetchMock.mock.calls.map((call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string))
  }

  it('posts one entry to /api/client-log with the kind, message and stack', () => {
    reportClientError('map-load', new TypeError('boom'), '/api/matches/x/mesh.glb')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/client-log')
    expect(init.method).toBe('POST')
    const body = bodies()[0]
    expect(body.kind).toBe('map-load')
    expect(body.message).toBe('TypeError: boom')
    expect(body.detail).toContain('/api/matches/x/mesh.glb')
  })

  it('sends the same error once', () => {
    reportClientError('uncaught', new Error('same'))
    reportClientError('uncaught', new Error('same'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops after the per-page cap', () => {
    for (let i = 0; i < 100; i++) reportClientError('uncaught', `error ${i}`)
    expect(fetchMock).toHaveBeenCalledTimes(30)
  })

  it('reports unhandled rejections and uncaught errors from the window', () => {
    const target = new EventTarget() as unknown as Window
    installClientErrorReporting(target)
    const rejection = new Event('unhandledrejection') as Event & { reason?: unknown }
    rejection.reason = new Error('nobody caught me')
    target.dispatchEvent(rejection)
    const error = new Event('error') as Event & { error?: unknown; message?: string; filename?: string }
    error.error = new Error('thrown')
    error.filename = 'index.js'
    target.dispatchEvent(error)
    const kinds = bodies().map((b) => `${b.kind}:${b.message}`)
    expect(kinds).toEqual(['unhandled-rejection:Error: nobody caught me', 'uncaught:Error: thrown'])
  })

  it('a failing send never throws', () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('offline')))
    expect(() => reportClientError('uncaught', 'x')).not.toThrow()
  })

  it('describes non-Error values', () => {
    expect(describeError('plain').message).toBe('plain')
    expect(describeError({ a: 1 }).message).toBe('{"a":1}')
  })
})
