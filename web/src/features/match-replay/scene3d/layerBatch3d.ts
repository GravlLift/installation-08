// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * layerBatch3d.ts — THE VARIANT LAYER'S SURFACES IN A FEW DRAW CALLS.
 *
 * A variant layer is thousands of placed Forge objects, each its own node and transform: Fortress
 * draws 4650 placements (5150 surfaces, 16.1M triangles) from 673 meshes, plus one back-face mesh per
 * placement (`backFaces3d`). Drawn one by one, that is thousands of draw calls a frame, and the script
 * time to submit them is what makes Fortress slow. `batchLayer` regroups them once the layer is posed
 * and lit (after the probes chose each surface's material):
 *
 *  - a surface whose material leaves room for two more textures (the merged layered materials, made
 *    two arrays short for this, `BATCHED_LIMITS`; the plain family materials; the back faces) goes into
 *    a `THREE.BatchedMesh` with every surface of the same material: one multi-draw per material, each
 *    placement still frustum culled and sorted front to back;
 *  - a surface on a classic layered material (cutouts, compositions the arrays refused: thirteen
 *    samplers, no room left) shares a `THREE.InstancedMesh` with the placements of the same mesh and
 *    material: one draw per pair, culled as a whole (a single placement too: a material drawn both
 *    instanced and not would switch programs at every draw);
 *  - anything else (transparent, multi-material, ordered) stays as it is.
 *
 * Off by default, a batch can also leave out the placements wholly past the fog (`fogCullDistance`,
 * `batchCulling.fog`, the console's `fogCull` knob): beyond it the haze covers a surface to within
 * half a color level (three's fog, like the far plane, measures depth along the view axis). It is not
 * invisible: a fogged object still stands out against the sky in the haze's color, and culled, the
 * sky shows instead. The camera's far plane stays (the sky needs it).
 *
 * The original surfaces stay in the layer, hidden: they keep the ray index (ground, bodies, reticle),
 * the inspector's tag (`markDrawnBy`, so the inspector and the top-down rules follow the batch) and
 * their materials (probes, reflections, game light apply to the shared material). The batches answer
 * no ray. Every surface's vertices are copied compacted into its batch (the GLB's surfaces share large
 * vertex buffers), only the attributes its material reads.
 */
import * as THREE from 'three'

import { BACK_FACE_NAME } from './backFaces3d'
import { isMergedMaterial } from './layeredArrays3d'
import { clearDrawnBy, drawnBy, markDrawnBy, surfaceFamily } from './surfaceProbe3d'

/** The attributes a merged layered material reads (`layeredArrays3d`). */
const MERGED_ATTRIBUTES = ['position', 'cMacro', 'cUv', 'cRow']
/** What the fog leaves of a surface at the cull distance: under half an 8-bit color level. */
const FOG_RESIDUAL = 1 / 1024

/**
 * fogCullDistance — the view depth (u) past which `fog` leaves less than FOG_RESIDUAL of a surface's
 * color; null without fog (top-down renders, probe captures) or with a fog that never closes.
 */
export function fogCullDistance(fog: THREE.Fog | THREE.FogExp2 | null): number | null {
  if (!fog) return null
  if ((fog as THREE.FogExp2).isFogExp2) {
    const density = (fog as THREE.FogExp2).density
    return density > 0 ? Math.sqrt(Math.log(1 / FOG_RESIDUAL)) / density : null
  }
  return (fog as THREE.Fog).far > 0 ? (fog as THREE.Fog).far : null
}

/** The batches' optional culling: `fog`, the fog distance (see the header). */
export const batchCulling = { fog: false }

const cullCamera = new THREE.PerspectiveCamera()

/** cullCameraOf: camera with its far plane at the fog's cull distance, for a batch's culling; the camera itself when that would not cut. */
function cullCameraOf(scene: THREE.Scene | null, camera: THREE.Camera): THREE.Camera {
  const p = camera as THREE.PerspectiveCamera
  const far = scene && batchCulling.fog ? fogCullDistance(scene.fog as THREE.Fog | THREE.FogExp2 | null) : null
  if (!p.isPerspectiveCamera || far === null || far >= p.far || far <= p.near) return camera
  const c = cullCamera
  c.fov = p.fov
  c.aspect = p.aspect
  c.near = p.near
  c.far = far
  c.zoom = p.zoom
  c.filmGauge = p.filmGauge
  c.filmOffset = p.filmOffset
  c.view = p.view
  c.updateProjectionMatrix()
  c.matrixWorld.copy(p.matrixWorld)
  c.matrixWorldInverse.copy(p.matrixWorldInverse)
  return c
}

/** The name of the batches, for the console and the scene graph. */
export const LAYER_BATCH_NAME = 'calque-lot'

export interface LayerBatches {
  /** The batches and instanced meshes posed under the layer's root. */
  meshes: THREE.Mesh[]
  /** Surfaces now drawn by a batch or an instanced mesh. */
  batched: number
  /** Draw objects before and after (surfaces left alone count once each). */
  before: number
  after: number
  dispose(): void
}

type Kind = 'batch' | 'instance'

/** A surface the pass may regroup: visible, simple, indexed, opaque, in the default order. */
function candidate(o: THREE.Object3D): o is THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  const mesh = o as THREE.Mesh
  if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || (mesh as THREE.BatchedMesh).isBatchedMesh) return false
  if (!mesh.visible || drawnBy(mesh) || mesh.renderOrder !== 0 || Array.isArray(mesh.material)) return false
  const m = mesh.material
  // Shadow proxies (`shadowProxy3d`) write no color and draw nothing outside the shadow pass.
  if (!m.visible || m.transparent || !m.colorWrite) return false
  return mesh.geometry.index !== null && mesh.geometry.getAttribute('position') !== undefined
}

/** visibleInTree: the mesh and all its ancestors up to `root` are visible (hidden `ombre*` nodes stay out). */
function visibleInTree(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n && n !== root; n = n.parent) if (!n.visible) return false
  return true
}

/** kindOf: how a surface's material is regrouped (see the header). */
export function kindOf(material: THREE.Material, isBackFace: boolean): Kind {
  if (isBackFace || isMergedMaterial(material)) return 'batch'
  const textures = material.userData?.textures
  return Array.isArray(textures) && textures.length > 0 ? 'instance' : 'batch'
}

/** drawnAttributes: the attributes a batch copies for a surface (what its material reads). */
function drawnAttributes(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>, isBackFace: boolean): string[] {
  if (isBackFace) return ['position']
  if (isMergedMaterial(mesh.material)) return MERGED_ATTRIBUTES
  return Object.keys(mesh.geometry.attributes).sort()
}

function attributeSignature(g: THREE.BufferGeometry, names: readonly string[]): string | null {
  const parts: string[] = []
  for (const name of names) {
    const a = g.getAttribute(name)
    if (!a) return null
    const array = (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (a as THREE.InterleavedBufferAttribute).data.array : (a as THREE.BufferAttribute).array
    parts.push(`${name}:${a.itemSize}:${a.normalized}:${array.constructor.name}`)
  }
  return parts.join(',')
}

/**
 * compactGeometry: a geometry holding only the vertices `g`'s index references, with the attributes
 * `names` (same item size, type and normalization), its index renumbered.
 */
export function compactGeometry(g: THREE.BufferGeometry, names: readonly string[]): THREE.BufferGeometry {
  const index = g.index as THREE.BufferAttribute
  const remap = new Map<number, number>()
  const order: number[] = []
  const out = new Uint32Array(index.count)
  for (let i = 0; i < index.count; i++) {
    const v = index.getX(i)
    let n = remap.get(v)
    if (n === undefined) {
      n = order.length
      remap.set(v, n)
      order.push(v)
    }
    out[i] = n
  }
  const compact = new THREE.BufferGeometry()
  for (const name of names) {
    const a = g.getAttribute(name)
    const source = (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (a as THREE.InterleavedBufferAttribute).data.array : (a as THREE.BufferAttribute).array
    const Ctor = source.constructor as new (n: number) => THREE.TypedArray
    const array = new Ctor(order.length * a.itemSize)
    for (let i = 0; i < order.length; i++) for (let c = 0; c < a.itemSize; c++) array[i * a.itemSize + c] = a.getComponent(order[i], c)
    compact.setAttribute(name, new THREE.BufferAttribute(array, a.itemSize, a.normalized))
  }
  compact.setIndex(new THREE.BufferAttribute(order.length > 65535 ? out : new Uint16Array(out), 1))
  return compact
}

interface Member {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>
  names: string[]
}

/**
 * batchLayer regroups the surfaces under `root` (a posed, lit variant layer; see the header) and
 * writes one console line; the result's `dispose` removes and frees the batches.
 */
export function batchLayer(root: THREE.Object3D): LayerBatches {
  const start = performance.now()
  root.updateMatrixWorld(true)
  const toRoot = root.matrixWorld.clone().invert()
  const groups = new Map<string, { kind: Kind; members: Member[] }>()
  let before = 0
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !visibleInTree(mesh, root)) return
    before++
    if (!candidate(mesh)) return
    const isBackFace = mesh.name === BACK_FACE_NAME
    const kind = kindOf(mesh.material, isBackFace)
    const names = drawnAttributes(mesh, isBackFace)
    const signature = attributeSignature(mesh.geometry, names)
    if (signature === null) return
    // A batch draws many meshes of one material; an instanced mesh, one mesh's placements.
    const key = `${kind}|${mesh.material.uuid}|${kind === 'instance' ? mesh.geometry.uuid : signature}|${surfaceFamily(mesh)}|${mesh.castShadow}|${mesh.receiveShadow}|${isBackFace}`
    const group = groups.get(key) ?? groups.set(key, { kind, members: [] }).get(key)!
    group.members.push({ mesh, names })
  })
  const meshes: THREE.Mesh[] = []
  const hidden: THREE.Mesh[] = [] // every original surface this pass hides, so `dispose` can undo it
  const compacted = new Map<string, THREE.BufferGeometry>()
  const matrix = new THREE.Matrix4()
  let batched = 0
  for (const { kind, members } of groups.values()) {
    const first = members[0].mesh
    let drawer: THREE.Mesh
    if (kind === 'batch') {
      const geometries = new Map<THREE.BufferGeometry, THREE.BufferGeometry>()
      for (const { mesh, names } of members) {
        if (geometries.has(mesh.geometry)) continue
        const key = `${mesh.geometry.uuid}|${names.join(',')}`
        const c = compacted.get(key) ?? compacted.set(key, compactGeometry(mesh.geometry, names)).get(key)!
        geometries.set(mesh.geometry, c)
      }
      let vertices = 0
      let indices = 0
      for (const c of geometries.values()) {
        vertices += c.getAttribute('position').count
        indices += (c.index as THREE.BufferAttribute).count
      }
      const batch = new THREE.BatchedMesh(members.length, vertices, indices, first.material)
      const ids = new Map<THREE.BufferGeometry, number>()
      for (const [g, c] of geometries) ids.set(g, batch.addGeometry(c))
      for (const { mesh } of members) {
        const id = batch.addInstance(ids.get(mesh.geometry) as number)
        batch.setMatrixAt(id, matrix.multiplyMatrices(toRoot, mesh.matrixWorld))
      }
      // Culled against the fog's distance as well as the view (the shadow pass passes no scene: unchanged).
      const cull = batch.onBeforeRender.bind(batch)
      batch.onBeforeRender = (renderer, scene, camera, geometry, material, group) => cull(renderer, scene, cullCameraOf(scene, camera), geometry, material, group)
      drawer = batch
    } else {
      const inst = new THREE.InstancedMesh(first.geometry, first.material, members.length)
      members.forEach(({ mesh }, i) => inst.setMatrixAt(i, matrix.multiplyMatrices(toRoot, mesh.matrixWorld)))
      inst.instanceMatrix.needsUpdate = true
      inst.computeBoundingSphere()
      inst.computeBoundingBox()
      drawer = inst
    }
    const isBackFace = first.name === BACK_FACE_NAME
    drawer.name = isBackFace ? BACK_FACE_NAME : LAYER_BATCH_NAME
    drawer.castShadow = first.castShadow
    drawer.receiveShadow = first.receiveShadow
    drawer.raycast = () => {}
    if (first.userData.noOutline) drawer.userData.noOutline = true
    root.add(drawer)
    meshes.push(drawer)
    for (const { mesh } of members) {
      mesh.visible = false
      markDrawnBy(mesh, drawer)
      hidden.push(mesh)
    }
    batched += members.length
  }
  for (const c of compacted.values()) c.dispose()
  const after = before - batched + meshes.length
  const kinds = meshes.reduce((n, m) => n + ((m as THREE.BatchedMesh).isBatchedMesh ? 1 : 0), 0)
  console.info(`rejeu 3D : lots du calque, ${before} maillages -> ${after} (${kinds} lots, ${meshes.length - kinds} instanciés, ${before - batched} seuls), ${Math.round(performance.now() - start)} ms`)
  return {
    meshes,
    batched,
    before,
    after,
    dispose() {
      for (const m of meshes) {
        m.removeFromParent()
        if ((m as THREE.BatchedMesh).isBatchedMesh) (m as THREE.BatchedMesh).dispose()
        else (m as THREE.InstancedMesh).dispose()
      }
      // Undo exactly what this pass did to the original surfaces (see the module header and
      // `clearDrawnBy`'s own doc): a layer root released back to the session cache must come back
      // to a later `batchLayer` call looking as it would right after loading, not with everything
      // this pass batched stuck invisible and un-candidate forever.
      for (const m of hidden) {
        m.visible = true
        clearDrawnBy(m)
      }
    },
  }
}
