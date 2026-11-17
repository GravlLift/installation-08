/**
 * meshFetchBatcher.test.ts — the library-file batcher: requests issued in one task go out as one
 * bundle, a batch over the entry cap splits into several bundles, a 404 entry rejects only itself,
 * an aborted entry rejects only itself, and a non-library path stays a plain GET.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

import { createMeshBatcher } from './meshFetchBatcher'
import { fetchMesh, setMeshBatcher, resetMeshBatcher } from './meshFetch'

interface Spec {
  status: number
  data?: string
}

// bundleBody encodes the server's bundle stream: per entry a 4-byte little-endian header length,
// the JSON header, then exactly size bytes.
function bundleBody(entries: { entry: string; status: number; data?: string }[]): Uint8Array {
  const enc = new TextEncoder()
  const parts: number[] = []
  for (const e of entries) {
    const size = e.data ? e.data.length : 0
    const headerBytes = enc.encode(JSON.stringify({ file: e.entry, status: e.status, size }))
    parts.push(
      headerBytes.length & 0xff,
      (headerBytes.length >> 8) & 0xff,
      (headerBytes.length >> 16) & 0xff,
      (headerBytes.length >> 24) & 0xff,
      ...headerBytes,
      ...(e.data ? enc.encode(e.data) : []),
    )
  }
  return new Uint8Array(parts)
}

// fakeResponse is the minimum the batcher reads: ok/status and a streamable body.
function fakeResponse(status: number, body: Uint8Array): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(body)
      controller.close()
    },
  })
  return { ok: status >= 200 && status < 300, status, body: stream, headers: { get: () => null } } as unknown as Response
}

// bundleFetcher answers a bundle POST with a stream built from the requested files, in order.
function bundleFetcher(table: Record<string, Spec>) {
  return (_url: string, init: RequestInit): Promise<Response> => {
    const files = (JSON.parse(init.body as string) as { files: string[] }).files
    return Promise.resolve(fakeResponse(200, bundleBody(files.map((f) => ({ entry: f, ...table[f] })))) as unknown as Response)
  }
}

// makeBatcher wires a batcher with a mock fetch and a manual flush, so a task's requests are sent
// deterministically when flushNow runs.
function makeBatcher(table: Record<string, Spec>, opts: { maxEntries?: number; maxInflight?: number } = {}) {
  const spy = vi.fn(bundleFetcher(table))
  let scheduled: (() => void) | null = null
  const batcher = createMeshBatcher({
    fetch: spy,
    schedule: (fn) => {
      scheduled = fn
    },
    maxEntries: opts.maxEntries ?? 64,
    maxInflight: opts.maxInflight ?? 4,
  })
  const flushNow = () => {
    const f = scheduled
    scheduled = null
    f?.()
  }
  return { batcher, flushNow, spy }
}

const noAbort = () => new AbortController().signal

describe('the library-file batcher', () => {
  afterEach(() => {
    resetMeshBatcher()
  })

  it('sends the requests of one task as a single bundle', async () => {
    const { batcher, flushNow, spy } = makeBatcher({
      'spartan-pieces/a.glb': { status: 200, data: 'A' },
      'first-person/b.glb': { status: 200, data: 'BB' },
      'weapons/c.glb': { status: 200, data: 'CCC' },
    })
    const [a, b, c] = [
      batcher.request('/api/spartan-pieces/a.glb', () => {}, noAbort()),
      batcher.request('/api/first-person/b.glb', () => {}, noAbort()),
      batcher.request('/api/weapons/c.glb', () => {}, noAbort()),
    ]
    flushNow()
    const [ra, rb, rc] = await Promise.all([a, b, c])
    expect(new TextDecoder().decode(ra)).toBe('A')
    expect(new TextDecoder().decode(rb)).toBe('BB')
    expect(new TextDecoder().decode(rc)).toBe('CCC')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('splits 100 requests into two bundles of 64 and 36', async () => {
    const table: Record<string, Spec> = {}
    for (let i = 0; i < 100; i++) table[`spartan-pieces/f${i}.glb`] = { status: 200, data: 'x' }
    const { batcher, flushNow, spy } = makeBatcher(table)
    const ps: Promise<ArrayBuffer>[] = []
    for (let i = 0; i < 100; i++) ps.push(batcher.request(`/api/spartan-pieces/f${i}.glb`, () => {}, noAbort()))
    flushNow()
    await Promise.all(ps)
    expect(spy).toHaveBeenCalledTimes(2)
    const first = (JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string) as { files: string[] }).files
    const second = (JSON.parse((spy.mock.calls[1][1] as RequestInit).body as string) as { files: string[] }).files
    expect(first).toHaveLength(64)
    expect(second).toHaveLength(36)
  })

  it('rejects a 404 entry only, and settles its neighbours', async () => {
    const { batcher, flushNow } = makeBatcher({
      'spartan-pieces/good.glb': { status: 200, data: 'G' },
      'spartan-pieces/bad.glb': { status: 404 },
    })
    const good = batcher.request('/api/spartan-pieces/good.glb', () => {}, noAbort())
    const bad = batcher.request('/api/spartan-pieces/bad.glb', () => {}, noAbort())
    flushNow()
    expect(new TextDecoder().decode(await good)).toBe('G')
    await expect(bad).rejects.toMatchObject({ status: 404 })
  })

  it('rejects an aborted entry only, and lets the rest settle', async () => {
    const { batcher, flushNow } = makeBatcher({
      'spartan-pieces/good.glb': { status: 200, data: 'G' },
      'spartan-pieces/bye.glb': { status: 200, data: 'B' },
    })
    const controller = new AbortController()
    const good = batcher.request('/api/spartan-pieces/good.glb', () => {}, noAbort())
    const bye = batcher.request('/api/spartan-pieces/bye.glb', () => {}, controller.signal)
    flushNow()
    controller.abort()
    expect(new TextDecoder().decode(await good)).toBe('G')
    await expect(bye).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('leaves a non-library path on the plain single-request path', async () => {
    const fetchSpy = vi.fn(async (_url: string, _init: RequestInit) => fakeResponse(200, new TextEncoder().encode('mapbytes')) as unknown as Response)
    vi.stubGlobal('fetch', fetchSpy)
    const batcherSpy = vi.fn()
    setMeshBatcher({ request: batcherSpy })
    const buf = await fetchMesh('/api/matches/x/mesh.glb', () => {}, noAbort())
    expect(new TextDecoder().decode(buf)).toBe('mapbytes')
    expect(batcherSpy).not.toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/matches/x/mesh.glb')
    expect((init as RequestInit).method).toBe('GET')
  })
})
