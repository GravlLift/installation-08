// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * flash3d.ts — THE ACTION'S BRIEF FLASHES: their light (a fixed set of point lights) and their
 * curve over time.
 *
 * A three point light lights the map and the Spartans (standard materials: baked light only
 * replaces the indirect term). The light count is baked into the compiled shader programs:
 * changing that count recompiles the whole map (several seconds on Recharge). The set is therefore
 * FIXED, placed with the scene's lighting before the first compile; every frame the layers request
 * flashes (`add`) between `begin` and `end`, the strongest take the slots, the other slots stay off.
 * No shadow: a shadow map per flash would cost a pass.
 *
 * Each flash is a function of its age (seconds since the shot or the detonation): the same frame
 * renders the same light, forward or backward.
 */
import * as THREE from 'three'

/** The set's slots: a handful of flashes at once is enough, past that the weakest fade out. */
export const FLASH_POOL = 4
// At most this many requests per frame (a volley from every player stays under it).
const MAX_REQUESTS = 128
// Light falloff with distance (physical: 2).
const DECAY = 2

interface Request {
  position: THREE.Vector3
  color: THREE.Color
  intensity: number
  distance: number
}

export class FlashLights {
  private readonly lights: THREE.PointLight[] = []
  private readonly requests: Request[] = []
  private readonly order: Request[] = []
  private n = 0

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < FLASH_POOL; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 1, DECAY)
      light.castShadow = false
      this.lights.push(light)
      scene.add(light)
    }
    for (let i = 0; i < MAX_REQUESTS; i++) {
      this.requests.push({ position: new THREE.Vector3(), color: new THREE.Color(), intensity: 0, distance: 1 })
    }
  }

  begin(): void {
    this.n = 0
  }

  /** add requests a flash; past `MAX_REQUESTS` per frame, the request is ignored. */
  add(position: THREE.Vector3, color: THREE.Color, intensity: number, distance: number): void {
    if (intensity <= 0 || this.n >= MAX_REQUESTS) return
    const r = this.requests[this.n++]
    r.position.copy(position)
    r.color.copy(color)
    r.intensity = intensity
    r.distance = distance
  }

  /** end gives the slots to the frame's strongest flashes; the other slots turn off. */
  end(): void {
    this.order.length = 0
    for (let i = 0; i < this.n; i++) this.order.push(this.requests[i])
    this.order.sort((a, b) => b.intensity - a.intensity)
    this.lights.forEach((light, i) => {
      const r = this.order[i]
      light.intensity = r ? r.intensity : 0
      if (!r) return
      light.position.copy(r.position)
      light.color.copy(r.color)
      light.distance = r.distance
    })
  }

  /** lit: the slots lit on the last frame (tests, measurement). */
  lit(): number {
    return this.lights.filter((l) => l.intensity > 0).length
  }

  dispose(): void {
    for (const light of this.lights) {
      light.removeFromParent()
      light.dispose()
    }
  }
}

/**
 * flashCurve: a flash's strength (0..1) `age` seconds after it started, over `seconds`: full at
 * the start, off at the end, square falloff (a flare, not a fade). 0 before and after.
 */
export function flashCurve(age: number, seconds: number): number {
  if (age < 0 || age >= seconds) return 0
  const u = 1 - age / seconds
  return u * u
}

/**
 * petalGeometry: a muzzle flash petal, a flat diamond in the XY plane, from the barrel (origin) to
 * the tip (+Y, length 1), widest at a third of the way; the core is white, the edges black (in
 * additive blending, black paints nothing: the petal fades out toward its edges).
 */
export function petalGeometry(): THREE.BufferGeometry {
  const core = [1, 1, 1]
  const edge = [0, 0, 0]
  // Two triangles per half: center (0, 0.3) white, four black vertices.
  const c = [0, 0.3, 0]
  const tail = [0, 0, 0]
  const tip = [0, 1, 0]
  const left = [-0.5, 0.3, 0]
  const right = [0.5, 0.3, 0]
  const tris = [[c, tail, right], [c, right, tip], [c, tip, left], [c, left, tail]]
  const pos: number[] = []
  const col: number[] = []
  for (const t of tris) {
    t.forEach((v, i) => {
      pos.push(...v)
      col.push(...(i === 0 ? core : edge))
    })
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return g
}
