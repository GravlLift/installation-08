/**
 * shockArcs3d.ts — THE SHOCK RIFLE'S SHROUD ARCS: blue electricity jumping over the open barrel
 * cage while the weapon is held, its defining feature (owner-confirmed look of the game).
 *
 * WHAT THE GAME DATA SAYS (step 1, time-boxed). The render model of hinf_shock_rifle (families
 * 1a22fee6 and 9387a8b9, marker mode ec1363e7) carries a `muzzle_flash` marker at model-space
 * (0.374, 0, 0.043) (X toward the barrel, origin at the grip) and a cluster of shroud markers:
 * 55990be4 at (0.306, 0, 0.044), f674aea6 at (0.368, 0, 0.043), and ee18be86 with three instances
 * on the front lip ((0.374, 0, 0.043), (0.386, ±0.009, 0.041..0.043)). The SHROUD_ANCHORS below
 * are a ring through that measured cluster; the arc COUNT, JAG and flicker rate are named
 * estimates (the effect tags exist on the weapon, their particle colors read as an electric
 * cyan with HDR peaks around 4.0, but the probe did not read the arc count from them).
 *
 * DETERMINISM: a function of (drawn weapon transform, match time, player index) alone; the same
 * frame always draws the same arcs. The arcs are re-seeded SHOCK_ARC_HZ times a second, from
 * (time bucket, player) — no wall clock, no Math.random.
 *
 * The arcs cross the bloom threshold (core peak channel above `bloom3d`'s 1.5) so Bloom picks
 * them up; they are drawn on every drawn Shock Rifle — third person on every holder, first
 * person on the followed player's rig (the drawn weapon answers in both, `avatar3d.drawnWeapon`).
 */
import * as THREE from 'three'

import { SegmentPool } from './actionKit'
import { heldWeaponAt } from './heldWeapon3d'
import type { ActionContext, ActionLayer3d } from './actionScene3d'
import { SHOCK_HD, SHOCK_JITTER_HZ, unitHash } from './shockShots3d'
import { weaponModelKey } from './weaponModels3d'

/** The Shock Rifle's model families (weapon_families.toml: both map to hinf_shock_rifle). */
export const SHOCK_FAMILIES: readonly string[] = ['1a22fee6', '9387a8b9']

/** isShockFamily: whether a held weapon's model key is a Shock Rifle. */
export function isShockFamily(heldKey: string | null): boolean {
  return heldKey !== null && SHOCK_FAMILIES.includes(heldKey)
}

/** Arcs shown per drawn rifle. */
export const SHOCK_ARC_COUNT = 6
/** The arcs re-seed this many times a second (the jitter bucket). */
export const SHOCK_ARC_HZ = SHOCK_JITTER_HZ
/** Segments per arc (SHOCK_ARC_SEGMENTS - 1 interior jags). */
export const SHOCK_ARC_SEGMENTS = 5
/** Core radius of an arc, u (~4 mm). */
export const SHOCK_ARC_CORE = 0.004
/** The glow: a wider, dimmer segment on the same path. */
export const SHOCK_ARC_GLOW_MULT = 5
export const SHOCK_ARC_GLOW_DIM = 0.35
/** The largest sideways throw of an arc's jag, u. */
export const SHOCK_ARC_JAG = 0.02
/**
 * The anchor ring of the shroud, in model space (X toward the barrel, origin at the grip):
 * points through the measured marker cluster (see the header).
 */
export const SHROUD_ANCHORS: readonly THREE.Vector3[] = [
  new THREE.Vector3(0.306, 0.028, 0.044),
  new THREE.Vector3(0.33, -0.03, 0.02),
  new THREE.Vector3(0.33, 0.03, 0.07),
  new THREE.Vector3(0.368, -0.026, 0.066),
  new THREE.Vector3(0.386, -0.009, 0.041),
  new THREE.Vector3(0.386, 0.009, 0.043),
  new THREE.Vector3(0.352, 0.0, 0.008),
  new THREE.Vector3(0.322, -0.004, 0.072),
]
/** The electric blue of the arcs (the game's shroud; an electric cyan, stated constant). */
export const SHOCK_ARC_INK = new THREE.Color(0.35, 0.75, 1.0)

const DIR = new THREE.Vector3()
const P1 = new THREE.Vector3()
const P2 = new THREE.Vector3()

/**
 * shockArcGeometry — one arc between the model-space anchors `a` and `b`: a polyline of
 * SHOCK_ARC_SEGMENTS + 1 points, jagged with a seed (deterministic in (seed, bucket, i)).
 * `out` (reusable) is filled and returned.
 */
export function shockArcGeometry(
  a: THREE.Vector3,
  b: THREE.Vector3,
  seed: number,
  bucket: number,
  i: number,
  out: THREE.Vector3[],
): THREE.Vector3[] {
  out.length = 0
  DIR.subVectors(b, a)
  const len = DIR.length()
  if (len < 1e-6) {
    out.push(a.clone())
    return out
  }
  DIR.divideScalar(len)
  const up = Math.abs(DIR.y) < 0.9 ? P1.set(0, 1, 0) : P1.set(1, 0, 0)
  P1.crossVectors(DIR, up).normalize()
  P2.crossVectors(DIR, P1).normalize()
  out.push(a.clone())
  for (let k = 1; k < SHOCK_ARC_SEGMENTS; k++) {
    const s = k / SHOCK_ARC_SEGMENTS
    const jag = SHOCK_ARC_JAG * Math.sin(Math.PI * s) * unitHash(seed * 131 + bucket * 97 + i * 11 + k)
    const angle = unitHash(seed * 17 + bucket * 131 + i * 19 + k * 2) * Math.PI * 2
    out.push(
      a
        .clone()
        .addScaledVector(DIR, s * len)
        .addScaledVector(P1, Math.cos(angle) * jag)
        .addScaledVector(P2, Math.sin(angle) * jag),
    )
  }
  out.push(b.clone())
  return out
}

/**
 * shockArcsFor — the arcs of one drawn rifle at match time `t` seconds, player seed `seed`:
 * SHOCK_ARC_COUNT arcs, each between two distinct anchors, re-seeded per bucket. `out` (reusable)
 * is filled and returned, in model space.
 */
export function shockArcsFor(t: number, seed: number, out: THREE.Vector3[][]): THREE.Vector3[][] {
  out.length = 0
  const bucket = Math.floor(t * SHOCK_ARC_HZ)
  const n = SHROUD_ANCHORS.length
  for (let i = 0; i < SHOCK_ARC_COUNT; i++) {
    const ia = Math.floor(unitHash(seed * 7 + bucket * 31 + i) * n)
    let ib = Math.floor(unitHash(seed * 13 + bucket * 37 + i * 3) * n)
    if (ib === ia) ib = (ib + 1) % n
    // One buffer per arc: the reusable one is cleared on entry, so no two arcs of one call may share it.
    out.push(shockArcGeometry(SHROUD_ANCHORS[ia], SHROUD_ANCHORS[ib], seed, bucket, i, []))
  }
  return out
}

/** The flicker of a bucket (0.55..1): the arcs pulse, they do not stand still. */
export function shockArcFlicker(seed: number, bucket: number): number {
  return 0.55 + 0.45 * unitHash(seed * 19 + bucket * 43)
}

const M = new THREE.Matrix4()

/**
 * ShockArcs3dLayer — the shroud arcs of every drawn Shock Rifle: third person on every holder,
 * first person on the followed player's rig (the drawn weapon answers in both).
 */
export class ShockArcs3dLayer implements ActionLayer3d {
  private readonly arcs: SegmentPool
  private readonly glow: SegmentPool
  private readonly ctx: ActionContext
  private readonly ink = SHOCK_ARC_INK.clone()
  private readonly coreInk = new THREE.Color()
  private readonly glowInk = new THREE.Color()
  private readonly modelSpace: THREE.Vector3[][] = []
  private readonly segA = new THREE.Vector3()
  private readonly segB = new THREE.Vector3()
  private slotSeed: Map<number, number> | null = null

  constructor(ctx: ActionContext) {
    this.ctx = ctx
    const mat = () => new THREE.MeshBasicMaterial({
      toneMapped: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    // 16 rifles of SHOCK_ARC_COUNT arcs of SHOCK_ARC_SEGMENTS segments, core and glow.
    this.arcs = new SegmentPool(ctx.root, mat(), 16 * SHOCK_ARC_COUNT * SHOCK_ARC_SEGMENTS)
    this.glow = new SegmentPool(ctx.root, mat(), 16 * SHOCK_ARC_COUNT * SHOCK_ARC_SEGMENTS)
  }

  update(frame: number): void {
    this.arcs.begin()
    this.glow.begin()
    const inputs = this.ctx.inputs()
    if (!inputs.show.shots) {
      this.arcs.end()
      this.glow.end()
      return
    }
    const fps = Math.max(1, inputs.framesPerSecond)
    const t = frame / fps
    const bucket = Math.floor(t * SHOCK_ARC_HZ)
    const tracks = this.ctx.doc.tracks
    if (!this.slotSeed) this.slotSeed = new Map(tracks.map((tr, i) => [tr.slot, i]))
    this.modelSpace.length = 0
    for (const track of tracks) {
      if (!track.xuid) continue
      const held = heldWeaponAt(this.ctx.doc, track.slot, Math.floor(frame), inputs.locale)
      if (!isShockFamily(held ? weaponModelKey(held.id) : null)) continue
      const drawn = this.ctx.drawnWeapon(track.xuid)
      if (!drawn) continue
      drawn.model.updateWorldMatrix(true, false)
      M.copy(drawn.model.matrixWorld)
      const seed = this.slotSeed.get(track.slot) ?? 0
      const arcs = shockArcsFor(t, seed, this.modelSpace)
      const flicker = shockArcFlicker(seed, bucket)
      this.coreInk.copy(this.ink).multiplyScalar(SHOCK_HD * flicker)
      this.glowInk.copy(this.ink).multiplyScalar(SHOCK_HD * SHOCK_ARC_GLOW_DIM * flicker)
      for (const arc of arcs) {
        for (let k = 1; k < arc.length; k++) {
          this.segA.copy(arc[k - 1]).applyMatrix4(M)
          this.segB.copy(arc[k]).applyMatrix4(M)
          this.arcs.add(this.segA, this.segB, SHOCK_ARC_CORE, this.coreInk)
          this.glow.add(this.segA, this.segB, SHOCK_ARC_CORE * SHOCK_ARC_GLOW_MULT, this.glowInk)
        }
      }
    }
    this.arcs.end()
    this.glow.end()
  }

  dispose(): void {
    this.arcs.dispose()
    this.glow.dispose()
  }
}
