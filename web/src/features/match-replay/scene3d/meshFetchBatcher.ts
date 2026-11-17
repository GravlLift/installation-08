// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * meshFetchBatcher.ts — the small library files (armor, first-person, weapon) fetched in BUNDLES
 * instead of one request each.
 *
 * Every 3D load pulls roughly a thousand small files one request at a time; on HTTP/1.1 the
 * browser opens at most six connections per host, so most of that time is queueing. The batcher
 * collects the requests issued in the same task, splits them into bundles of at most 64 entries,
 * keeps at most 4 bundle requests in flight (leaving two of the six connections free for
 * everything else), and streams the answer so each entry's promise settles as soon as its own
 * bytes arrive. A 404 entry rejects only itself; a failed bundle request rejects all of its
 * entries; an aborted entry rejects itself and, once every entry of its in-flight bundle is
 * aborted, aborts that fetch.
 */
import { resolve } from '@/lib/api/client'

import { measureSince, now } from './perf3d'

/** The three served library folders a bundle entry may name (their GET routes). */
const LIBRARY_PREFIXES = ['/api/spartan-pieces/', '/api/first-person/', '/api/weapons/'] as const

/** isLibraryFile says whether a resolved path is a file under one of the library GET routes. */
export function isLibraryFile(path: string): boolean {
  return LIBRARY_PREFIXES.some((p) => path.startsWith(p))
}

/** libraryEntryOf strips the `/api/` prefix so the path is the `<prefix>/<name>` a bundle names. */
export function libraryEntryOf(path: string): string {
  return path.slice('/api/'.length)
}

/** An ApiError-shaped rejection for a non-2xx answer, the kind a single GET would have thrown. */
interface BatcherApiError {
  code: string
  message: string
  retryable: boolean
  status: number
}

interface Entry {
  path: string
  entry: string
  signal: AbortSignal
  onProgress: (loaded: number, total: number) => void
  resolve: (buffer: ArrayBuffer) => void
  reject: (err: unknown) => void
  started: number
  aborted: boolean
  settled: boolean
  controller?: AbortController
  bundle?: Entry[]
}

export interface MeshBatcher {
  request(path: string, onProgress: (loaded: number, total: number) => void, signal: AbortSignal): Promise<ArrayBuffer>
}

/** BundleStream reads exact byte counts off a response stream, so one entry's tail and the next
 * entry's header never get mixed up when a read() chunk spans a boundary. */
class BundleStream {
  private buf = new Uint8Array(0)
  private pos = 0
  private done = false
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>

  constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.reader = reader
  }

  private async fill(): Promise<void> {
    const { done, value } = await this.reader.read()
    if (done) {
      this.done = true
      return
    }
    const avail = this.buf.length - this.pos
    const next = new Uint8Array(avail + value.length)
    next.set(this.buf.subarray(this.pos), 0)
    next.set(value, avail)
    this.buf = next
    this.pos = 0
  }

  /** readBytes returns exactly n bytes (throwing if the stream ends first) and calls onChunk with
   * the bytes read so far as they arrive. */
  async readBytes(n: number, onChunk?: (bytes: Uint8Array, loaded: number) => void): Promise<Uint8Array> {
    const out = new Uint8Array(n)
    let written = 0
    while (written < n) {
      if (this.pos >= this.buf.length) {
        if (this.done) throw new Error('bundle stream ended early')
        await this.fill()
      }
      const take = Math.min(this.buf.length - this.pos, n - written)
      out.set(this.buf.subarray(this.pos, this.pos + take), written)
      this.pos += take
      written += take
      if (onChunk) onChunk(out.subarray(0, written), written)
    }
    return out
  }
}

export function createMeshBatcher(opts: {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  schedule?: (fn: () => void) => unknown
  maxEntries?: number
  maxInflight?: number
}): MeshBatcher {
  const schedule = opts.schedule ?? ((fn: () => void) => setTimeout(fn, 0))
  const maxEntries = opts.maxEntries ?? 64
  const maxInflight = opts.maxInflight ?? 4

  let pending: Entry[] = []
  let queue: Entry[][] = []
  let inflight = 0
  let flushScheduled = false

  function abortError(): DOMException {
    return new DOMException('Aborted', 'AbortError')
  }

  function notFoundError(status: number): BatcherApiError {
    return { code: '', message: `HTTP ${status}`, retryable: false, status }
  }

  function settle(e: Entry, buffer: ArrayBuffer | null, err: unknown): void {
    if (e.settled) return
    e.settled = true
    if (err) e.reject(err)
    else e.resolve(buffer as ArrayBuffer)
  }

  function onEntryAbort(e: Entry): void {
    e.aborted = true
    settle(e, null, abortError())
    if (e.controller && e.bundle && e.bundle.every((b) => b.aborted)) e.controller.abort()
  }

  function pump(): void {
    while (inflight < maxInflight && queue.length > 0) {
      const bundle = queue.shift() as Entry[]
      const active = bundle.filter((b) => !b.aborted)
      if (active.length === 0) continue
      sendBundle(active)
    }
  }

  function flush(): void {
    flushScheduled = false
    if (pending.length === 0) return
    const batch = pending
    pending = []
    for (let i = 0; i < batch.length; i += maxEntries) {
      const bundle = batch.slice(i, i + maxEntries)
      if (inflight < maxInflight) sendBundle(bundle)
      else queue.push(bundle)
    }
  }

  function sendBundle(bundle: Entry[]): void {
    inflight++
    const controller = new AbortController()
    for (const e of bundle) {
      e.controller = controller
      e.bundle = bundle
      e.signal.addEventListener('abort', () => onEntryAbort(e), { once: true })
    }
    const start = now()
    let bytes = 0
    void opts
      .fetch(resolve('/api/bundle'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: bundle.map((e) => e.entry) }),
        signal: controller.signal,
      })
      .then(async (response) => {
        if (!response.ok) {
          // A failed bundle request rejects all of its entries.
          for (const e of bundle) settle(e, null, notFoundError(response.status))
          return
        }
        if (!response.body) {
          for (const e of bundle) settle(e, null, notFoundError(500))
          return
        }
        const stream = new BundleStream(response.body.getReader())
        for (const e of bundle) {
          const lenBytes = await stream.readBytes(4)
          const headerLen = new DataView(lenBytes.buffer, lenBytes.byteOffset, 4).getUint32(0, true)
          const header = JSON.parse(new TextDecoder().decode(await stream.readBytes(headerLen))) as {
            file: string
            status: number
            size: number
          }
          const data =
            header.size > 0
              ? await stream.readBytes(header.size, (_bytes, loaded) => {
                  if (!e.aborted) e.onProgress(loaded, header.size)
                })
              : new Uint8Array(0)
          bytes += header.size
          if (header.status === 200) {
            if (!e.aborted) {
              measureSince('download', e.started, { path: e.path, bytes: header.size })
              settle(e, data.buffer as ArrayBuffer, null)
            }
          } else {
            // A 404 entry rejects only itself, with the kind of error a single GET would throw.
            if (!e.aborted) settle(e, null, notFoundError(header.status))
          }
        }
      })
      .catch((err: unknown) => {
        // The fetch failed (network, or aborted): reject every unsettled entry.
        for (const e of bundle) settle(e, null, err instanceof DOMException && err.name === 'AbortError' ? abortError() : notFoundError(500))
      })
      .finally(() => {
        inflight--
        measureSince('bundle', start, { entries: bundle.length, bytes })
        pump()
      })
  }

  return {
    request(path, onProgress, signal) {
      return new Promise<ArrayBuffer>((resolvePromise, rejectPromise) => {
        const e: Entry = {
          path,
          entry: libraryEntryOf(path),
          signal,
          onProgress,
          resolve: resolvePromise,
          reject: rejectPromise,
          started: now(),
          aborted: false,
          settled: false,
        }
        if (signal.aborted) {
          e.aborted = true
          rejectPromise(abortError())
          return
        }
        signal.addEventListener('abort', () => onEntryAbort(e), { once: true })
        pending.push(e)
        if (!flushScheduled) {
          flushScheduled = true
          schedule(flush)
        }
      })
    },
  }
}
