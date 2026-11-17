/**
 * bvhCache.test.ts — the sidecar's round trip (build, serialize, deserialize onto a fresh
 * geometry, raycast matches) and its fallbacks (a mismatched geometry, a corrupt file).
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'

import { BVH_BUILD_OPTIONS, deserializeBVHCache, serializeBVHCache } from './bvhCache'

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
THREE.Mesh.prototype.raycast = acceleratedRaycast

/** A 2x2 quad on the XZ plane at y = 0, two triangles, built the way `computeBoundsTree` expects
 *  (an owned index, not shared with another geometry). */
function quadGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3))
  geometry.setIndex([0, 2, 1, 0, 3, 2])
  return geometry
}

/** A geometry with the same vertex data as `source` but an index deliberately wrong (all zeros):
 *  only a successful `deserializeBVHCache` restore (which overwrites it, per `MeshBVH.deserialize`'s
 *  `setIndex`) makes it raycast the same as `source`. */
function freshCopyWithWrongIndex(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', (source.getAttribute('position') as THREE.BufferAttribute).clone())
  const count = source.getIndex()!.count
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(count), 1))
  return geometry
}

function downRay(x: number, z: number): THREE.Ray {
  return new THREE.Ray(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0))
}

function raycastHit(geometry: THREE.BufferGeometry, ray: THREE.Ray): THREE.Intersection | null {
  // Double-sided: the test only cares that two geometries with the same data hit the same
  // point, never about this quad's winding order.
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  const intersects: THREE.Intersection[] = []
  const raycaster = new THREE.Raycaster(ray.origin, ray.direction, 0, 100)
  mesh.raycast(raycaster, intersects)
  return intersects[0] ?? null
}

/** Rewrites the sidecar's JSON header in place (same binary payload, same offsets), for the
 *  mismatch tests: only metadata fields move, never the spans that locate the buffers. */
function withPatchedHeader(buffer: ArrayBuffer, patch: (header: Record<string, unknown>) => void): ArrayBuffer {
  const headerLen = new DataView(buffer).getUint32(0, true)
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLen))) as Record<string, unknown>
  patch(header)
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const payload = new Uint8Array(buffer, 4 + headerLen)
  const out = new Uint8Array(4 + headerBytes.byteLength + payload.byteLength)
  new DataView(out.buffer).setUint32(0, headerBytes.byteLength, true)
  out.set(headerBytes, 4)
  out.set(payload, 4 + headerBytes.byteLength)
  return out.buffer
}

describe('serializeBVHCache / deserializeBVHCache', () => {
  it('round-trips: a raycast on the restored geometry matches the original', () => {
    const original = quadGeometry()
    original.computeBoundsTree(BVH_BUILD_OPTIONS)
    const ray = downRay(0, 0)
    const expected = raycastHit(original, ray)
    expect(expected).not.toBeNull()

    const packed = serializeBVHCache([original])

    const restored = freshCopyWithWrongIndex(original)
    // Before restoring, the wrong index gives a different (or no) hit: proves the restore, not
    // the shared vertex data, is what produces the matching hit below.
    expect(raycastHit(restored, ray)).not.toEqual(expected)

    const ok = deserializeBVHCache(packed, [restored])
    expect(ok).toBe(true)
    expect(restored.boundsTree).toBeTruthy()

    const actual = raycastHit(restored, ray)
    expect(actual).not.toBeNull()
    expect(actual!.point.toArray()).toEqual(expected!.point.toArray())
    expect(actual!.distance).toBeCloseTo(expected!.distance, 6)

    original.disposeBoundsTree()
    restored.disposeBoundsTree?.()
  })

  it('refuses a geometry-count mismatch, touching nothing', () => {
    const geometry = quadGeometry()
    geometry.computeBoundsTree(BVH_BUILD_OPTIONS)
    const packed = serializeBVHCache([geometry])
    geometry.disposeBoundsTree()

    const a = freshCopyWithWrongIndex(geometry)
    const b = freshCopyWithWrongIndex(geometry)
    const ok = deserializeBVHCache(packed, [a, b])
    expect(ok).toBe(false)
    expect(a.boundsTree).toBeFalsy()
    expect(b.boundsTree).toBeFalsy()
  })

  it('refuses a vertex-count mismatch (the header says a different geometry)', () => {
    const geometry = quadGeometry()
    geometry.computeBoundsTree(BVH_BUILD_OPTIONS)
    const packed = serializeBVHCache([geometry])
    geometry.disposeBoundsTree()
    const tampered = withPatchedHeader(packed, (header) => {
      const geoms = header.geometries as Array<Record<string, unknown>>
      geoms[0].vertexCount = (geoms[0].vertexCount as number) + 1
    })

    const target = freshCopyWithWrongIndex(geometry)
    const ok = deserializeBVHCache(tampered, [target])
    expect(ok).toBe(false)
    expect(target.boundsTree).toBeFalsy()
  })

  it('refuses a different library version (a library upgrade must miss)', () => {
    const geometry = quadGeometry()
    geometry.computeBoundsTree(BVH_BUILD_OPTIONS)
    const packed = serializeBVHCache([geometry])
    geometry.disposeBoundsTree()
    const tampered = withPatchedHeader(packed, (header) => {
      header.libraryVersion = '0.0.0-older'
    })

    const target = freshCopyWithWrongIndex(geometry)
    expect(deserializeBVHCache(tampered, [target])).toBe(false)
    expect(target.boundsTree).toBeFalsy()
  })

  it('falls back on a corrupt or truncated file without throwing', () => {
    const geometry = quadGeometry()
    const target = freshCopyWithWrongIndex(geometry)

    expect(() => deserializeBVHCache(new ArrayBuffer(0), [target])).not.toThrow()
    expect(deserializeBVHCache(new ArrayBuffer(0), [target])).toBe(false)

    const garbage = new Uint8Array(64)
    garbage.set([255, 255, 255, 255]) // a header length far larger than the buffer
    expect(deserializeBVHCache(garbage.buffer, [target])).toBe(false)

    const notJson = new Uint8Array(20)
    new DataView(notJson.buffer).setUint32(0, 10, true)
    notJson.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)
    expect(deserializeBVHCache(notJson.buffer, [target])).toBe(false)

    expect(target.boundsTree).toBeFalsy()
  })
})
