// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * markerObjects3d.ts — LES OBJETS POSÉS QUE LE JEU NE DESSINE PAS.
 *
 * Le calque des objets d'une variante publie la table de ses objets (`levelupObjects`, boîtes en
 * axes du jeu). Certains types ne sont que des repères d'éditeur : le jeu ne les montre jamais.
 * Leurs triangles sont retirés des surfaces avant tout le reste (bornes, collisions, fusion des
 * matériaux). The weapon rack (1649659840) is not one: the layer draws its real Forge kit.
 */
import * as THREE from 'three'

/** Types d'objet posés qui ne sont que des repères : le bloc au sol d'une arme murale. */
export const MARKER_OBJECT_TYPES: ReadonlySet<number> = new Set([0xe93f446d])

// Un sommet d'un objet est dans sa boîte, à l'arrondi de la publication près.
const BOX_SLACK = 0.02

interface PlacedBox {
  type: number
  min: [number, number, number]
  max: [number, number, number]
}

/** markerBoxes : les boîtes (axes du jeu) des objets repères de la table publiée. */
export function markerBoxes(objects: unknown): THREE.Box3[] {
  if (!Array.isArray(objects)) return []
  return (objects as PlacedBox[])
    .filter((o) => MARKER_OBJECT_TYPES.has(o.type >>> 0))
    .map((o) => new THREE.Box3(new THREE.Vector3(...o.min).subScalar(BOX_SLACK), new THREE.Vector3(...o.max).addScalar(BOX_SLACK)))
}

/**
 * dropTriangles retire de `geometry` (indexée) les triangles dont les trois sommets, portés par
 * `world` puis ramenés en axes du jeu, sont dans une même boîte de `boxes`. Rend le nombre retiré.
 */
export function dropTriangles(geometry: THREE.BufferGeometry, world: THREE.Matrix4, boxes: readonly THREE.Box3[]): number {
  const index = geometry.index
  const position = geometry.getAttribute('position')
  if (!index || !position || boxes.length === 0) return 0
  const p = new THREE.Vector3()
  const inside = (i: number, box: THREE.Box3): boolean => {
    p.fromBufferAttribute(position, i).applyMatrix4(world)
    // Axes three (x, y haut, z) vers axes du jeu (x, -z, y haut).
    return box.containsPoint(p.set(p.x, -p.z, p.y))
  }
  const kept: number[] = []
  for (let t = 0; t < index.count; t += 3) {
    const [a, b, c] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)]
    if (boxes.some((box) => inside(a, box) && inside(b, box) && inside(c, box))) continue
    kept.push(a, b, c)
  }
  const dropped = (index.count - kept.length) / 3
  if (dropped > 0) geometry.setIndex(kept)
  return dropped
}

/** dropMarkerObjects retire des surfaces de `scene` les objets repères de sa table publiée. */
export function dropMarkerObjects(scene: THREE.Object3D): void {
  const boxes = markerBoxes(scene.userData.levelupObjects)
  if (boxes.length === 0) return
  scene.updateMatrixWorld(true)
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) dropTriangles(o.geometry, o.matrixWorld, boxes)
  })
}
