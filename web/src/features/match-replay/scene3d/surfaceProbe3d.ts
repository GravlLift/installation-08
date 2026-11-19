// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * surfaceProbe3d.ts — THE SURFACE INSPECTOR of the 3D view (a developer tool): the map's surface
 * under the pointer, with the game material that draws it.
 *
 * `loadMapModel` (and `loadLayerModel`, for variant objects) replaces the GLB's materials with
 * the view's own; before that, on every mesh, it deposits the game material's name
 * (`mat_<GlobalID>`), its shader, and the chosen family (`tagSurface`). The inspector rereads
 * that deposit on the closest visible surface. On the objects layer, merged by material, it also
 * names the object hit, through the table the GLB publishes.
 */
import * as THREE from 'three'

export interface SurfaceTag {
  /** The material's name in the GLB: `mat_<GlobalID>` from the game's `mat ` tag. */
  material: string
  /** The material's shader GlobalID (hex), null if the GLB does not carry one. */
  shader: string | null
  /** The view's family: structure, decor, or see-through. */
  family: string
}

/** A variant object: its rank in the `.mvar` and its type. */
export interface ProbedObject {
  index: number
  type: number
}

export interface SurfaceProbe extends SurfaceTag {
  /** Hit point, in game coordinates (x, y on the ground, z up). */
  halo: [number, number, number]
  /** The variant object hit, null outside the objects layer. */
  object: ProbedObject | null
}

/** A layer's placed object, as the GLB publishes it (`scenes[0].extras.levelupObjects`, game axes). */
export interface PlacedObject extends ProbedObject {
  min: [number, number, number]
  max: [number, number, number]
}

const KEY = 'surface'
const OBJECTS_KEY = 'levelupObjects'
// The hit point is on an object's surface: its box contains it, within the vertices' rounding.
const BOX_SLACK = 0.02

/** tagSurface deposits on the mesh the game material that draws it. */
export function tagSurface(mesh: THREE.Mesh, source: THREE.Material, shader: number | undefined, family: string): void {
  const tag: SurfaceTag = { material: source.name, shader: shader === undefined ? null : shader.toString(16).padStart(8, '0'), family }
  mesh.userData[KEY] = tag
}

/** surfaceFamily: the view's family deposited on the mesh (`tagSurface`), null if it carries none. */
export function surfaceFamily(mesh: THREE.Object3D): string | null {
  return (mesh.userData[KEY] as SurfaceTag | undefined)?.family ?? null
}

const drawers = new WeakMap<THREE.Object3D, THREE.Object3D[]>()

/**
 * markDrawnBy: the surface tagged `mesh`, hidden, is drawn by `drawer` (a merged mesh that does
 * not respond to rays); the inspector deems it visible when its first drawer is. A surface split
 * between probes is drawn by several, one per part: each call adds one.
 */
export function markDrawnBy(mesh: THREE.Object3D, drawer: THREE.Object3D): void {
  const list = drawers.get(mesh)
  if (!list) drawers.set(mesh, [drawer])
  else if (!list.includes(drawer)) list.push(drawer)
}

/** drawnBy — the (first) merged mesh that draws the hidden surface `mesh` (`markDrawnBy`), null if it draws itself. */
export function drawnBy(mesh: THREE.Object3D): THREE.Object3D | null {
  return drawers.get(mesh)?.[0] ?? null
}

/** drawersOf — every mesh that draws a part of the hidden surface `mesh`; empty if it draws itself. */
export function drawersOf(mesh: THREE.Object3D): readonly THREE.Object3D[] {
  return drawers.get(mesh) ?? []
}

/**
 * clearDrawnBy undoes `markDrawnBy`: `mesh` draws itself again. `batchLayer`'s `dispose()` calls
 * this for every surface it had hidden into a batch/instance, so a session-cached layer root a
 * later match reattaches is exactly as `batchLayer` would find a fresh one — without it, a surface
 * hidden once stays `!visible` forever (`candidate` in `layerBatch3d.ts` skips an already-hidden
 * mesh), so it is never regrouped and never drawn again on a reused layer.
 */
export function clearDrawnBy(mesh: THREE.Object3D): void {
  drawers.delete(mesh)
}

function visible(o: THREE.Object3D): boolean {
  const drawn = drawers.get(o)?.[0] ?? o
  for (let n: THREE.Object3D | null = drawn; n; n = n.parent) if (!n.visible) return false
  return true
}

/** inObjectLayer — whether `o` belongs to a layer of placed objects (the match's Forge variant layer). */
export function inObjectLayer(o: THREE.Object3D): boolean {
  return placedObjects(o) !== null
}

/** placedObjects returns the object table of the layer carrying `o`, null outside an objects layer. */
function placedObjects(o: THREE.Object3D): readonly PlacedObject[] | null {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    const objects = n.userData[OBJECTS_KEY] as PlacedObject[] | undefined
    if (Array.isArray(objects)) return objects
  }
  return null
}

/** objectAt returns the object whose box contains point `p` (game axes), the smallest if they nest. */
export function objectAt(objects: readonly PlacedObject[], p: readonly [number, number, number]): ProbedObject | null {
  let best: PlacedObject | null = null
  let bestVolume = Infinity
  for (const o of objects) {
    if (![0, 1, 2].every((a) => p[a] >= o.min[a] - BOX_SLACK && p[a] <= o.max[a] + BOX_SLACK)) continue
    const volume = (o.max[0] - o.min[0]) * (o.max[1] - o.min[1]) * (o.max[2] - o.min[2])
    if (volume < bestVolume) {
      best = o
      bestVolume = volume
    }
  }
  return best && { index: best.index, type: best.type }
}

/**
 * probeSurface returns the first visible surface under screen point `ndc`, among `roots` (the
 * map and the layers placed on it), with the variant object that carries it.
 */
export function probeSurface(roots: readonly THREE.Object3D[], camera: THREE.Camera, ndc: THREE.Vector2): SurfaceProbe | null {
  const ray = new THREE.Raycaster()
  ray.setFromCamera(ndc, camera)
  for (const hit of ray.intersectObjects([...roots], true)) {
    const tag = hit.object.userData[KEY] as SurfaceTag | undefined
    if (!tag || !visible(hit.object)) continue
    // three.js has the Y axis up: the game is (x, -z, y).
    const halo: [number, number, number] = [hit.point.x, -hit.point.z, hit.point.y]
    const objects = placedObjects(hit.object)
    return { ...tag, halo, object: objects && objectAt(objects, halo) }
  }
  return null
}

/** formatProbe: the line copied to the clipboard. */
export function formatProbe(p: SurfaceProbe): string {
  const at = p.halo.map((v) => v.toFixed(2)).join(', ')
  const object = p.object ? ` object #${p.object.index} type ${p.object.type}` : ''
  return `${p.material} shader ${p.shader ?? '?'} ${p.family} @ (${at})${object}`
}
