// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * bvhCache.ts — serializes and restores the ray index (`three-mesh-bvh`) that `mapModel.ts` builds
 * for the map and the variant layer, so a later load can read it back instead of rebuilding it.
 *
 * Format: a 4-byte little-endian length, a UTF-8 JSON header of that length (format version,
 * `three-mesh-bvh` version, build options, and per-geometry counts and buffer offsets), then the
 * concatenated binary buffers the header's offsets point into. `three-mesh-bvh`'s own
 * `MeshBVH.serialize`/`deserialize` do the real work; this module only packs their output into one
 * file and validates it is still the right one before trusting it.
 */
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'

/** The sidecar file's own format, bumped when this module's layout changes (never the library's). */
const SIDECAR_FORMAT_VERSION = 1

/**
 * The installed `three-mesh-bvh` version (see `web/package.json`'s `three-mesh-bvh` dependency):
 * bump this string whenever that version changes, so an index built by an older library never
 * loads as if it were the current one (the packed node layout is a library implementation detail).
 */
export const THREE_MESH_BVH_VERSION = '0.8.3'

/** The build options `indexSurfaces` passes to `computeBoundsTree`; part of the cache key, since a
 *  different leaf size packs a different tree for the same geometry. */
export const BVH_BUILD_OPTIONS = { maxLeafTris: 100 } as const

interface BufferSpan {
  offset: number
  length: number
}

interface GeometryHeader {
  vertexCount: number
  indexCount: number
  /** 2 (Uint16Array) or 4 (Uint32Array): the index buffer's element width, checked so a `.set()`
   *  across mismatched widths never silently miscopies values. */
  indexBytesPerElement: number
  roots: BufferSpan[]
  index: BufferSpan | null
  indirect: BufferSpan | null
}

interface SidecarHeader {
  version: number
  libraryVersion: string
  buildOptions: typeof BVH_BUILD_OPTIONS
  geometries: GeometryHeader[]
}

/** The runtime shape of `MeshBVH.serialize`'s result: `indirectBuffer` is real (read by
 *  `deserialize`) but missing from the package's own `.d.ts`. */
interface SerializedBVHData {
  roots: ArrayBuffer[]
  index: (ArrayBufferView & { BYTES_PER_ELEMENT: number }) | null
  indirectBuffer: ArrayBuffer | null
}

function buildOptionsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((k) => a[k] === b[k])
}

/**
 * serializeBVHCache packs the bounds trees of `geometries` (each must already carry one, from
 * `computeBoundsTree`) into one binary file, in the given order. The order is the cache key's
 * other half: `deserializeBVHCache` matches each entry back to `geometries[i]` by position, never
 * by identity, so the caller must traverse the GLB the same deterministic way both times (as
 * `indexSurfaces` does).
 */
export function serializeBVHCache(geometries: readonly THREE.BufferGeometry[]): ArrayBuffer {
  const parts: ArrayBuffer[] = []
  const geomHeaders: GeometryHeader[] = []
  let offset = 0
  const push = (buf: ArrayBuffer): BufferSpan => {
    const span = { offset, length: buf.byteLength }
    parts.push(buf)
    offset += buf.byteLength
    return span
  }
  for (const geometry of geometries) {
    const bvh = geometry.boundsTree
    if (!bvh) throw new Error('bvhCache: geometry has no bounds tree to serialize')
    const data = MeshBVH.serialize(bvh, { cloneBuffers: false }) as unknown as SerializedBVHData
    const position = geometry.getAttribute('position')
    const indexAttr = geometry.getIndex()
    const roots = data.roots.map((root) => push(root))
    let indexSpan: BufferSpan | null = null
    let indexBytesPerElement = 0
    if (data.index) {
      const view = data.index
      const buf = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
      indexSpan = push(buf)
      indexBytesPerElement = view.BYTES_PER_ELEMENT
    }
    const indirectSpan = data.indirectBuffer ? push(data.indirectBuffer) : null
    geomHeaders.push({
      vertexCount: position ? position.count : 0,
      indexCount: indexAttr ? indexAttr.count : 0,
      indexBytesPerElement,
      roots,
      index: indexSpan,
      indirect: indirectSpan,
    })
  }
  const header: SidecarHeader = {
    version: SIDECAR_FORMAT_VERSION,
    libraryVersion: THREE_MESH_BVH_VERSION,
    buildOptions: BVH_BUILD_OPTIONS,
    geometries: geomHeaders,
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const out = new Uint8Array(4 + headerBytes.byteLength + offset)
  new DataView(out.buffer).setUint32(0, headerBytes.byteLength, true)
  out.set(headerBytes, 4)
  let at = 4 + headerBytes.byteLength
  for (const part of parts) {
    out.set(new Uint8Array(part), at)
    at += part.byteLength
  }
  return out.buffer
}

/**
 * deserializeBVHCache restores `buffer` (as `serializeBVHCache` wrote it) onto `geometries`,
 * setting each one's `boundsTree` (and its index attribute's data, which the build reorders — see
 * `MeshBVH.deserialize`'s `setIndex`). Returns false, touching nothing, on anything that does not
 * match exactly: a different format or library version, different build options, a different
 * geometry count, or any geometry whose vertex/index count or index width differs (a rebuilt map,
 * most likely) — the caller falls back to building fresh. Never throws: a corrupt or truncated
 * file also returns false.
 */
export function deserializeBVHCache(buffer: ArrayBuffer, geometries: readonly THREE.BufferGeometry[]): boolean {
  try {
    if (buffer.byteLength < 4) return false
    const headerLen = new DataView(buffer).getUint32(0, true)
    const payloadStart = 4 + headerLen
    if (payloadStart > buffer.byteLength) return false
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLen))) as SidecarHeader
    if (header.version !== SIDECAR_FORMAT_VERSION) return false
    if (header.libraryVersion !== THREE_MESH_BVH_VERSION) return false
    if (!buildOptionsEqual(header.buildOptions, BVH_BUILD_OPTIONS)) return false
    if (header.geometries.length !== geometries.length) return false
    const inBounds = (span: BufferSpan | null) => !span || payloadStart + span.offset + span.length <= buffer.byteLength
    // Validate everything before mutating any geometry: a partial apply would leave some
    // geometries indexed from the cache and others not, worse than ignoring it outright.
    for (let i = 0; i < geometries.length; i++) {
      const g = header.geometries[i]
      const geometry = geometries[i]
      const position = geometry.getAttribute('position')
      const indexAttr = geometry.getIndex()
      if (!position || position.count !== g.vertexCount) return false
      if ((indexAttr ? indexAttr.count : 0) !== g.indexCount) return false
      if (g.index && indexAttr && indexAttr.array.BYTES_PER_ELEMENT !== g.indexBytesPerElement) return false
      if (!g.roots.every(inBounds) || !inBounds(g.index) || !inBounds(g.indirect)) return false
    }
    for (let i = 0; i < geometries.length; i++) {
      const g = header.geometries[i]
      const geometry = geometries[i]
      const roots = g.roots.map((span) => buffer.slice(payloadStart + span.offset, payloadStart + span.offset + span.length))
      const index = g.index
        ? makeIndexArray(buffer.slice(payloadStart + g.index.offset, payloadStart + g.index.offset + g.index.length), g.indexBytesPerElement)
        : null
      const indirectBuffer = g.indirect
        ? buffer.slice(payloadStart + g.indirect.offset, payloadStart + g.indirect.offset + g.indirect.length)
        : null
      const bvh = MeshBVH.deserialize({ roots, index, indirectBuffer } as never, geometry, { setIndex: true })
      geometry.boundsTree = bvh
    }
    return true
  } catch {
    return false
  }
}

function makeIndexArray(buf: ArrayBuffer, bytesPerElement: number): Uint16Array | Uint32Array {
  return bytesPerElement === 2 ? new Uint16Array(buf) : new Uint32Array(buf)
}
