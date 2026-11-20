// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * actionKit.ts — the BUILDING BLOCKS for 3D action layers: batched shapes, segments, labels, ground.
 *
 * Each layer redraws its state every frame: it clears its batches (`begin`), places what is
 * visible (`add`), then closes them (`end`). A batch is ONE instanced mesh: one shape, one
 * material, as many instances as there are objects, a single draw call no matter their count.
 * Nothing is created or destroyed during playback.
 *
 * Halo world units (see `tracks3d`); positions passed here are already in three.js axes.
 */
import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

import { cssColor } from './cssColor'
import { toThree } from './tracks3d'

/** A player or event's label: the same pill everywhere (view and export). */
export const TAG_CLASS = 'rounded bg-background/70 px-1 text-xs text-foreground whitespace-nowrap border-l-[3px]'

const UP = new THREE.Vector3(0, 1, 0)
const NO_ROTATION = new THREE.Quaternion()
const scratch = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), d: new THREE.Vector3(), p: new THREE.Vector3() }

/**
 * firstFrom: the index of the first item whose `key` is at least `value`, in a list sorted by
 * `key` (binary search). Event layers use it to find the start of their window.
 */
export function firstFrom<T>(items: readonly T[], key: (item: T) => number, value: number): number {
  let lo = 0
  let hi = items.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (key(items[mid]) < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Three.js colors drawn from the theme's CSS inks: one conversion per string, then cached. */
export class InkCache {
  private readonly cache = new Map<string, THREE.Color>()
  private readonly fallback: THREE.Color

  constructor(fallback: THREE.Color) {
    this.fallback = fallback
  }

  of(css: string | null | undefined): THREE.Color {
    const key = css ?? ''
    let c = this.cache.get(key)
    if (!c) {
      c = cssColor(css || null, this.fallback)
      this.cache.set(key, c)
    }
    return c
  }
}

/** A batch of identical shapes: each instance has its own pose and color. */
export class InstancePool {
  readonly mesh: THREE.InstancedMesh
  private readonly capacity: number
  private n = 0

  constructor(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number) {
    this.capacity = capacity
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity)
    this.mesh.count = 0
    // Instances span the whole map: the base mesh's bounding box says nothing about them.
    this.mesh.frustumCulled = false
    this.mesh.setColorAt(0, new THREE.Color())
    parent.add(this.mesh)
  }

  begin(): void {
    this.n = 0
  }

  /** add places one instance; past capacity, the instance is dropped. */
  add(pos: THREE.Vector3, rot: THREE.Quaternion | null, scale: THREE.Vector3 | number, color: THREE.Color): void {
    if (this.n >= this.capacity) return
    const s = typeof scale === 'number' ? scratch.s.setScalar(scale) : scale
    scratch.m.compose(pos, rot ?? NO_ROTATION, s)
    this.mesh.setMatrixAt(this.n, scratch.m)
    this.mesh.setColorAt(this.n, color)
    this.n++
  }

  end(): void {
    this.mesh.count = this.n
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh.dispose()
  }
}

/** A batch of segments: thin cylinders stretched between two points (a WebGL line is 1 px). */
export class SegmentPool {
  private readonly pool: InstancePool

  constructor(parent: THREE.Object3D, material: THREE.Material, capacity: number) {
    this.pool = new InstancePool(parent, new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), material, capacity)
  }

  /** The batch's instanced mesh (a render-time hook reads the camera through it). */
  get mesh(): THREE.InstancedMesh {
    return this.pool.mesh
  }

  begin(): void {
    this.pool.begin()
  }

  add(a: THREE.Vector3, b: THREE.Vector3, radius: number, color: THREE.Color): void {
    const d = scratch.d.subVectors(b, a)
    const len = d.length()
    if (len < 1e-4) return
    scratch.q.setFromUnitVectors(UP, d.divideScalar(len))
    const mid = scratch.p.addVectors(a, b).multiplyScalar(0.5)
    this.pool.add(mid, scratch.q, new THREE.Vector3(radius, len, radius), color)
  }

  end(): void {
    this.pool.end()
  }

  dispose(): void {
    this.pool.dispose()
  }
}

/** A visible label, as the export repaints it. */
export interface ShownLabel {
  position: THREE.Vector3
  text: string
  color: string
}

interface LabelSlot extends ShownLabel {
  obj: CSS2DObject
}

/** A batch of HTML labels placed in the scene (event pills: deaths, objects). */
export class LabelPool {
  private readonly slots: LabelSlot[] = []
  private readonly parent: THREE.Object3D
  private n = 0

  constructor(parent: THREE.Object3D) {
    this.parent = parent
  }

  begin(): void {
    this.n = 0
  }

  add(pos: THREE.Vector3, text: string, color: string): void {
    let slot = this.slots[this.n]
    if (!slot) {
      const el = document.createElement('div')
      el.className = TAG_CLASS
      const obj = new CSS2DObject(el)
      this.parent.add(obj)
      slot = { obj, position: obj.position, text: '', color: '' }
      this.slots.push(slot)
    }
    // The DOM only changes if the text or color changes: the pose, on the other hand, changes every frame.
    if (slot.text !== text) slot.obj.element.textContent = slot.text = text
    if (slot.color !== color) slot.obj.element.style.borderLeftColor = slot.color = color
    slot.obj.position.copy(pos)
    slot.obj.visible = true
    this.n++
  }

  end(): void {
    for (let i = this.n; i < this.slots.length; i++) this.slots[i].obj.visible = false
  }

  shown(): readonly ShownLabel[] {
    return this.slots.slice(0, this.n)
  }

  dispose(): void {
    for (const s of this.slots) {
      s.obj.element.remove()
      s.obj.removeFromParent()
    }
  }
}

/**
 * Ground — the ground height under a point in the replay, read from the map's mesh.
 *
 * Several channels only publish (x, y): shots, projectiles, grenades, flags, skull. Their
 * height is looked up below a hint (a nearby player's height, a flight's origin): the first
 * ground surface below the hint, or failing that the highest ground surface on the play area.
 * The result is cached to a quarter unit: a motionless object doesn't recast a ray every frame.
 */
export class Ground {
  private readonly ray = new THREE.Raycaster()
  private readonly cache = new Map<string, number | null>()
  private readonly origin = new THREE.Vector3()
  private pickables: THREE.Object3D[]
  private readonly ceiling: number
  private changes = 0

  constructor(pickables: THREE.Object3D[], ceiling: number) {
    this.pickables = pickables
    this.ceiling = ceiling
    this.ray.firstHitOnly = true
  }

  /** setPickables changes the ground surfaces (a layer added to or removed from the map); cached heights are forgotten. */
  setPickables(pickables: THREE.Object3D[]): void {
    this.pickables = pickables
    this.changes++
    this.cache.clear()
  }

  /** version: changes on every `setPickables` (whatever was cast against the old surfaces must be redone). */
  get version(): number {
    return this.changes
  }

  /** surfaces: the ground surfaces (the same ones ragdolls also collide with, `ragdollPatch3d`). */
  surfaces(): readonly THREE.Object3D[] {
    return this.pickables
  }

  /** floorY: the three.js ground height under (x, y) Halo, below `zHint` (Halo z) if known. */
  floorY(x: number, y: number, zHint: number | null): number | null {
    const key = `${Math.round(x * 4)},${Math.round(y * 4)},${zHint === null ? 'h' : Math.round(zHint * 2)}`
    const hit = this.cache.get(key)
    if (hit !== undefined) return hit
    const [tx, , tz] = toThree(x, y, 0)
    const from = zHint === null ? this.ceiling : zHint + HINT_REACH_UP
    this.origin.set(tx, from, tz)
    this.ray.set(this.origin, DOWN)
    this.ray.far = zHint === null ? Infinity : HINT_REACH_UP + HINT_REACH_DOWN
    const y3 = this.ray.intersectObjects(this.pickables, false)[0]?.point.y ?? null
    this.cache.set(key, y3)
    return y3
  }

  /** hit: the first impact on the map along a ray, or null beyond `far`. */
  hit(from: THREE.Vector3, dir: THREE.Vector3, far: number): THREE.Vector3 | null {
    this.ray.set(from, dir)
    this.ray.far = far
    return this.ray.intersectObjects(this.pickables, false)[0]?.point ?? null
  }

  /**
   * hitFace: the first impact along a ray and the hit surface's normal (world space, facing the
   * ray), or null beyond `far`. What a ricochet needs.
   */
  hitFace(from: THREE.Vector3, dir: THREE.Vector3, far: number): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
    this.ray.set(from, dir)
    this.ray.far = far
    const h = this.ray.intersectObjects(this.pickables, false)[0]
    if (!h) return null
    const normal = h.face ? h.face.normal.clone() : dir.clone().negate()
    if (h.face) {
      if (h.object instanceof THREE.InstancedMesh && h.instanceId !== undefined) {
        h.object.getMatrixAt(h.instanceId, scratch.m)
        normal.transformDirection(scratch.m)
      }
      normal.transformDirection(h.object.matrixWorld)
    }
    if (normal.dot(dir) > 0) normal.negate()
    return { point: h.point.clone(), normal }
  }
}

const DOWN = new THREE.Vector3(0, -1, 0)
// Search window around a height hint (units): above the head, and a floor below the feet.
const HINT_REACH_UP = 0.6
const HINT_REACH_DOWN = 4
