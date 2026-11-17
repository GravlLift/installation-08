/**
 * Type declarations for the three-mesh-bvh worker builder, which the package ships without a .d.ts.
 */
declare module 'three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js' {
  import type { BufferGeometry } from 'three'
  import type { MeshBVH } from 'three-mesh-bvh'

  export class GenerateMeshBVHWorker {
    constructor()
    generate(geometry: BufferGeometry, options?: object): Promise<MeshBVH>
    dispose(): void
  }
}
