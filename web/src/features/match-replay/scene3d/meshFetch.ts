// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * meshFetch.ts — LE TÉLÉCHARGEMENT DU MAILLAGE 3D, lu en flux pour en dire la progression.
 *
 * Le fichier pèse des centaines de Mio : la vue affiche la part reçue. Il passe par le client
 * d'API (en-têtes de titre et de langue, cookies, mapping d'erreurs), jamais par un `fetch` nu.
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
  // Taille annoncée : un seul tampon rempli au fil des morceaux, sans recopie finale. Un corps
  // qui la dépasse retombe sur la liste de morceaux.
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
