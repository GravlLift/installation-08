// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * flights3d.ts — FLIGHTS AND EXPLOSIONS IN THE 3D SCENE: grenades, shot projectiles (rockets,
 * mortar...), and what happens at the end of their flight.
 *
 * Flights are the document's own (`projectiles`), over the same window as the 2D (the flight,
 * then a short trail). The path travelled (the trail) is an analysis aid
 * (`aids3d.projectilePaths`), off by default: the game only shows the flying object. Explosions
 * are the 2D's own (`buildRestFx`: grenades by type, shot projectiles whose weapon detonates),
 * at the same frame (explosion, Dynamo nappe, halo).
 *
 * THE HEIGHT OF A FLIGHT IS PUBLISHED since schema 126 (`Projectile.z`, one height per point of
 * `p`): the film replicates the object's position on all three axes at ~60 Hz, and the document keeps
 * the first sample of each frame. A flight is drawn THROUGH those points, so the arc, every bounce
 * off the floor or a wall, and the roll to rest are the game's own. Between two points the head
 * moves in a straight line (`flightPointAt`): at one frame per point a ballistic sag is under a
 * centimeter, and a smoothing spline would round off each bounce and dip through the floor.
 *
 * An artifact older than schema 126 has no height: it is INTERPOLATED along the distance
 * travelled, from the thrower's hand to the floor under the detonation point (`heightsAlong`).
 *
 * A detonation plays out as in the game, in under a second (`explosionFx3d`, placed by
 * `explosions3d`): flash, fireball in billows, sparks, a smoke veil, and a brief light that
 * lights the room (`flash3d`), all functions of the time elapsed since the published
 * detonation. The damage-radius sphere is an analysis aid (`aids3d.blastRadius`), off by
 * default.
 *
 * A grenade whose game model is loaded (`ActionContext.grenadeModel`) shows it in place of the
 * glowing head, tumbling; placed before it detonates (flight finished before the published
 * explosion), it stays at the end of its flight until the explosion. The plasma grenade has no
 * model: it shows its GLOWING ORB (blue-white core, saturated blue halo, pulsed over time;
 * `grenadeLook3d`), in flight as much as at rest.
 *
 * A PROJECTILE THAT STICKS (schema 128, `Projectile.attach`) stops replicating its position: the film
 * names what it is stuck to instead, a node of the parent and its offset in that node's frame. From
 * the attach frame until the explosion it rides that bone of the body the scene draws for the parent
 * (`ActionContext.attachBone`); in first person on him, the arms rig's bone of the same name, or
 * nothing when the rig has no such bone. A parent the scene draws no body for (a device, a weapon, a
 * Forge object, a dead player) leaves the projectile at the end of its flight, as before.
 *
 * A THROW WITHOUT A FLIGHT (schema 129, `Grenade.deto`): a grenade stuck point-blank replicates no
 * flight, so nothing flies; its explosion is the film's own detonation of the projectile the throw
 * created, placed at its published position AND height (`GrenadeRestFx.z`). From the throw until
 * that explosion it rides the body it stuck to (`stuckGrenades3d`).
 */
import * as THREE from 'three'

import { msToFrames } from '@/lib/replay/replayLogic'
import type { ReplayProjectileReady } from '@/lib/replay/replayReadyTypes'

import { fxTintOf, type FxTint } from '../layers/fxInk'
import { DYNAMO_REST_HOLD_MS, GRENADE_REST_HOLD_MS, restKindOf, type GrenadeRestFx } from '../model/grenadeFx'
import { buildRestFx } from '../model/shotImpactFx'
import { vehicleShotStyleOf } from '../model/vehicleWeaponRegistry'
import { InstancePool, SegmentPool, firstFrom } from './actionKit'
import { grenadeLookOf, plasmaPulse, PLASMA_CORE_MIX, PLASMA_CORE_RADIUS, PLASMA_HALO_DIM, PLASMA_HALO_MULT, PLASMA_PULSE_DEPTH, SHOT_ORB_RADIUS, type GrenadeFlightLook } from './grenadeLook3d'
import { drawRecorder, ledgerId } from './drawRecorder3d'
import { blastLight, blastStyleOf } from './explosionFx3d'
import { BLAST_LIFT, blastLiftOver, Explosions3d } from './explosions3d'
import { stuckGrenadesOf, stuckPointAt, type StuckGrenade } from './stuckGrenades3d'
import { WeaponModelPool } from './weaponModels3d'
import type { ActionContext, ActionLayer3d } from './actionScene3d'
import { MUZZLE_HEIGHT } from './body3d'
import { toThree } from './tracks3d'

// A flight stays briefly visible after its last point (the 2D's own trail).
const TAIL_FRAMES = 7
const TRAIL_RADIUS = 0.01
const HEAD_RADIUS = 0.05
// On the ground, the object rests on its face, not its center.
const REST_LIFT = 0.08
/** An explosion's damage radius (u, ~3.4 m), the 2D's own: the analysis aid shows it. */
export const BLAST_RADIUS = 1.1
/** The damage-radius sphere holds for one second, and fades out. */
const BLAST_RADIUS_SECONDS = 1
const NAPPE_RADIUS = 0.9
const HALO_RADIUS = 0.3
// A detonation's light lights the room over ~18 m.
const DETONATION_LIGHT_RANGE = 6
// This light's color: the blast's tint mixed with incandescent white.
const DETONATION_CORE_MIX = 0.35

// The grenade tumbles by the distance it travels (rad per unit, about two turns a second at a
// throw's ~12 u/s), around a tilted axis: it stops turning once it lies still.
const GRENADE_SPIN_PER_UNIT = (4 * Math.PI) / 12
const SPIN_AXIS = new THREE.Vector3(1, 0, 0.4).normalize()

interface Flight {
  /** The flight's index in `doc.projectiles` (the ledger's `projectile/<i>`). */
  index: number
  /** The throw's index in `doc.grenades` when the flight is a grenade's (`grenade/<i>`). */
  grenadeIndex: number | null
  t0: number
  /** Absolute frame of each point. */
  at: number[]
  pts: THREE.Vector3[]
  /** The distance travelled up to each point (u), for the tumble. */
  dist: number[]
  end: number
  /** Frame of the published explosion (`Projectile.detoT`). */
  detoT: number
  /** The thrown grenade's rank, null for a shot projectile. */
  grenade: number | null
  /** The flight's shape (`grenadeLook3d`): the game model, or the plasma orb. */
  look: GrenadeFlightLook
  /** The orb's core radius (u), when the flight is one. */
  orbRadius: number
  tint: FxTint
  /**
   * Stuck to something (`Projectile.attach`, schema 128): from `from` until the explosion, the
   * projectile sits on bone `node` of the body drawn for slot `slot`, at `pose` in that bone's
   * frame (three axes). Null: it does not stick, or an older artifact.
   */
  attach: { from: number; slot: number; node: number; pose: THREE.Vector3 } | null
}

interface Blast {
  rest: GrenadeRestFx
  at: THREE.Vector3
  hold: number
  kind: 'explosion' | 'nappe' | 'halo'
  tint: FxTint
  /** How far the explosion's center rises over `at` (`blastLiftOver`): none for a detonation already in the air. */
  lift: number
}

export class Flights3dLayer implements ActionLayer3d {
  private readonly trails: SegmentPool
  private readonly heads: InstancePool
  /** Plasma orbs' cores (additive). */
  private readonly plasmaCore: InstancePool
  /** Plasma orbs' halos (additive, wider, more muted). */
  private readonly plasmaHalo: InstancePool
  private readonly blasts: InstancePool
  private readonly nappes: InstancePool
  /** Damage-radius spheres (analysis aid). */
  private readonly radii: InstancePool
  private readonly explosions: Explosions3d
  private readonly pools: readonly { begin(): void; end(): void; dispose(): void }[]
  private readonly flashInk = new THREE.Color()
  private readonly models: WeaponModelPool
  private readonly flights: Flight[]
  /** Grenades stuck point-blank, with no flight (`stuckGrenades3d`). */
  private readonly sticks: StuckGrenade[]
  private readonly blastList: Blast[]
  private readonly maxHold: number
  private readonly maxSpan: number
  private readonly p = new THREE.Vector3()
  private readonly q = new THREE.Quaternion()
  /** The world matrix of an attached projectile's bone, and its parts (`drawAttached`). */
  private readonly bone = new THREE.Matrix4()
  private readonly boneAt = new THREE.Vector3()
  private readonly boneQ = new THREE.Quaternion()
  private readonly boneScale = new THREE.Vector3()
  private readonly orbTint = new THREE.Color()
  private readonly orbCore = new THREE.Color()
  private readonly orbHalo = new THREE.Color()
  private readonly ctx: ActionContext

  constructor(ctx: ActionContext) {
    this.ctx = ctx
    const glow = () => new THREE.MeshBasicMaterial({ toneMapped: false })
    const additive = () => new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    const veil = () => new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.4, depthWrite: false })
    this.flights = buildFlights(ctx).sort((a, b) => a.t0 - b.t0)
    this.sticks = ctx.doc.grenades.some((g) => g.deto && g.proj === undefined)
      ? stuckGrenadesOf(ctx.doc.grenades, [...new Set(ctx.doc.tracks.map((t) => t.slot))], (slot, f) => ctx.slotState(slot, f))
      : []
    this.blastList = buildBlasts(ctx, this.flights).sort((a, b) => a.rest.frame - b.rest.frame)
    this.maxHold = this.blastList.reduce((m, b) => Math.max(m, b.hold), 0)
    this.maxSpan = this.flights.reduce((m, f) => Math.max(m, lastFrame(f) - f.t0), 0)
    const longest = this.flights.reduce((m, f) => Math.max(m, f.pts.length), 0)
    this.trails = new SegmentPool(ctx.root, glow(), Math.max(64, Math.min(4096, longest * 24)))
    this.heads = new InstancePool(ctx.root, new THREE.SphereGeometry(1, 8, 6), glow(), 256)
    this.plasmaCore = new InstancePool(ctx.root, new THREE.SphereGeometry(1, 12, 8), additive(), 256)
    this.plasmaHalo = new InstancePool(ctx.root, new THREE.SphereGeometry(1, 16, 10), additive(), 256)
    this.blasts = new InstancePool(ctx.root, new THREE.SphereGeometry(1, 16, 12), veil(), 128)
    this.nappes = new InstancePool(ctx.root, new THREE.CylinderGeometry(1, 1, 0.04, 24), veil(), 64)
    const shell = new THREE.MeshBasicMaterial({
      toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
    this.radii = new InstancePool(ctx.root, new THREE.SphereGeometry(1, 24, 16), shell, 64)
    this.explosions = new Explosions3d(ctx.root)
    this.pools = [this.trails, this.heads, this.plasmaCore, this.plasmaHalo, this.blasts, this.nappes, this.radii, this.explosions]
    this.models = new WeaponModelPool(ctx.root)
  }

  update(frame: number): void {
    for (const pool of this.pools) pool.begin()
    this.models.begin()
    const inputs = this.ctx.inputs()
    const fps = Math.max(1, inputs.framesPerSecond)
    const ink = (tint: FxTint) => this.ctx.ink.of(inputs.inks.fx.tint[tint] || inputs.inks.fx.core)
    const grenadeInk = this.ctx.ink.of(inputs.inks.grenade)
    // Flights: those that started within the longest possible flight duration, sorted by start.
    for (let i = firstFrom(this.flights, (f) => f.t0, frame - this.maxSpan); i < this.flights.length; i++) {
      const f = this.flights[i]
      if (f.t0 > frame) break
      if (frame > lastFrame(f)) continue
      const before = drawRecorder.adds
      this.drawFlight(f, frame, f.grenade !== null ? grenadeInk : ink(f.tint), { fps, paths: inputs.aids.projectilePaths })
      if (drawRecorder.on && drawRecorder.adds > before) {
        const what = frame > f.end ? 'flights3d/at_rest' : 'flights3d/flight'
        drawRecorder.mark(ledgerId.projectile(f.index), what)
        if (f.grenadeIndex !== null) drawRecorder.mark(ledgerId.grenade(f.grenadeIndex), what)
      }
    }
    for (const s of this.sticks) {
      if (frame < s.from || frame >= s.detoT) continue
      const before = drawRecorder.adds
      this.drawStuck(s, frame, fps)
      if (drawRecorder.on && drawRecorder.adds > before) drawRecorder.mark(ledgerId.grenade(s.grenade), 'flights3d/stuck')
    }
    const core = this.ctx.ink.of(inputs.inks.fx.core)
    for (let i = firstFrom(this.blastList, (b) => b.rest.frame, frame - this.maxHold); i < this.blastList.length; i++) {
      const b = this.blastList[i]
      if (b.rest.frame > frame) break
      const age = (frame - b.rest.frame) / fps
      const before = drawRecorder.adds
      if (b.kind === 'explosion') {
        this.drawDetonation(b, age, ink(b.tint), core)
        if (drawRecorder.on && b.rest.id && drawRecorder.adds > before) drawRecorder.mark(b.rest.id, 'flights3d/explosion')
        if (inputs.aids.blastRadius && age < BLAST_RADIUS_SECONDS) {
          this.radii.add(b.at, null, BLAST_RADIUS, this.flashInk.copy(ink(b.tint)).multiplyScalar(0.2 * (1 - age / BLAST_RADIUS_SECONDS)))
        }
        continue
      }
      const u = (frame - b.rest.frame) / b.hold
      if (u <= 1) this.drawBlast(b, u, ink(b.tint))
      if (drawRecorder.on && b.rest.id && drawRecorder.adds > before) drawRecorder.mark(b.rest.id, `flights3d/${b.kind}`)
    }
    for (const pool of this.pools) pool.end()
  }

  dispose(): void {
    for (const pool of this.pools) pool.dispose()
    this.models.dispose()
  }

  /** drawDetonation: the explosion (`explosions3d`) and its light, `age` seconds after it. */
  private drawDetonation(b: Blast, age: number, tint: THREE.Color, core: THREE.Color): void {
    const style = blastStyleOf(b.tint)
    this.explosions.add(b.at, style, age, b.rest.seed, { core, tint }, b.lift)
    const light = blastLight(style, age)
    if (light > 0) this.ctx.flashes.add(b.at, this.flashInk.copy(tint).lerp(core, DETONATION_CORE_MIX), light, DETONATION_LIGHT_RANGE)
  }

  /** drawFlight: the projectile in flight; its traveled path only if the drawer asks for it (`paths`). */
  private drawFlight(f: Flight, frame: number, color: THREE.Color, { fps, paths }: { fps: number; paths: boolean }): void {
    const model = f.look === 'model' && f.grenade !== null ? this.ctx.grenadeModel(f.grenade) : null
    let i = 1
    for (; i < f.pts.length && f.at[i] <= frame; i++) {
      if (paths && frame <= f.end + TAIL_FRAMES) this.trails.add(f.pts[i - 1], f.pts[i], TRAIL_RADIUS, color)
    }
    if (f.attach && frame >= f.attach.from && frame <= f.detoT && this.drawAttached(f, frame, model, color, fps)) return
    if (frame > f.end) {
      // Placed before it detonates: the grenade waits for the explosion at the end of its flight.
      if (f.look === 'orb' && f.grenade !== null) this.drawPlasmaOrb(f, f.pts[f.pts.length - 1], frame, fps)
      else if (model && frame <= f.detoT) this.models.add(model, f.pts[f.pts.length - 1], this.spin(f.dist[f.dist.length - 1]))
      return
    }
    // The head: interpolated between the last point passed and the next.
    const head = flightPointAt(f.at, f.pts, frame, this.p)
    if (paths) this.trails.add(f.pts[i - 1], head, TRAIL_RADIUS, color)
    if (f.look === 'orb') this.drawPlasmaOrb(f, head, frame, fps)
    else if (model) this.models.add(model, head, this.spin(flightValueAt(f.at, f.dist, frame)))
    else this.heads.add(head, null, HEAD_RADIUS, color)
  }

  /**
   * drawAttached : a projectile stuck to a player, drawn on the bone the film names (`Flight.attach`),
   * moving with it. True when the scene answered for that bone (drawn there, or hidden in first
   * person on a bone the arms rig does not carry); false when no body is drawn for the parent, and
   * the caller keeps the flight's own placement.
   */
  private drawAttached(f: Flight, frame: number, model: THREE.Object3D | null, color: THREE.Color, fps: number): boolean {
    const a = f.attach as NonNullable<Flight['attach']>
    const where = this.ctx.attachBone?.(a.slot, a.node, this.bone) ?? 'none'
    if (where === 'none') return false
    if (where === 'hidden') return true
    this.bone.decompose(this.boneAt, this.boneQ, this.boneScale)
    const at = this.p.copy(a.pose).applyMatrix4(this.bone)
    if (f.look === 'orb' && f.grenade !== null) this.drawPlasmaOrb(f, at, frame, fps)
    else if (model) this.models.add(model, at, this.boneQ.multiply(this.spin(f.dist[f.dist.length - 1])))
    else this.heads.add(at, null, HEAD_RADIUS, color)
    return true
  }

  /**
   * drawPlasmaOrb: the plasma grenade, in flight or at rest — a blue-white core and a saturated
   * blue halo, additive, pulsed over time (`grenadeLook3d.plasmaPulse`). A shot projectile drawn
   * as an orb (`SHOT_ORB_RADIUS`, the fuel rod) takes its own tint and radius, in flight only.
   */
  private drawPlasmaOrb(f: Pick<Flight, 'tint' | 'orbRadius'>, at: THREE.Vector3, frame: number, fps: number): void {
    const fx = this.ctx.inputs().inks.fx
    const gain = 1 - PLASMA_PULSE_DEPTH / 2 + PLASMA_PULSE_DEPTH * plasmaPulse(frame / fps)
    this.orbTint.copy(this.ctx.ink.of(fx.tint[f.tint] || fx.tint.plasma_cool))
    this.orbCore.copy(this.orbTint).lerp(this.ctx.ink.of(fx.core), PLASMA_CORE_MIX)
    this.orbHalo.copy(this.orbTint).multiplyScalar(PLASMA_HALO_DIM * gain)
    this.plasmaCore.add(at, null, f.orbRadius * gain, this.orbCore)
    this.plasmaHalo.add(at, null, f.orbRadius * PLASMA_HALO_MULT, this.orbHalo)
  }

  /**
   * drawStuck: a grenade stuck point-blank (`stuckGrenades3d`), on the body it stuck to from the
   * stick until the explosion: the plasma orb, or the grenade's game model.
   */
  private drawStuck(s: StuckGrenade, frame: number, fps: number): void {
    const body = this.ctx.slotState(s.slot, frame)
    if (!body) return
    const w = stuckPointAt(s, body)
    const at = this.p.set(...toThree(w.x, w.y, w.z))
    const look = grenadeLookOf(s.rank)
    if (look.flight === 'orb') {
      this.drawPlasmaOrb({ tint: look.tint, orbRadius: PLASMA_CORE_RADIUS }, at, frame, fps)
      return
    }
    const model = this.ctx.grenadeModel(s.rank)
    if (model) this.models.add(model, at, this.q.identity())
  }

  /** spin : the grenade's orientation once it has travelled `dist` units. */
  private spin(dist: number): THREE.Quaternion {
    return this.q.setFromAxisAngle(SPIN_AXIS, dist * GRENADE_SPIN_PER_UNIT)
  }

  /** drawBlast: the Dynamo nappe or the halo of a flight's end with no detonation, `u` in [0, 1] over its duration. */
  private drawBlast(b: Blast, u: number, color: THREE.Color): void {
    if (b.kind === 'nappe') {
      this.nappes.add(b.at, null, new THREE.Vector3(NAPPE_RADIUS, 1, NAPPE_RADIUS), color)
      return
    }
    // Swells fast, then falls back: the halo reads as a flash, not an object.
    const r = HALO_RADIUS * (u < 0.15 ? u / 0.15 : 1 - ((u - 0.15) / 0.85) * 0.8)
    this.blasts.add(b.at, null, r, color)
  }
}

/** A flight's shooter or thrower, and the nature of what they fired. */
interface FlightOwner {
  slot: number
  /** The thrown grenade's rank, null for a shot. */
  grenade: number | null
  tint: FxTint
  /** The weapon key of the shot (`WeaponLabel.key`), undefined for a grenade. */
  key?: string
  /** The throw's index in `doc.grenades`, for a grenade. */
  grenadeIndex?: number
}

/** lastFrame: the last frame where a flight is drawn (its trail, or its grenade at rest). */
function lastFrame(f: Flight): number {
  return Math.max(f.end + TAIL_FRAMES, f.grenade !== null || f.attach ? f.detoT : 0)
}

function ownersOf(ctx: ActionContext): Map<number, FlightOwner> {
  const doc = ctx.doc
  const owners = new Map<number, FlightOwner>()
  doc.projectiles.forEach((pr, i) => {
    const shot = pr.shot !== undefined ? doc.shots[pr.shot] : undefined
    if (!shot) return
    const label = shot.w ? doc.weaponLabels?.[shot.w] : undefined
    const tint = fxTintOf(label?.tint ?? vehicleShotStyleOf(doc, shot.w)?.tint)
    owners.set(i, { slot: shot.slot, grenade: null, tint, key: label?.key })
  })
  for (const [gi, g] of doc.grenades.entries()) {
    if (g.proj !== undefined) owners.set(g.proj, { slot: g.slot, grenade: g.rank, tint: grenadeLookOf(g.rank).tint, grenadeIndex: gi })
  }
  return owners
}

function buildFlights(ctx: ActionContext): Flight[] {
  const owners = ownersOf(ctx)
  const out: Flight[] = []
  ctx.doc.projectiles.forEach((pr, i) => {
    if (pr.p.length < 2) return
    const owner = owners.get(i)
    const last = pr.p[pr.p.length - 1]
    const orbRadius = owner?.key !== undefined ? SHOT_ORB_RADIUS[owner.key] : undefined
    // THE FLIGHT AT THE FILM'S RATE (schema 127): when `fullRate` is present, sample the native
    // series (one point per film record, ~16.7 ms) for the head's position and trail; the grid
    // points (`p`/`z`) stay the fallback for artifacts before 127. The native series carries the
    // same arc and bounces, at the film's own rate, so the head moves smoothly between grid frames.
    // The document is normalized: `pr.fullRate` is already the decoded flight
    // (`ReplayFullRateFlightReady`, one decode at the boundary, `replayNormalize.ts`), so read it
    // as is. Its `t` is ABSOLUTE fractional frames (ms since the GRID ORIGIN / frameIntervalMs,
    // the same axis as the grid path's `pr.t0 + st[0]` — `ajouter` in `projectiles.go` divides
    // each sample's film timestamp by the grid origin, not the flight's), so no `t0` is added.
    const fr = pr.fullRate
    const at = fr ? fr.t : pr.p.map((st) => pr.t0 + st[0])
    const pts = fr
      ? fr.t.map((_, k) => new THREE.Vector3(...toThree(fr.x[k], fr.y[k], fr.z[k])))
      : pr.z ? publishedPoints(pr.p, pr.z) : guessedPoints(ctx, pr, owner)
    out.push({
      index: i,
      grenadeIndex: owner?.grenadeIndex ?? null,
      t0: pr.t0,
      at,
      pts,
      dist: distancesAlong(pts),
      end: pr.t0 + last[0],
      detoT: pr.detoT,
      grenade: owner?.grenade ?? null,
      look: owner && owner.grenade !== null ? grenadeLookOf(owner.grenade).flight : orbRadius !== undefined ? 'orb' : 'model',
      orbRadius: orbRadius ?? PLASMA_CORE_RADIUS,
      tint: owner?.tint ?? 'neutral',
      attach: attachOf(pr),
    })
  })
  return out
}

/**
 * attachOf : a flight's attach in three axes. The pose is published in the Halo axes of the bone,
 * and the GLB's bones carry the same frame converted as the scene is (`halo(x, z, -y)`).
 */
function attachOf(pr: ReplayProjectileReady): Flight['attach'] {
  const a = pr.attach
  if (!a || a.fromFrame > pr.detoT) return null
  const [x, y, z] = a.pose
  return { from: a.fromFrame, slot: a.parentSlot, node: a.node, pose: new THREE.Vector3(x, z, -y) }
}

/** publishedPoints : the points of a flight in three axes, at their published heights (schema 126). */
export function publishedPoints(steps: readonly (readonly number[])[], z: readonly number[]): THREE.Vector3[] {
  return steps.map((st, i) => new THREE.Vector3(...toThree(st[1], st[2], z[i])))
}

/**
 * guessedPoints : the points of a flight from an artifact without heights (before schema 126), the
 * height spread along the distance travelled from the thrower's hand to the floor under the
 * detonation point, searched below the start height.
 */
function guessedPoints(ctx: ActionContext, pr: ReplayProjectileReady, owner: FlightOwner | undefined): THREE.Vector3[] {
  const [x0, y0] = [pr.p[0][1], pr.p[0][2]]
  const s = owner ? ctx.slotState(owner.slot, pr.t0) : null
  const start = s ? s.z - ctx.originAboveFloor + MUZZLE_HEIGHT : (ctx.ground.floorY(x0, y0, null) ?? 0) + MUZZLE_HEIGHT
  const end = (ctx.ground.floorY(pr.detoX, pr.detoY, start) ?? start - MUZZLE_HEIGHT) + REST_LIFT
  return heightsAlong(pr.p, start, end)
}

/** distancesAlong : the distance travelled up to each point (u). */
function distancesAlong(pts: readonly THREE.Vector3[]): number[] {
  const out = [0]
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + pts[i].distanceTo(pts[i - 1]))
  return out
}

/** segmentAt : the index `i` of the point the flight left last at `frame` (`at[i] <= frame`), and the fraction toward `i + 1`. */
function segmentAt(at: readonly number[], frame: number): { i: number; u: number } {
  let lo = 0
  let hi = at.length - 1
  if (frame <= at[0]) return { i: 0, u: 0 }
  if (frame >= at[hi]) return { i: hi, u: 0 }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (at[mid] <= frame) lo = mid
    else hi = mid
  }
  const span = at[lo + 1] - at[lo]
  return { i: lo, u: span > 0 ? (frame - at[lo]) / span : 0 }
}

/**
 * flightPointAt : where the flight is at `frame` (fractional frames allowed), written to `out`. A
 * PURE function of the points and the frame, so a seek lands exactly where playing forward does.
 * Straight between two points: a bounce falls between two published points, and only a linear
 * step keeps both sides of it where the game put them (a spline overshoots into the floor).
 */
export function flightPointAt(at: readonly number[], pts: readonly THREE.Vector3[], frame: number, out: THREE.Vector3): THREE.Vector3 {
  const { i, u } = segmentAt(at, frame)
  if (u === 0 || i + 1 >= pts.length) return out.copy(pts[i])
  return out.lerpVectors(pts[i], pts[i + 1], u)
}

/** flightValueAt : a per-point value (the distance travelled) at `frame`, on the same segments as `flightPointAt`. */
function flightValueAt(at: readonly number[], values: readonly number[], frame: number): number {
  const { i, u } = segmentAt(at, frame)
  if (u === 0 || i + 1 >= values.length) return values[i]
  return values[i] + (values[i + 1] - values[i]) * u
}

/** heightsAlong: the flight's points in three axes, the height spread over the distance travelled. */
export function heightsAlong(steps: readonly (readonly number[])[], start: number, end: number): THREE.Vector3[] {
  const cum = [0]
  for (let i = 1; i < steps.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(steps[i][1] - steps[i - 1][1], steps[i][2] - steps[i - 1][2]))
  }
  const total = cum[cum.length - 1] || 1
  return steps.map((st, i) => {
    const [x, , z] = toThree(st[1], st[2], 0)
    return new THREE.Vector3(x, start + (end - start) * (cum[i] / total), z)
  })
}

function buildBlasts(ctx: ActionContext, flights: readonly Flight[]): Blast[] {
  const doc = ctx.doc
  const holdBlast = Math.max(1, msToFrames(GRENADE_REST_HOLD_MS, doc))
  const holdNappe = Math.max(1, msToFrames(DYNAMO_REST_HOLD_MS, doc))
  // The end of each flight, by explosion frame: the explosion is placed at the height the flight ends.
  const endsByFrame = new Map<number, THREE.Vector3[]>()
  for (const f of flights) endsByFrame.set(f.detoT, [...(endsByFrame.get(f.detoT) ?? []), f.pts[f.pts.length - 1]])
  return buildRestFx(doc).map((rest) => {
    const kind = rest.tint ? 'explosion' : restKindOf(rest.rank)
    const [x, publishedY, z] = toThree(rest.x, rest.y, rest.z ?? 0)
    const near = (endsByFrame.get(rest.frame) ?? []).find((e) => Math.hypot(e.x - x, e.z - z) < 1.5)
    // The published height first (a throw's own detonation, schema 129: on the body it stuck to).
    const y = rest.z !== undefined ? publishedY : near?.y ?? (ctx.ground.floorY(rest.x, rest.y, null) ?? 0) + REST_LIFT
    // A detonation published with its height (on the body it stuck to) is in the air: it keeps its point.
    const lift = rest.z !== undefined ? blastLiftOver(y, ctx.ground.floorY(rest.x, rest.y, y)) : BLAST_LIFT
    return {
      rest,
      lift,
      at: new THREE.Vector3(x, y, z),
      hold: kind === 'nappe' ? holdNappe : holdBlast,
      kind,
      tint: rest.tint ?? grenadeLookOf(rest.rank).tint,
    }
  })
}
