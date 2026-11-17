// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * markerObjects3d.ts — PLACED OBJECTS THE GAME DOES NOT DRAW.
 *
 * A variant's object layer publishes its object table (`levelupObjects`, boxes in game axes).
 * Some types are only editor markers: the game never shows them. Their triangles are removed
 * from the surfaces before everything else (bounds, collisions, material merge). The weapon
 * rack (1649659840) is not one: the layer draws its real Forge kit.
 */
import * as THREE from 'three'

/** Placed object types that are only markers: a wall weapon's ground block. */
export const MARKER_OBJECT_TYPES: ReadonlySet<number> = new Set([0xe93f446d])

// An object's vertex is inside its box, within the publication's rounding.
const BOX_SLACK = 0.02

interface PlacedBox {
  type: number
  min: [number, number, number]
  max: [number, number, number]
}

/** markerBoxes: the boxes (game axes) of the published table's marker objects. */
export function markerBoxes(objects: unknown): THREE.Box3[] {
  if (!Array.isArray(objects)) return []
  return (objects as PlacedBox[])
    .filter((o) => MARKER_OBJECT_TYPES.has(o.type >>> 0))
    .map((o) => new THREE.Box3(new THREE.Vector3(...o.min).subScalar(BOX_SLACK), new THREE.Vector3(...o.max).addScalar(BOX_SLACK)))
}

/**
 * dropTriangles removes from `geometry` (indexed) the triangles whose three vertices, carried
 * by `world` then brought back to game axes, lie in the same box of `boxes`. Returns the
 * number removed.
 */
export function dropTriangles(geometry: THREE.BufferGeometry, world: THREE.Matrix4, boxes: readonly THREE.Box3[]): number {
  const index = geometry.index
  const position = geometry.getAttribute('position')
  if (!index || !position || boxes.length === 0) return 0
  const p = new THREE.Vector3()
  const inside = (i: number, box: THREE.Box3): boolean => {
    p.fromBufferAttribute(position, i).applyMatrix4(world)
    // three axes (x, y up, z) to game axes (x, -z, y up).
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

/** dropMarkerObjects removes `scene`'s surfaces' marker objects from its published table. */
export function dropMarkerObjects(scene: THREE.Object3D): void {
  const boxes = markerBoxes(scene.userData.levelupObjects)
  if (boxes.length === 0) return
  scene.updateMatrixWorld(true)
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) dropTriangles(o.geometry, o.matrixWorld, boxes)
  })
}
