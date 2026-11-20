// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shots3d.ts — SHOTS IN THE 3D SCENE: muzzle flash (a spray of petals at the end of the drawn
 * barrel, `muzzleFlash3d`; a brief light, `flash3d`), a bullet in flight, an impact spark.
 *
 * Shots are the 2D's own (`buildShotFx`, continuous fire included), in the same discharge
 * tint. The 3D gives them a flight: the bullet leaves from the barrel of the weapon model the
 * shooter holds at the shot's frame (`muzzle3d`: the Spartan's hand, or a 1st-person hold when
 * the camera is the shooter), or, with no such models and for a vehicle shot, from
 * `MUZZLE_HEIGHT` above its feet; it follows its aim's direction (the shot's heading, its
 * aim's pitch), and flies toward the first wall it hits as a short streak at a bullet's speed
 * (`tracerSpan`); it goes out at impact, which throws a brief spark. Durations are in real
 * time, converted by the document's frame rate: the 2D's 0.6 s persistence, applied to a
 * streak stretched from muzzle to wall, would have made it a laser.
 *
 * An energy projectile shot (the `BOLT_SPEED` families: plasma, needles) has no streak: a fire
 * point flies at its own, slower speed, to the wall.
 *
 * The spread shot (family `spread`, the Heatwave) is a fan of energy bolts, each a short glowing
 * streak that flies at its projectile speed, ricochets once off the scenery and sparks where it ends
 * (`spreadShots3d`). As a `light` tracer (the 0.4 mm wire of a bullet, at a bullet's speed) it was
 * not seen at all.
 *
 * The shock shot (family `shock`) has neither bullet nor streak: THREE sound electric beams,
 * from muzzle to wall (`shockShots3d`), full at the instant of the shot, jittered per bucket
 * and faded linearly over `SHOCK_BEAM_SECONDS`. A camera script's `shockLook: 'arc'` draws it
 * instead as a thin forking electric bolt with an arc burst at the impact (`shockArcShot3d`), and
 * `shockLook: 'game'` with the game's own firing, flight and impact effects read from the weapon
 * library (`gameShotEffects3d`), in place of the spray, beams and spark (the flash light stays: the
 * firing effect's own light is not read); while the library has no shot for the weapon, the beams.
 *
 * The muzzle flash is placed at the end of the weapon the scene DRAWS at the displayed frame
 * (`drawnWeapon`): in 1st person, the drawn weapon is the arms + weapon rig, which has no
 * weapon in the Spartan's hand — the spray is then at the muzzle of the rig the flight left
 * from (`viewPath`), along the shot's direction. With no drawn weapon, no spray, only the
 * light, at the flight's origin.
 *
 * A shot with no readable heading has no bullet, only the flash: the 2D makes it a round
 * puff, for the same reason (no invented direction). The film does not say what a bullet hit:
 * the impact point is the scenery's own, never a player.
 *
 * The entire shot line (from muzzle to wall, held for the 2D's persistence) is an analysis aid
 * (`aids3d.shotLines`), off by default: the game does not show it.
 */
import * as THREE from 'three'

import type { ShotFamily } from '../layers/shotEffects'
import type { ShotFxEntry } from '../model/shotFx'
import { InstancePool, SegmentPool, firstFrom } from './actionKit'
import type { ActionContext, ActionLayer3d } from './actionScene3d'
import { EYE_HEIGHT, MUZZLE_HEIGHT } from './body3d'
import { newClipMix, type ClipMix } from './clipSample3d'
import { petalGeometry } from './flash3d'
import { heldWeaponAt } from './heldWeapon3d'
import { Motion3d } from './motion3d'
import { MuzzleProbe, muzzleOfModel, viewMuzzle } from './muzzle3d'
import { GameShotEffects } from './gameShotEffects3d'
import { flashPetals, muzzleFlashSite, muzzleFlashStrength, rigFlashSite, type FlashPetal } from './muzzleFlash3d'
import { newRecoil, type Recoil } from './recoil3d'
import { recoilPoint } from './recoilPose3d'
import { boltEndAge, boltPath, boltTrail, spreadDirections, SPREAD_BOUNCE_RANGE, SPREAD_RANGE, SPREAD_SPEED, SPREAD_TRAIL, type BoltPath } from './spreadShots3d'
import { shockBeamPaths, shockJitterBucket, SHOCK_BEAM_SECONDS, SHOCK_BEAMS, SHOCK_HD, type ShockBeam } from './shockShots3d'
import {
  ARC_CORE_MIN_PX,
  ARC_CORE_RADIUS,
  ARC_CORE_WHITE,
  ARC_GLOW_DIM,
  ARC_GLOW_MIN_PX,
  ARC_GLOW_MULT,
  shockArcStrokes,
  shockImpactArcs,
  widenedMaterial,
  type ArcStroke,
} from './shockArcShot3d'
import { ShooterRecoil } from './recoilShots3d'
import { aimDirThree, toThree } from './tracks3d'
import { viewGripOf } from './viewGrip3d'
import { weaponModelKey } from './weaponModels3d'

// A bullet's apparent speed: 300 u/s, ~900 m/s (one unit is ~3 m).
export const TRACER_SPEED = 300
// A flying bullet's streak length: ~3.5 m, a bullet's on-screen trail.
export const TRACER_LENGTH = 1.2
// A bullet's range with no wall: ~240 m.
const TRACER_RANGE = 80
// ~2.5 mm thick: a wire, which does not block the 1st-person view.
const TRACER_RADIUS = 0.0004
// The fallback muzzle sits a little in front of the body, at the end of the weapon.
const MUZZLE_FORWARD = 0.3
// The flash's spray: the weapon's tint mixed with white; and a brief light that lights the
// shooter and nearby scenery.
const PETAL_CORE_MIX = 0.3
// The camera's weapon spray is drawn after the rest of the scene.
const VIEW_FLASH_ORDER = 10
export const MUZZLE_LIGHT = 2.5
const MUZZLE_LIGHT_RANGE = 2.5
export const IMPACT_SECONDS = 0.12
const IMPACT_RADIUS = 0.012
// The bullet's white, mixed into the weapon's tint: a hot streak, not a neon of the pure color.
const CORE_MIX = 0.5
// Energy discharges (plasma, electric, Forerunner...) keep their own color: the game shows a
// saturated bolt, so only a touch of the white core goes in.
const ENERGY_CORE_MIX = 0.1
const CAPACITY = 512
// The arc look's batches: a 30 u bolt is 128 pieces, its 32 forks 8 each, the impact 16 (~400
// a shot): room for ten shots alive at once.
const ARC_CAPACITY = 4096
const WHITE = new THREE.Color(1, 1, 1)
// 1st-person shot scratch buffers: the camera frame is rotated into the aim, no shot allocates.
const VIEW_UP = new THREE.Vector3(0, 1, 0)
const VIEW_Q = new THREE.Quaternion()
const VIEW_M = new THREE.Matrix4()
const SCRATCH_TARGET = new THREE.Vector3()
const SCRATCH_VIEW = new THREE.Vector3()
const SCRATCH_MUZZLE = new THREE.Vector3()
/**
 * The families whose shot is a slow, glowing projectile, not a bullet: a fire point flying at
 * its own speed (u/s) to the wall, with no streak. Speeds picked by eye, in the game's own range.
 */
export const BOLT_SPEED: Partial<Record<ShotFamily, number>> = { plasma: 45, needles: 25 }
// ~8 cm: an energy projectile's fire point.
const BOLT_RADIUS = 0.025
// The shock shot's beam: the entire electric arc, from muzzle to wall.
export const BEAM_RADIUS = 0.012
// The beam's glow: a second segment on the same path, at this multiple of the core's radius
// and this fraction of its intensity, with the same fade.
export const BEAM_GLOW_MULT = 4
export const BEAM_GLOW_DIM = 0.25
// The beam's life: full at the instant of the shot, faded linearly down to zero.
export const BEAM_SECONDS = 0.25
// The shot line (analysis aid): a wire a little thicker than the bullet, muted.
const LINE_RADIUS = 0.004
const LINE_DIM = 0.6
// The spread's bolt: a streak this thick (~9 cm, an ESTIMATE of the game's glowing bar), and its
// glow around it at the beam's multiple and dim.
export const SPREAD_BOLT_RADIUS = 0.03
// A shot's longest life: the slowest projectile's flight to range, then the spark.
const SLOWEST = Math.min(TRACER_SPEED, ...Object.values(BOLT_SPEED))
const LIFE_SECONDS = Math.max((TRACER_RANGE + TRACER_LENGTH) / SLOWEST, (SPREAD_RANGE + SPREAD_BOUNCE_RANGE + SPREAD_TRAIL) / SPREAD_SPEED) + IMPACT_SECONDS

interface ShotPath {
  from: THREE.Vector3
  /** The flight's end; null with no readable heading. */
  to: THREE.Vector3 | null
  /** The flight stops on the scenery (rather than at the maximum range). */
  hit: boolean
  /** The flight's length, in units. */
  length: number
}

/**
 * tracerSpan: the portion of the flight (distances from the muzzle) the bullet's streak
 * covers `age` seconds after the shot, null once the bullet has finished its run. The head
 * advances at `TRACER_SPEED` and stops at the flight's end; the tail follows it at
 * `TRACER_LENGTH` and retracts into the impact point.
 */
export function tracerSpan(length: number, age: number, speed = TRACER_SPEED, trail = TRACER_LENGTH): { tail: number; head: number } | null {
  if (age < 0) return null
  const head = Math.min(length, age * speed)
  const tail = Math.max(0, age * speed - trail)
  return tail < length ? { tail, head } : null
}

/** impactAge: the age (s) of a `length`-unit flight's spark, null before the projectile arrives. */
export function impactAge(length: number, age: number, speed = TRACER_SPEED): number | null {
  const since = age - length / speed
  return since >= 0 && since < IMPACT_SECONDS ? since : null
}

/** shotLineShown: the shot line (analysis aid) holds the 2D's persistence, `holdSeconds`. */
export function shotLineShown(age: number, holdSeconds: number): boolean {
  return age >= 0 && age <= holdSeconds
}

/**
 * What a shot's FLIGHT draws by its family: an instant beam (shock shot), a slow fire point
 * (energy projectile, the `BOLT_SPEED` families), or a short streak flying at a bullet's
 * speed.
 */
export type ShotFlightForm = 'beam' | 'bolt' | 'tracer' | 'spread'

/** flightForm: a shot family's flight shape. */
export function flightForm(fam: ShotFamily): ShotFlightForm {
  if (fam === 'shock') return 'beam'
  if (fam === 'spread') return 'spread'
  return BOLT_SPEED[fam] !== undefined ? 'bolt' : 'tracer'
}

/**
 * beamFade: the shock shot's beam strength (0..1) `age` seconds after the shot: full at the
 * instant, faded linearly down to zero at `seconds`, out beyond it.
 */
export function beamFade(age: number, seconds: number = BEAM_SECONDS): number {
  if (age < 0) return 0
  return Math.min(1, Math.max(0, 1 - age / seconds))
}

/**
 * scopedNoSpray: a 1st-person view shot's spray withdraws when the scope is mounted on
 * that view: the arms leave the screen, there is no more drawn muzzle to place it at (it
 * would fly to the center of the screen). The tracked player's scope does not affect a shot
 * seen from 3rd person, whose Spartan keeps its drawn weapon.
 */
export function scopedNoSpray(firstPerson: boolean, scopeMounted: boolean): boolean {
  return firstPerson && scopeMounted
}

/**
 * What a shot says of its drawing: the shot, its family, its line's persistence (s, negative:
 * off), and whether the camera is the shooter (1st person).
 */
interface ShotLook {
  e: ShotFxEntry
  fam: ShotFamily
  hold: number
  view: boolean
}

export class Shots3dLayer implements ActionLayer3d {
  private readonly tracers: SegmentPool
  private readonly lines: SegmentPool
  private readonly dots: InstancePool
  private readonly petals: InstancePool
  /** The camera's weapon spray: over the weapon, whose body hides the muzzle from the eye. */
  private readonly viewPetals: InstancePool
  private pools: readonly { begin(): void; end(): void; dispose(): void }[]
  /** The arc look's core and glow batches (`arcPools`), null until a script asks for it. */
  private arcs: { core: SegmentPool; glow: SegmentPool } | null = null
  /** The game look's effects (`gameShotEffects3d`), made on its first use. */
  private game: GameShotEffects | null = null
  private readonly lineInk = new THREE.Color()
  private readonly arcInk = new THREE.Color()
  private source: readonly ShotFxEntry[] | null = null
  private sorted: ShotFxEntry[] = []
  private readonly paths = new Map<ShotFxEntry, ShotPath | null>()
  /** The spread's bolts of each flight, traced once. */
  private readonly spreads = new WeakMap<ShotPath, BoltPath[]>()
  /** The shock shot's three beams, filled every frame (reusable buckets). */
  private readonly shockBeams: ShockBeam[] = Array.from({ length: SHOCK_BEAMS }, () => ({ points: [] }))
  private readonly fromMuzzle = new Map<ShotFxEntry, ShotPath | null>()
  private readonly fromView = new Map<ShotFxEntry, ShotPath | null>()
  /** Each shot's held weapon (id), read once. */
  private readonly held = new Map<ShotFxEntry, string | null>()
  private readonly probe = new MuzzleProbe()
  private readonly recoil: ShooterRecoil
  private readonly kick = newRecoil()
  private readonly motion: Motion3d
  private readonly mix = newClipMix()
  private slotXuid: Map<number, string | null> | null = null
  private readonly a = new THREE.Vector3()
  private readonly b = new THREE.Vector3()
  private readonly c = new THREE.Color()
  private readonly petalInk = new THREE.Color()
  private readonly muzzle = new THREE.Vector3()
  private readonly barrel = new THREE.Vector3()
  private readonly burst: FlashPetal[] = []
  private readonly ctx: ActionContext

  constructor(ctx: ActionContext) {
    this.ctx = ctx
    this.recoil = new ShooterRecoil(ctx.doc, () => ctx.inputs())
    this.motion = new Motion3d(ctx, (slot, frame) => heldWeaponAt(ctx.doc, slot, Math.floor(frame), ctx.inputs().locale))
    const glow = () => new THREE.MeshBasicMaterial({
      toneMapped: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.tracers = new SegmentPool(ctx.root, glow(), CAPACITY)
    // Twice the others: a Heatwave pull alone draws 7 bolts of 5 trail pieces, each with its glow.
    this.lines = new SegmentPool(ctx.root, glow(), CAPACITY * 2)
    this.dots = new InstancePool(ctx.root, new THREE.SphereGeometry(1, 8, 6), glow(), CAPACITY)
    const petal = glow()
    petal.vertexColors = true
    petal.side = THREE.DoubleSide
    this.petals = new InstancePool(ctx.root, petalGeometry(), petal, CAPACITY)
    // In 1st person the barrel points straight ahead of the eye: the weapon's body hides its
    // muzzle. The spray draws in front (as the game draws the weapon and its effects apart);
    // nothing else belongs between the eye and a muzzle ~25 cm away.
    const overWeapon = petal.clone()
    overWeapon.depthTest = false
    this.viewPetals = new InstancePool(ctx.root, petalGeometry(), overWeapon, CAPACITY)
    this.viewPetals.mesh.renderOrder = VIEW_FLASH_ORDER
    this.pools = [this.tracers, this.lines, this.dots, this.petals, this.viewPetals]
  }

  update(frame: number): void {
    const inputs = this.ctx.inputs()
    for (const pool of this.pools) pool.begin()
    if (inputs.show.shots) {
      if (inputs.shotFx !== this.source) this.reindex(inputs.shotFx)
      const fps = Math.max(1, inputs.framesPerSecond)
      const fx = inputs.inks.fx
      const core = this.ctx.ink.of(fx.core)
      const firstPerson = this.ctx.firstPersonSlot(frame)
      const hold = inputs.aids.shotLines ? inputs.shotHoldFrames / fps : -1
      // The game look's impact outlives the other shots' life (its surface event alone is 1.75 s).
      const gameLife = this.ctx.scriptShockLook?.() === 'game' ? this.gameEffects().lifeSeconds() : 0
      const window = Math.max(LIFE_SECONDS, hold, gameLife) * fps
      for (let i = firstFrom(this.sorted, (e) => e.time, frame - window); i < this.sorted.length; i++) {
        const e = this.sorted[i]
        if (e.time > frame) break
        const fp = e.slot === firstPerson
        const path = this.pathOf(e, fp)
        const mix = e.tint === 'kinetic' || !fx.tint[e.tint] ? CORE_MIX : ENERGY_CORE_MIX
        const tint = this.c.copy(this.ctx.ink.of(fx.tint[e.tint] || fx.core)).lerp(core, mix)
        if (path) this.draw(path, (frame - e.time) / fps, tint, core, { e, fam: e.fam, hold, view: fp })
      }
    }
    for (const pool of this.pools) pool.end()
  }

  dispose(): void {
    for (const pool of this.pools) pool.dispose()
  }

  /**
   * flightLine: shot `e`'s flight as this layer draws it at frame `frame` (from the muzzle toward where
   * it ends), null with no readable heading. The shield impact on the victim reuses it
   * (`shieldImpacts3d`), so the patch sits where the drawn tracer crosses the body.
   */
  flightLine(e: ShotFxEntry, frame: number): { from: THREE.Vector3; to: THREE.Vector3 } | null {
    const path = this.pathOf(e, e.slot === this.ctx.firstPersonSlot(frame))
    return path?.to ? (path as { from: THREE.Vector3; to: THREE.Vector3 }) : null
  }

  private reindex(shotFx: readonly ShotFxEntry[]): void {
    this.source = shotFx
    this.sorted = [...shotFx].sort((p, q) => p.time - q.time)
    this.paths.clear()
    this.fromMuzzle.clear()
    this.fromView.clear()
    this.held.clear()
  }

  /**
   * draw: the muzzle flash, the bullet (short streak) or the energy projectile (fire point) on
   * its flight, the spark that goes out at the impact point; the entire shot line if the
   * drawer asks for it (`hold` in seconds, negative: off).
   */
  private draw(path: ShotPath, age: number, tint: THREE.Color, core: THREE.Color, shot: ShotLook): void {
    // The game look draws the shock shot's firing effect in place of the spray (the light stays).
    const game = flightForm(shot.fam) === 'beam' && path.to !== null && this.gameShot(shot)
    const k = muzzleFlashStrength(age)
    if (k > 0) this.flash(path, k, tint, core, shot, !game)
    if (!path.to) return
    if (game) {
      if (shotLineShown(age, shot.hold)) this.lines.add(path.from, path.to, LINE_RADIUS, this.lineInk.copy(tint).multiplyScalar(LINE_DIM))
      this.drawShockGame(path, path.to, age, shot)
      return
    }
    if (shotLineShown(age, shot.hold)) this.lines.add(path.from, path.to, LINE_RADIUS, this.lineInk.copy(tint).multiplyScalar(LINE_DIM))
    if (flightForm(shot.fam) === 'spread') {
      this.drawSpread(path, path.to, age, tint)
      return
    }
    if (flightForm(shot.fam) === 'beam') {
      // The shock shot: three beams, from muzzle to wall; its impact is at zero range, the
      // spark is born at the shot.
      this.drawShock(path, path.to, age, tint, shot)
      return
    }
    const bolt = BOLT_SPEED[shot.fam]
    const speed = bolt ?? TRACER_SPEED
    const span = tracerSpan(path.length, age, speed, bolt ? 0 : TRACER_LENGTH)
    if (span) {
      const dir = this.b.subVectors(path.to, path.from).divideScalar(path.length)
      if (bolt) {
        this.dots.add(this.a.copy(path.from).addScaledVector(dir, span.head), null, BOLT_RADIUS, tint)
      } else {
        const tail = this.a.copy(path.from).addScaledVector(dir, span.tail)
        this.tracers.add(tail, dir.multiplyScalar(span.head).add(path.from), TRACER_RADIUS, tint)
      }
    }
    const spark = path.hit ? impactAge(path.length, age, speed) : null
    if (spark !== null) this.dots.add(path.to, null, IMPACT_RADIUS * (1 - spark / IMPACT_SECONDS), tint)
  }

  /**
   * drawSpread : the spread's bolts on their flights (fanned around the shot's aim, one ricochet
   * each), a core streak and its glow, and the spark where a bolt ends on the scenery.
   */
  private drawSpread(path: ShotPath, to: THREE.Vector3, age: number, tint: THREE.Color): void {
    let bolts = this.spreads.get(path)
    if (!bolts) {
      const dir = this.b.subVectors(to, path.from).normalize()
      const hitFace = (from: THREE.Vector3, d: THREE.Vector3, far: number) => this.ctx.ground.hitFace(from, d, far)
      bolts = spreadDirections(dir).map((d) => boltPath(path.from, d, hitFace))
      this.spreads.set(path, bolts)
    }
    for (const bolt of bolts) {
      // The trail: bright at the head, fading along its length, its glow fading with it.
      boltTrail(bolt, age, (tail, head, k) => {
        this.lines.add(tail, head, SPREAD_BOLT_RADIUS, this.lineInk.copy(tint).multiplyScalar(k))
        this.lines.add(tail, head, SPREAD_BOLT_RADIUS * BEAM_GLOW_MULT, this.lineInk.copy(tint).multiplyScalar(BEAM_GLOW_DIM * k))
      })
      const spark = bolt.hit ? age - boltEndAge(bolt) : -1
      if (spark >= 0 && spark < IMPACT_SECONDS) this.dots.add(bolt.points[bolt.points.length - 1], null, IMPACT_RADIUS * 2 * (1 - spark / IMPACT_SECONDS), tint)
    }
  }

  /**
   * drawShock : the shock shot's THREE jagged beams from the muzzle to the end point (the same end
   * point the generic flight uses), full at the shot, jitter re-seeded per bucket, faded linearly
   * over SHOCK_BEAM_SECONDS; a core and a glow per jagged piece, boosted to cross the bloom
   * threshold. The spark is born at the shot (the impact is at zero range).
   */
  private drawShock(path: ShotPath, to: THREE.Vector3, age: number, tint: THREE.Color, shot: ShotLook): void {
    if (this.ctx.scriptShockLook?.() === 'arc') {
      this.drawShockArc(path, to, age, tint, shot)
      return
    }
    const fade = beamFade(age, SHOCK_BEAM_SECONDS)
    if (fade > 0) {
      const beams = shockBeamPaths(path.from, to, shot.e.seed, shockJitterBucket(age), this.shockBeams)
      for (const beam of beams) {
        for (let k = 1; k < beam.points.length; k++) {
          this.lines.add(beam.points[k - 1], beam.points[k], BEAM_RADIUS, this.lineInk.copy(tint).multiplyScalar(fade * SHOCK_HD))
          this.lines.add(beam.points[k - 1], beam.points[k], BEAM_RADIUS * BEAM_GLOW_MULT, this.lineInk.copy(tint).multiplyScalar(fade * SHOCK_HD * BEAM_GLOW_DIM))
        }
      }
    }
    const spark = path.hit ? impactAge(0, age) : null
    if (spark !== null) this.dots.add(to, null, IMPACT_RADIUS * (1 - spark / IMPACT_SECONDS), tint)
  }

  /**
   * drawShockArc : the shock shot as electricity (camera-script `shockLook: 'arc'`,
   * `shockArcShot3d`): the jagged core bolt and its forks, re-seeded per jitter bucket and faded
   * over SHOCK_BEAM_SECONDS like the beams; the impact's arcs at the end point when the shot hit,
   * each living its own tag life; the same spark as the beams. Every stroke is a blue-white core
   * and a dim glow in their own batches, which never thin below their minimum on-screen width.
   */
  private drawShockArc(path: ShotPath, to: THREE.Vector3, age: number, tint: THREE.Color, shot: ShotLook): void {
    const arcs = this.arcPools()
    const fade = beamFade(age, SHOCK_BEAM_SECONDS)
    if (fade > 0) for (const s of shockArcStrokes(path.from, to, shot.e.seed, shockJitterBucket(age))) this.arcStroke(arcs, s, fade, tint)
    if (path.hit && path.length > 1e-6) {
      const back = this.b.subVectors(path.from, to).divideScalar(path.length)
      for (const s of shockImpactArcs(to, back, shot.e.seed, age)) this.arcStroke(arcs, s, 1, tint)
    }
    const spark = path.hit ? impactAge(0, age) : null
    if (spark !== null) this.dots.add(to, null, IMPACT_RADIUS * (1 - spark / IMPACT_SECONDS), tint)
  }

  /** gameShot: the shock shot draws the game look (`shockLook: 'game'` and a library shot for its weapon). */
  private gameShot(shot: ShotLook): boolean {
    if (this.ctx.scriptShockLook?.() !== 'game') return false
    const held = this.heldOf(shot.e)
    return this.gameEffects().has(held ? weaponModelKey(held) : null)
  }

  /**
   * drawShockGame : the shock shot as the game draws it (`gameShotEffects3d`): the barrel's firing
   * effect, the projectile's flight effect along the shot's aim, the impact effect where it hits.
   */
  private drawShockGame(path: ShotPath, to: THREE.Vector3, age: number, shot: ShotLook): void {
    const held = this.heldOf(shot.e)
    const key = held ? weaponModelKey(held) : null
    if (!key || path.length <= 1e-6) return
    const dir = this.b.subVectors(to, path.from).divideScalar(path.length)
    const xuid = shot.e.vehicleShot ? null : this.xuidOf(shot.e.slot)
    this.gameEffects().draw({ e: shot.e, key, xuid, firstPerson: shot.view, from: path.from, dir, age })
  }

  /** gameEffects: the game look's effects, made on first use (the default look's scene has none). */
  private gameEffects(): GameShotEffects {
    if (!this.game) {
      this.game = new GameShotEffects(this.ctx)
      // Opened mid-frame: the pools of this frame were begun already.
      this.game.begin()
      this.pools = [...this.pools, this.game]
    }
    return this.game
  }

  /** arcStroke: one stroke of the arc look, its core (tint toward white) and its glow, at strength `k`. */
  private arcStroke(arcs: { core: SegmentPool; glow: SegmentPool }, s: ArcStroke, k: number, tint: THREE.Color): void {
    const strength = k * s.strength * SHOCK_HD
    const core = this.arcInk.copy(tint).lerp(WHITE, ARC_CORE_WHITE).multiplyScalar(strength)
    const glow = this.lineInk.copy(tint).multiplyScalar(strength * ARC_GLOW_DIM)
    const r = ARC_CORE_RADIUS * s.width
    for (let i = 1; i < s.points.length; i++) {
      arcs.core.add(s.points[i - 1], s.points[i], r, core)
      arcs.glow.add(s.points[i - 1], s.points[i], r * ARC_GLOW_MULT, glow)
    }
  }

  /** arcPools: the arc look's batches, made on its first use (the default look's scene has none). */
  private arcPools(): { core: SegmentPool; glow: SegmentPool } {
    if (!this.arcs) {
      const core = widenedMaterial(ARC_CORE_MIN_PX)
      const glow = widenedMaterial(ARC_GLOW_MIN_PX)
      const arcs = { core: new SegmentPool(this.ctx.root, core.material, ARC_CAPACITY), glow: new SegmentPool(this.ctx.root, glow.material, ARC_CAPACITY) }
      core.attach(arcs.core.mesh)
      glow.attach(arcs.glow.mesh)
      // Opened mid-frame: the pools of this frame were begun already.
      arcs.core.begin()
      arcs.glow.begin()
      this.arcs = arcs
      this.pools = [...this.pools, arcs.core, arcs.glow]
    }
    return this.arcs
  }

  /**
   * flash: the muzzle flash at strength `k` (`muzzleFlashStrength`): the spray at the end of
   * the weapon the scene draws for the shooter, along its barrel, and the light. In 1st
   * person the rig has no drawn weapon: the spray is placed at the LIVE rig's muzzle, read at
   * the frame (`ctx.rigMuzzleWorld`), along its drawn barrel; with no rig, `rigFlashSite`
   * places it at the flight's muzzle. With no drawn weapon, the light alone, at the flight's
   * origin: no shape is placed outside a drawn barrel. `spray` false: the light alone (the game look
   * draws the weapon's own firing effect).
   */
  private flash(path: ShotPath, k: number, tint: THREE.Color, core: THREE.Color, shot: ShotLook, spray = true): void {
    const e = shot.e
    const xuid = e.vehicleShot ? null : this.xuidOf(e.slot)
    const drawn = xuid ? this.ctx.drawnWeapon(xuid) : null
    const site =
      (shot.view && e.vehicleShot === null && this.rigLoaded(e) && this.ctx.rigMuzzleWorld?.(this.muzzle, this.barrel) === true) ||
      muzzleFlashSite(e.vehicleShot !== null, drawn, this.muzzle, this.barrel) ||
      rigFlashSite(shot.view && e.vehicleShot === null && this.rigLoaded(e), path, this.muzzle, this.barrel)
    this.ctx.flashes.add(site ? this.muzzle : path.from, tint, MUZZLE_LIGHT * k, MUZZLE_LIGHT_RANGE)
    // Scope mounted: the arms are removed from the screen, the spray has no more drawn muzzle
    // to be placed at (with no muzzle it would fly to the center of the screen); the light and
    // the shot itself remain.
    if (!spray || !site || scopedNoSpray(shot.view, this.ctx.scopeMounted?.() === true)) return
    const color = this.petalInk.copy(tint).lerp(core, PETAL_CORE_MIX).multiplyScalar(k)
    const pool = shot.view ? this.viewPetals : this.petals
    for (const p of flashPetals(this.barrel, k, e.seed, this.burst)) pool.add(this.muzzle, p.rotation, p.size, color)
  }

  /** rigLoaded: the shot's held weapon's 1st-person rig is loaded (`ctx.rigMuzzle`). */
  private rigLoaded(e: ShotFxEntry): boolean {
    const held = this.heldOf(e)
    return this.ctx.rigMuzzle != null && held !== null && this.ctx.rigMuzzle(weaponModelKey(held), SCRATCH_MUZZLE)
  }

  /**
   * pathOf: the shooter's muzzle and the flight's end, computed once per shot: from the held
   * weapon's barrel when the model is there (the Spartan's hand, or a 1st-person hold when
   * `view`: the camera is the shooter), otherwise from the fallback origin. A flight from the
   * barrel is only kept once the models are loaded.
   */
  private pathOf(e: ShotFxEntry, view: boolean): ShotPath | null {
    const cache = view ? this.fromView : this.fromMuzzle
    const known = cache.get(e)
    if (known) return known
    if (known === undefined) {
      const held = this.heldOf(e)
      // The recoil of the burst's previous shots, at the shot's fractional frame: the bullet leaves from the drawn barrel.
      const recoil = held ? this.recoil.at(e.slot, e.time, held, this.kick) : null
      const path = view
        ? viewPath(this.ctx, e, held, recoil)
        : muzzlePath(this.ctx, e, held, this.probe, { mix: this.poseOf(e), recoil })
      if (path !== undefined) cache.set(e, path)
      if (path) return path
    }
    const fallback = this.paths.get(e)
    if (fallback !== undefined) return fallback
    const path = shotPath(this.ctx, e)
    this.paths.set(e, path)
    return path
  }

  /** heldOf: the shooter's held weapon (id) at the shot's frame, read once per shot. */
  private heldOf(e: ShotFxEntry): string | null {
    let held = this.held.get(e)
    if (held === undefined) {
      held = heldWeaponAt(this.ctx.doc, e.slot, e.frame, this.ctx.inputs().locale)?.id ?? null
      this.held.set(e, held)
    }
    return held
  }

  /** xuidOf: the player of biped slot `slot`, null for a biped with no player. */
  private xuidOf(slot: number): string | null {
    if (!this.slotXuid) this.slotXuid = new Map(this.ctx.doc.tracks.map((t) => [t.slot, t.xuid ?? null]))
    return this.slotXuid.get(slot) ?? null
  }

  /** poseOf: the shooter's clips at the shot's frame (`motion3d`), null for a biped with no player. */
  private poseOf(e: ShotFxEntry): ClipMix | null {
    const xuid = this.xuidOf(e.slot)
    return xuid ? this.motion.at(xuid, e.frame, false, this.mix) : null
  }
}

/** shotPath: the fallback flight, from `MUZZLE_HEIGHT` above the shooter's feet (no model, vehicle). */
function shotPath(ctx: ActionContext, e: ShotFxEntry): ShotPath | null {
  const s = ctx.slotState(e.slot, e.frame)
  // The shooter's height; failing that (a vehicle shot, an onboard biped), the ground under the shot.
  const feet = s ? s.z - ctx.originAboveFloor : ctx.ground.floorY(e.x, e.y, null)
  if (feet === null) return null
  const [x, , z] = toThree(e.x, e.y, 0)
  const from = new THREE.Vector3(x, feet + MUZZLE_HEIGHT, z)
  const heading = e.h ?? null
  if (heading === null) return { from, to: null, hit: false, length: 0 }
  const dir = new THREE.Vector3(...aimDirThree(heading, s?.p ?? 0))
  return flight(ctx, from.addScaledVector(dir, MUZZLE_FORWARD), dir)
}

/**
 * muzzlePath: the flight from the muzzle of the weapon model the shooter's Spartan holds at
 * the shot's frame (`MuzzleProbe`). null: this shot has none (a vehicle shot, no heading, no
 * weapon in hand, a biped with no position); undefined: the Spartan or the model is not
 * loaded yet.
 */
function muzzlePath(
  ctx: ActionContext,
  e: ShotFxEntry,
  held: string | null,
  probe: MuzzleProbe,
  shooter: { mix: ClipMix | null; recoil: Recoil | null },
): ShotPath | null | undefined {
  const s = ctx.slotState(e.slot, e.frame)
  if (e.vehicleShot || e.h === null || !s || !held) return null
  const spartan = ctx.spartanModel()
  const weapon = ctx.weaponModel(held)
  if (!spartan || !weapon) return undefined
  const [x, , z] = toThree(s.x, s.y, 0)
  const feet = new THREE.Vector3(x, s.z - ctx.originAboveFloor, z)
  const from = probe.at(spartan, weapon, feet, { h: e.h, p: s.p, ...shooter }, new THREE.Vector3())
  return from ? flight(ctx, from, new THREE.Vector3(...aimDirThree(e.h, s.p))) : null
}

/**
 * viewPath: the flight from the muzzle of the weapon held in 1st person, the shooter's eye at
 * the shot's frame. When the arms + weapon rig is loaded for the held weapon
 * (`ctx.rigMuzzle`), the muzzle is the rig's own (camera frame, placed as `placer` places it)
 * rotated into the shot's aim: the animated weapon draws its own recoil, so the muzzle is no
 * longer offset for it. With no rig loaded, the muzzle is the static model's (`viewMuzzle`),
 * moved by recoil `recoil` as the view draws it. null: this shot has none; undefined: the
 * model (or the rig) is not loaded yet.
 */
function viewPath(ctx: ActionContext, e: ShotFxEntry, held: string | null, recoil: Recoil | null): ShotPath | null | undefined {
  const s = ctx.slotState(e.slot, e.frame)
  if (e.vehicleShot || e.h === null || !s || !held) return null
  const key = weaponModelKey(held)
  const [x, , z] = toThree(s.x, s.y, 0)
  const eye = new THREE.Vector3(x, s.z - ctx.originAboveFloor + EYE_HEIGHT - s.dropOeil, z)
  const dir = new THREE.Vector3(...aimDirThree(e.h, s.p))
  if (ctx.rigMuzzle) {
    // The rig answers for the held weapon: its muzzle (scratch buffer), in the shot's aim.
    // Recoil ignored: the rig's firing animation moves the weapon itself, the spray leaves
    // from the muzzle at rest.
    if (ctx.rigMuzzle(key, SCRATCH_MUZZLE)) return flight(ctx, aimedView(eye, dir, SCRATCH_MUZZLE, SCRATCH_VIEW).clone(), dir)
    // The rig is not loaded for this weapon (or it has no rig): the static model is drawn.
  }
  const weapon = ctx.weaponModel(held)
  if (!weapon) return undefined
  const local = recoil ? recoilPoint(muzzleOfModel(weapon), recoil, new THREE.Vector3()) : muzzleOfModel(weapon)
  const from = viewMuzzle(eye, dir, viewGripOf(key), local, new THREE.Vector3())
  return flight(ctx, from, dir)
}

/**
 * aimedView: a point in CAMERA frame (x right, y up, -z forward) rotated into the shot's aim
 * (forward = `dir`, up = world +Y) and placed from eye `eye`. `out` is filled.
 */
function aimedView(eye: THREE.Vector3, dir: THREE.Vector3, point: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  // The frame of a camera at `eye` looking along `dir`: its -Z forward, its +X right.
  VIEW_M.lookAt(eye, SCRATCH_TARGET.copy(eye).add(dir), VIEW_UP)
  VIEW_Q.setFromRotationMatrix(VIEW_M)
  return out.copy(point).applyQuaternion(VIEW_Q).add(eye)
}

/** flight: a bullet's flight starting from `from` along `dir`, to the first wall or to range. */
function flight(ctx: ActionContext, from: THREE.Vector3, dir: THREE.Vector3): ShotPath {
  const hit = ctx.ground.hit(from, dir, TRACER_RANGE)
  const to = hit ? hit.clone() : from.clone().addScaledVector(dir, TRACER_RANGE)
  return { from, to, hit: hit !== null, length: from.distanceTo(to) }
}
