// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * surfaceProbe3d.ts — L'INSPECTEUR DE SURFACES de la vue 3D (poste de développement) : la surface
 * de la carte sous le pointeur, avec le matériau du jeu qui la dessine.
 *
 * `loadMapModel` (et `loadLayerModel`, pour les objets de la variante) remplace les matériaux du
 * GLB par ceux de la vue ; il dépose avant cela, sur
 * chaque maillage, le nom du matériau du jeu (`mat_<GlobalID>`), son shader et la famille retenue
 * (`tagSurface`). L'inspecteur relit ce dépôt sur la surface visible la plus proche. Sur le calque
 * des objets, fondu par matériau, il nomme aussi l'objet touché par la table que le GLB publie.
 */
import * as THREE from 'three'

export interface SurfaceTag {
  /** Nom du matériau dans le GLB : `mat_<GlobalID>` du tag `mat ` du jeu. */
  material: string
  /** GlobalID du shader du matériau (hexadécimal), null si le GLB ne le porte pas. */
  shader: string | null
  /** Famille de la vue : structure, décor ou translucide. */
  family: string
}

/** Un objet de la variante : son rang dans le `.mvar` et son type. */
export interface ProbedObject {
  index: number
  type: number
}

export interface SurfaceProbe extends SurfaceTag {
  /** Point touché, en coordonnées du jeu (x, y au sol, z vers le haut). */
  halo: [number, number, number]
  /** L'objet de la variante touché, null hors du calque des objets. */
  object: ProbedObject | null
}

/** Un objet posé du calque, tel que le GLB le publie (`scenes[0].extras.levelupObjects`, axes du jeu). */
export interface PlacedObject extends ProbedObject {
  min: [number, number, number]
  max: [number, number, number]
}

const KEY = 'surface'
const OBJECTS_KEY = 'levelupObjects'
// Le point touché est sur la surface d'un objet : sa boîte le contient, à l'arrondi des sommets près.
const BOX_SLACK = 0.02

/** tagSurface dépose sur le maillage le matériau du jeu qui le dessine. */
export function tagSurface(mesh: THREE.Mesh, source: THREE.Material, shader: number | undefined, family: string): void {
  const tag: SurfaceTag = { material: source.name, shader: shader === undefined ? null : shader.toString(16).padStart(8, '0'), family }
  mesh.userData[KEY] = tag
}

/** surfaceFamily : la famille de la vue déposée sur le maillage (`tagSurface`), null s'il n'en porte pas. */
export function surfaceFamily(mesh: THREE.Object3D): string | null {
  return (mesh.userData[KEY] as SurfaceTag | undefined)?.family ?? null
}

const drawers = new WeakMap<THREE.Object3D, THREE.Object3D>()

/**
 * markDrawnBy : la surface étiquetée `mesh`, cachée, est dessinée par `drawer` (un maillage fusionné
 * qui ne répond pas aux rayons) ; l'inspecteur la juge visible quand `drawer` l'est.
 */
export function markDrawnBy(mesh: THREE.Object3D, drawer: THREE.Object3D): void {
  drawers.set(mesh, drawer)
}

/** drawnBy — the merged mesh that draws the hidden surface `mesh` (`markDrawnBy`), null if it draws itself. */
export function drawnBy(mesh: THREE.Object3D): THREE.Object3D | null {
  return drawers.get(mesh) ?? null
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
  const drawn = drawers.get(o) ?? o
  for (let n: THREE.Object3D | null = drawn; n; n = n.parent) if (!n.visible) return false
  return true
}

/** inObjectLayer — whether `o` belongs to a layer of placed objects (the match's Forge variant layer). */
export function inObjectLayer(o: THREE.Object3D): boolean {
  return placedObjects(o) !== null
}

/** placedObjects rend la table des objets du calque qui porte `o`, null hors d'un calque d'objets. */
function placedObjects(o: THREE.Object3D): readonly PlacedObject[] | null {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    const objects = n.userData[OBJECTS_KEY] as PlacedObject[] | undefined
    if (Array.isArray(objects)) return objects
  }
  return null
}

/** objectAt rend l'objet dont la boîte contient le point `p` (axes du jeu), le plus petit s'ils s'emboîtent. */
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
 * probeSurface rend la première surface visible sous le point `ndc` de l'écran, parmi `roots` (la
 * carte et les calques posés sur elle), avec l'objet de la variante qui la porte.
 */
export function probeSurface(roots: readonly THREE.Object3D[], camera: THREE.Camera, ndc: THREE.Vector2): SurfaceProbe | null {
  const ray = new THREE.Raycaster()
  ray.setFromCamera(ndc, camera)
  for (const hit of ray.intersectObjects([...roots], true)) {
    const tag = hit.object.userData[KEY] as SurfaceTag | undefined
    if (!tag || !visible(hit.object)) continue
    // three.js a l'axe Y vers le haut : le jeu est (x, -z, y).
    const halo: [number, number, number] = [hit.point.x, -hit.point.z, hit.point.y]
    const objects = placedObjects(hit.object)
    return { ...tag, halo, object: objects && objectAt(objects, halo) }
  }
  return null
}

/** formatProbe : la ligne copiée dans le presse-papiers. */
export function formatProbe(p: SurfaceProbe): string {
  const at = p.halo.map((v) => v.toFixed(2)).join(', ')
  const object = p.object ? ` objet #${p.object.index} type ${p.object.type}` : ''
  return `${p.material} shader ${p.shader ?? '?'} ${p.family} @ (${at})${object}`
}
