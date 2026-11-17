// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * meshFetch.ts — THE 3D MESH DOWNLOAD, read as a stream to report its progress.
 *
 * The file weighs hundreds of MiB: the view shows the share received. It goes through the API
 * client (title/language headers, cookies, error mapping), never through a bare `fetch`.
 */
import { api } from '@/lib/api/client'

import { measureSince, now } from './perf3d'
import { createMeshBatcher, isLibraryFile, type MeshBatcher } from './meshFetchBatcher'

// The library files are batched; everything else (the map, the variant, the index files) stays a
// single request. The batcher is a module-level singleton, swappable in tests.
let batcher: MeshBatcher = createMeshBatcher({ fetch: (url, init) => fetch(url, init) })

/** setMeshBatcher swaps the batcher (tests). */
export function setMeshBatcher(b: MeshBatcher): void {
  batcher = b
}

/** resetMeshBatcher restores a fresh default batcher (tests). */
export function resetMeshBatcher(): void {
  batcher = createMeshBatcher({ fetch: (url, init) => fetch(url, init) })
}

export async function fetchMesh(
  path: string,
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  if (isLibraryFile(path)) return batcher.request(path, onProgress, signal)
  const start = now()
  const buffer = await download(path, onProgress, signal)
  measureSince('download', start, { path, bytes: buffer.byteLength })
  return buffer
}

async function download(
  path: string,
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const response = await api.getResponse(path, { signal })
  const total = Number(response.headers.get('Content-Length') ?? 0)
  if (!response.body) return response.arrayBuffer()
  // Announced size: a single buffer filled as chunks arrive, with no final copy. A body that
  // exceeds it falls back to the chunk list.
  let out: Uint8Array<ArrayBuffer> | null = total > 0 ? new Uint8Array(total) : null
  const chunks: Uint8Array[] = []
  let loaded = 0
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (out && loaded + value.length <= total) {
      out.set(value, loaded)
    } else {
      if (out) chunks.push(out.subarray(0, loaded))
      out = null
      chunks.push(value)
    }
    loaded += value.length
    onProgress(loaded, total)
  }
  if (out) return loaded === total ? out.buffer : out.slice(0, loaded).buffer
  const merged = new Uint8Array(loaded)
  let at = 0
  for (const c of chunks) {
    merged.set(c, at)
    at += c.length
  }
  return merged.buffer
}
