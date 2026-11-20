// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * gameShotEffects3d.ts — A SHOT AS THE GAME DRAWS IT, from the weapon library's `shot_effects`
 * (`internal/weapons/shot_effects.go`): the effect the weapon's barrel plays when it fires, the
 * effects its projectile carries in flight, and the effect it plays where it hits, each simulated
 * and drawn with the game's own particle systems (`weaponIdleEffects3dModel.simulateOnce`,
 * `particleDraw3d`), as the held weapons' idle effects are. Today the Shock Rifle's, under the camera
 * script's `shockLook: 'game'` (`Shots3dLayer.drawShock`).
 *
 * READ FROM THE TAGS (the Shock Rifle, measured 2026-11-20):
 * - firing effect 136580d8 at the weapon's markers primary_trigger (ee18be86, three instances),
 *   55990be4 and af9ed4c5: muzzle sprites, the barrel's shell mesh and its cylinder arcs, each event
 *   0.2 or 0.5 s, first- and third-person events apart;
 * - the projectile flies at its initial velocity (5000 u/s, its final velocity the same) up to its
 *   maximum range (500 u); the flight effect 9f69be2d rides it, at its `root`: an electric plume
 *   sprite parallel to the flight (billboard 2), sparks and a glow, all local to the projectile;
 * - the impact effect 3b3d55b3 (the projectile's material effects' `default_material`) where it hits,
 *   at the surface: its `core` (1.3 s) and `surface` (1.75 s) events, at the locations `normal`,
 *   `forward` and `reflection`.
 *
 * FILLS, not read (each marked where it is used):
 * - the effects play once from the instant the shot leaves (firing), the projectile's arrival
 *   (impact): nothing re-plays a shot's effects;
 * - the flight effect stays at the projectile, then at the point it hit, until its death delay
 *   (0.1 s) after the projectile is gone;
 * - an impact location's frame: X along the surface normal (`normal`), the flight (`forward`) or the
 *   flight reflected off the surface (`reflection`); its Y the world up made perpendicular;
 * - the camera distance input runs from 0 to 1 over the effect's camera range;
 * - a firing system in world space is drawn in the weapon's frame (it lives 0.5 s at most);
 * - a hit is the scenery's (the film does not say what a shot hit), with no surface material: the
 *   default material's effect plays on every surface.
 *
 * NOT DRAWN (the view lacks their readers): the firing effect's distortion particle (shader
 * 7e36462d), the impact effect's particle 31ad75ac (shader ece67da0), the effects' lights, lens
 * flares, generators and decals, the projectile's sound, and the chain lightning the projectile's
 * submunition draws to a nearby enemy (b76936d8: its target is not in the film).
 */
import * as THREE from 'three'

import type { ShotFxEntry } from '../model/shotFx'
import type { ActionContext } from './actionScene3d'
import { IndexField, type FetchJson } from './indexField3d'
import { EffectFiles, ParticlePools } from './particleDraw3d'
import {
  oneShotSeconds,
  simulateOnce,
  systemShown,
  type IdleSystem,
  type LiveParticle,
} from './weaponIdleEffects3dModel'

/** One effect a shot plays (`weapons.ShotEffect`). */
export interface ShotEffect {
  effect: string
  /** The camera distance range the effect is drawn over (world units). */
  cameraRange: [number, number]
  /** Seconds the effect lives on once its owner (the projectile) is gone. */
  deathDelay: number
  systems: IdleSystem[]
}

/** What a weapon's shot plays (`weapons.WeaponShot`). */
export interface WeaponShot {
  projectile: string
  initialVelocity: number
  finalVelocity: number
  maxRange: number
  firing?: string
  markers: Record<string, [number, number, number][]>
  markerRotations: Record<string, [number, number, number, number][]>
  flight: string[]
  impact?: string
  impactFrom?: string
}

export interface ShotTable {
  weapons: Readonly<Record<string, WeaponShot>>
  effects: Readonly<Record<string, ShotEffect>>
}

/** parseShotEffects reads the table out of an index document; null when the field is absent. */
export function parseShotEffects(doc: unknown): ShotTable | null {
  const raw = (doc as { shot_effects?: unknown } | null)?.shot_effects as Partial<ShotTable> | null | undefined
  if (!raw || typeof raw !== 'object' || !raw.weapons || !raw.effects) return null
  const effects: Record<string, ShotEffect> = {}
  for (const [k, e] of Object.entries(raw.effects)) {
    if (e && Array.isArray(e.systems) && Array.isArray(e.cameraRange) && typeof e.deathDelay === 'number') effects[k] = e
  }
  const weapons: Record<string, WeaponShot> = {}
  for (const [k, w] of Object.entries(raw.weapons)) {
    if (w && typeof w.initialVelocity === 'number' && w.initialVelocity > 0 && typeof w.maxRange === 'number' && Array.isArray(w.flight)) weapons[k] = w
  }
  return { weapons, effects }
}

/** The impact effect's locations (StringIDs, hex). */
export const LOC_NORMAL = '474959fc'
export const LOC_FORWARD = '7f56f45b'
export const LOC_REFLECTION = 'bd00b787'

/**
 * flightSeconds: the projectile's time to cover `length` units. FILL: at its initial velocity the
 * whole way (how it reaches its final velocity is not read; the Shock Rifle's are equal).
 */
export function flightSeconds(w: WeaponShot, length: number): number {
  return length / w.initialVelocity
}

/** effectSeconds: how long effect `e` can show particles once started. */
export function effectSeconds(e: ShotEffect | undefined): number {
  if (!e) return 0
  return e.systems.reduce((m, s) => Math.max(m, oneShotSeconds(s)), 0)
}

/** shotSeconds: the longest a shot of `w` shows anything: a flight to range, then its effects. */
export function shotSeconds(t: ShotTable, w: WeaponShot): number {
  const fx = (id: string | undefined) => (id ? t.effects[id] : undefined)
  const flight = w.flight.reduce((m, id) => Math.max(m, fx(id)?.deathDelay ?? 0), 0)
  return Math.max(effectSeconds(fx(w.firing)), flightSeconds(w, w.maxRange) + Math.max(flight, effectSeconds(fx(w.impact))))
}

/**
 * cameraInput: the camera distance input of an effect at `distance` units. FILL: 0 to 1 over its
 * camera range.
 */
export function cameraInput(e: ShotEffect, distance: number): number {
  const [a, b] = e.cameraRange
  return b > a ? Math.min(1, Math.max(0, (distance - a) / (b - a))) : 0
}

const UP = new THREE.Vector3(0, 1, 0)
const SIDE = new THREE.Vector3(1, 0, 0)
const FX = new THREE.Vector3()
const FY = new THREE.Vector3()
const FZ = new THREE.Vector3()

/**
 * frameAlong writes in `out` the frame at `at` whose X is `x` (unit), its Y the world up made
 * perpendicular (FILL: the roll of a location's frame about its X is not read), Z = X × Y.
 */
export function frameAlong(at: THREE.Vector3, x: THREE.Vector3, out: THREE.Matrix4): THREE.Matrix4 {
  FX.copy(x).normalize()
  const up = Math.abs(FX.dot(UP)) > 0.99 ? SIDE : UP
  FY.copy(up).addScaledVector(FX, -FX.dot(up)).normalize()
  FZ.crossVectors(FX, FY)
  return out.makeBasis(FX, FY, FZ).setPosition(at)
}

const REFLECT = new THREE.Vector3()

/** impactAxis: the X of impact location `loc` (FILL, header): the normal, the flight, or its reflection. */
export function impactAxis(loc: string, normal: THREE.Vector3, dir: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  if (loc === LOC_FORWARD) return out.copy(dir)
  if (loc === LOC_REFLECTION) return out.copy(REFLECT.copy(dir).reflect(normal))
  return out.copy(normal)
}

/** The shot a frame draws: who fired what, from where, how long ago. */
export interface GameShot {
  e: ShotFxEntry
  /** The held weapon's library key. */
  key: string
  /** The shooter's player (third person), null for none. */
  xuid: string | null
  /** The camera is the shooter (first person). */
  firstPerson: boolean
  /** The flight's start and unit direction (the action root's space). */
  from: THREE.Vector3
  dir: THREE.Vector3
  /** Seconds since the shot. */
  age: number
}

/** One drawn system, as the debug hook `window.__it3dGameShots` lists it. */
export interface GameShotDebugRow {
  effect: string
  system: number
  role: 'firing' | 'flight' | 'impact'
  particles: number
}

declare global {
  interface Window {
    __it3dGameShots?: readonly GameShotDebugRow[]
  }
}

const DEBUG_HOOK = '__it3dGameShots'

/** The hit a shot's flight ends on, traced once: the point and normal, null for none within range. */
interface Hit {
  point: THREE.Vector3
  normal: THREE.Vector3
  length: number
}

const ANCHOR = new THREE.Matrix4()
const MARKER = new THREE.Matrix4()
const MARKER_Q = new THREE.Quaternion()
const ROOT_INV = new THREE.Matrix4()
const AT = new THREE.Vector3()
const AXIS = new THREE.Vector3()
const CAM = new THREE.Vector3()

/**
 * GameShotEffects — the game's shot effects of the weapons the library reads (header). Owned by the
 * shots layer: `begin` and `end` frame its pools with the layer's, `draw` draws one shot and answers
 * false when the library has nothing for its weapon (the layer then draws its own look).
 */
export class GameShotEffects {
  private readonly ctx: ActionContext
  private readonly fetchJson?: FetchJson
  private table: IndexField<ShotTable> | null = null
  private files: EffectFiles | null = null
  private readonly pools: ParticlePools
  /** Per flight start (the shots layer keeps one per shot and view), its hit. */
  private readonly hits = new WeakMap<THREE.Vector3, Hit | null>()
  private readonly particles: LiveParticle[] = []
  private readonly debugRows: GameShotDebugRow[] = []
  private life: { of: ShotTable; seconds: number } | null = null

  constructor(ctx: ActionContext, fetchJson?: FetchJson) {
    this.ctx = ctx
    this.fetchJson = fetchJson
    this.pools = new ParticlePools(ctx.root, 'game-shot-effect')
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, DEBUG_HOOK, { configurable: true, enumerable: false, get: () => this.debugRows.slice() })
    }
  }

  begin(): void {
    this.pools.begin()
    this.debugRows.length = 0
  }

  end(): void {
    this.pools.end()
  }

  /** shotTable: the library's table, null before it is read (the first call starts the read). */
  private shotTable(): ShotTable | null {
    const base = this.ctx.weaponLibrary?.() ?? null
    if (!base) return null
    if (!this.table) {
      this.table = new IndexField(base, parseShotEffects, this.fetchJson)
      this.files = new EffectFiles(base)
    }
    return this.table.get()
  }

  /** has: the library has a shot for weapon `key` (starts reading it). */
  has(key: string | null): boolean {
    return !!key && !!this.shotTable()?.weapons[key]
  }

  /** lifeSeconds: the longest any shot of the table shows (0 before it is read). */
  lifeSeconds(): number {
    const t = this.shotTable()
    if (!t) return 0
    if (this.life?.of !== t) this.life = { of: t, seconds: Object.values(t.weapons).reduce((m, w) => Math.max(m, shotSeconds(t, w)), 0) }
    return this.life.seconds
  }

  /** draw draws shot `g`'s firing, flight and impact effects; false when its weapon has none. */
  draw(g: GameShot): boolean {
    const t = this.shotTable()
    const w = t?.weapons[g.key]
    if (!t || !w) return false
    const root = this.ctx.root
    root.updateWorldMatrix(true, false)
    ROOT_INV.copy(root.matrixWorld).invert()
    const camera = this.ctx.cameraPosition?.(CAM) ?? null
    const scoped = this.ctx.scopeMounted?.() ?? false
    const seed = g.e.seed | 0
    // The firing effect, at the weapon's markers, from the shot.
    const firing = w.firing ? t.effects[w.firing] : undefined
    if (firing) this.firing(g, w, firing, seed, camera, scoped)
    // The projectile's flight, to its hit or its range.
    const hit = this.hitOf(g, w)
    const length = hit ? hit.length : w.maxRange
    const arrive = flightSeconds(w, length)
    const travel = Math.min(length, g.age * w.initialVelocity)
    AT.copy(g.from).addScaledVector(g.dir, travel)
    frameAlong(AT, g.dir, MARKER)
    ANCHOR.multiplyMatrices(root.matrixWorld, MARKER)
    w.flight.forEach((id, fi) => {
      const fx = t.effects[id]
      // FILL: held at the projectile's last place for its death delay once it is gone.
      if (fx) this.effect(fx, 'flight', g.age, arrive + fx.deathDelay, seed, 100 + fi, camera, g.firstPerson, scoped, () => ANCHOR)
    })
    // The impact, where it hit, from the projectile's arrival.
    const impact = w.impact ? t.effects[w.impact] : undefined
    if (impact && hit && g.age >= arrive) {
      this.effect(impact, 'impact', g.age - arrive, Infinity, seed, 200, camera, g.firstPerson, scoped, (s) => {
        frameAlong(hit.point, impactAxis(s.location, hit.normal, g.dir, AXIS), MARKER)
        return ANCHOR.multiplyMatrices(root.matrixWorld, MARKER)
      })
    }
    return true
  }

  /**
   * firing: the firing effect at every instance of its markers: on the first-person rig
   * (`firstPersonEffectAnchor`) for the camera's own shot, else on the weapon drawn in the shooter's
   * hand; with neither, not drawn (no shape outside a drawn barrel, as the muzzle flash).
   */
  private firing(g: GameShot, w: WeaponShot, fx: ShotEffect, seed: number, camera: THREE.Vector3 | null, scoped: boolean): void {
    const drawn = g.firstPerson || !g.xuid ? null : this.ctx.drawnWeapon(g.xuid)
    if (!g.firstPerson && !drawn) return
    if (drawn) drawn.model.updateWorldMatrix(true, false)
    fx.systems.forEach((s, si) => {
      if (!systemShown(s, g.firstPerson, scoped)) return
      const n = w.markers[s.location]?.length ?? 0
      for (let m = 0; m < n; m++) {
        if (g.firstPerson) {
          if (!this.ctx.firstPersonEffectAnchor?.(g.key, s.location, ANCHOR, m)) continue
        } else {
          const at = w.markers[s.location][m]
          const q = w.markerRotations?.[s.location]?.[m]
          MARKER.makeRotationFromQuaternion(q ? MARKER_Q.set(q[0], q[1], q[2], q[3]) : MARKER_Q.identity()).setPosition(at[0], at[1], at[2])
          ANCHOR.copy(drawn!.model.matrixWorld).multiply(MARKER)
        }
        // FILL: a world-space firing system is drawn in the weapon's frame (header).
        this.system(fx, s, si, 'firing', g.age, Infinity, seed * 8 + m, 0, camera)
      }
    })
  }

  /** effect draws every shown system of `fx` at `age`, each in the frame `frame(s)` answers. */
  private effect(
    fx: ShotEffect, role: GameShotDebugRow['role'], age: number, killAt: number, seed: number, rank: number,
    camera: THREE.Vector3 | null, firstPerson: boolean, scoped: boolean, frame: (s: IdleSystem) => THREE.Matrix4,
  ): void {
    fx.systems.forEach((s, si) => {
      if (!systemShown(s, firstPerson, scoped)) return
      frame(s)
      this.system(fx, s, si, role, age, killAt, seed, rank, camera)
    })
  }

  /** system simulates and writes system `s` of `fx` in the frame ANCHOR (world space). */
  private system(fx: ShotEffect, s: IdleSystem, si: number, role: GameShotDebugRow['role'], age: number, killAt: number, seed: number, rank: number, camera: THREE.Vector3 | null): void {
    const pool = this.pools.poolOf(`${fx.effect}:${si}`, s, this.files)
    if (!pool) return
    const distance = camera ? camera.distanceTo(AT.setFromMatrixPosition(ANCHOR)) : 0
    simulateOnce(s, age, seed, rank * 32 + si, { scaleA: 1, scaleB: 1, cameraDistance: cameraInput(fx, distance) }, this.particles, killAt)
    for (const p of this.particles) this.pools.write(pool, p, ANCHOR, ROOT_INV)
    this.debugRows.push({ effect: fx.effect, system: si, role, particles: this.particles.length })
  }

  /** hitOf: where shot `g` hits the scenery within its projectile's range, traced once. */
  private hitOf(g: GameShot, w: WeaponShot): Hit | null {
    const known = this.hits.get(g.from)
    if (known !== undefined) return known
    const h = this.ctx.ground.hitFace(g.from, g.dir, w.maxRange)
    const hit = h ? { point: h.point, normal: h.normal, length: g.from.distanceTo(h.point) } : null
    this.hits.set(g.from, hit)
    return hit
  }

  dispose(): void {
    this.pools.dispose()
    this.files?.dispose()
    this.table?.dispose()
    if (typeof window !== 'undefined') delete (window as unknown as Record<string, unknown>)[DEBUG_HOOK]
  }
}
