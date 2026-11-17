/**
 * bvhWorker3d.ts — builds the ray index (a three-mesh-bvh MeshBVH) on a worker thread so the main
 * thread stays free while the sort runs. `buildBoundsTree` resolves with the tree assigned to
 * geometry.boundsTree; where no Worker is available (test environments) it falls back to the
 * synchronous builder, giving the same result on the same thread.
 */
import type { MeshBVH } from 'three-mesh-bvh'
import type { BufferGeometry } from 'three'
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js'

let worker: GenerateMeshBVHWorker | null = null

function getWorker(): GenerateMeshBVHWorker {
  if (!worker) worker = new GenerateMeshBVHWorker()
  return worker
}

/**
 * Builds `geometry`'s ray index and assigns it to geometry.boundsTree. When a Worker is available
 * the build runs off the main thread and the geometry's position and index buffers are restored
 * before it resolves; otherwise it builds synchronously on this thread.
 */
export function buildBoundsTree(geometry: BufferGeometry, options: { maxLeafTris: number }): Promise<MeshBVH> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(geometry.computeBoundsTree(options))
  }
  return getWorker().generate(geometry, options).then((bvh) => {
    geometry.boundsTree = bvh
    return bvh
  })
}
