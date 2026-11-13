/**
 * actionKit.ts — LES BRIQUES DES CALQUES D'ACTION 3D : formes en lots, traits, étiquettes, sol.
 *
 * Chaque calque redessine son état à chaque image : il vide ses lots (`begin`), y pose ce qui est
 * visible (`add`), puis les ferme (`end`). Un lot est UN maillage instancié : une forme, un
 * matériau, autant d'instances que d'objets, un seul appel de dessin quel que soit leur nombre.
 * Rien n'est créé ni détruit pendant la lecture.
 *
 * Unités monde Halo (cf. `tracks3d`) ; les positions passées ici sont déjà en axes three.
 */
import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

import { cssColor } from './cssColor'
import { toThree } from './tracks3d'

/** L'étiquette d'un joueur ou d'un fait : même pastille partout (vue et export). */
export const TAG_CLASS = 'rounded bg-background/70 px-1 text-xs text-foreground whitespace-nowrap border-l-[3px]'

const UP = new THREE.Vector3(0, 1, 0)
const NO_ROTATION = new THREE.Quaternion()
const scratch = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), d: new THREE.Vector3(), p: new THREE.Vector3() }

/**
 * firstFrom : l'indice du premier élément dont `key` vaut au moins `value`, dans une liste triée
 * par `key` (recherche dichotomique). Les calques d'événements y trouvent le début de leur fenêtre.
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

/** Couleurs three tirées des encres CSS du thème : une conversion par chaîne, puis le cache. */
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

/** Un lot de formes identiques : chaque instance a sa pose et sa couleur. */
export class InstancePool {
  readonly mesh: THREE.InstancedMesh
  private readonly capacity: number
  private n = 0

  constructor(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number) {
    this.capacity = capacity
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity)
    this.mesh.count = 0
    // Les instances couvrent toute la carte : la boîte du maillage de base ne dit rien d'elles.
    this.mesh.frustumCulled = false
    this.mesh.setColorAt(0, new THREE.Color())
    parent.add(this.mesh)
  }

  begin(): void {
    this.n = 0
  }

  /** add pose une instance ; au-delà de la capacité, l'instance est ignorée. */
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

/** Un lot de traits : des cylindres fins tendus entre deux points (un trait WebGL fait 1 px). */
export class SegmentPool {
  private readonly pool: InstancePool

  constructor(parent: THREE.Object3D, material: THREE.Material, capacity: number) {
    this.pool = new InstancePool(parent, new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), material, capacity)
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

/** Une étiquette visible, telle que l'export la repeint. */
export interface ShownLabel {
  position: THREE.Vector3
  text: string
  color: string
}

interface LabelSlot extends ShownLabel {
  obj: CSS2DObject
}

/** Un lot d'étiquettes HTML posées dans la scène (pastilles des faits : morts, objets). */
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
    // Le DOM ne change que si le texte ou la couleur changent : la pose, elle, change à chaque image.
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
 * Ground — la hauteur du sol sous un point du rejeu, lue dans le maillage de la carte.
 *
 * Plusieurs canaux ne publient que (x, y) : tirs, projectiles, grenades, drapeaux, crâne. Leur
 * hauteur se cherche sous un indice (la hauteur d'un joueur voisin, l'origine d'un vol) : le
 * premier sol sous l'indice, à défaut le plus haut sol de l'aire de jeu. Le résultat est mis en
 * cache au quart d'unité près : un objet immobile ne relance pas de rayon à chaque image.
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

  /** setPickables change les surfaces du sol (un calque posé sur la carte ou retiré) ; les hauteurs lues sont oubliées. */
  setPickables(pickables: THREE.Object3D[]): void {
    this.pickables = pickables
    this.changes++
    this.cache.clear()
  }

  /** version : change à chaque `setPickables` (ce qui a été tiré des surfaces est à refaire). */
  get version(): number {
    return this.changes
  }

  /** surfaces : les surfaces du sol (celles que touchent aussi les corps inertes, `ragdollPatch3d`). */
  surfaces(): readonly THREE.Object3D[] {
    return this.pickables
  }

  /** floorY : la hauteur three du sol sous (x, y) Halo, sous `zHint` (z Halo) s'il est connu. */
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

  /** hit : le premier impact sur la carte le long d'un rayon, ou null au-delà de `far`. */
  hit(from: THREE.Vector3, dir: THREE.Vector3, far: number): THREE.Vector3 | null {
    this.ray.set(from, dir)
    this.ray.far = far
    return this.ray.intersectObjects(this.pickables, false)[0]?.point ?? null
  }
}

const DOWN = new THREE.Vector3(0, -1, 0)
// Fenêtre de recherche autour d'un indice de hauteur (u) : au-dessus de la tête, et un étage sous les pieds.
const HINT_REACH_UP = 0.6
const HINT_REACH_DOWN = 4
