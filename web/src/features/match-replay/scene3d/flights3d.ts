/**
 * flights3d.ts — LES VOLS ET LES EXPLOSIONS DANS LA SCÈNE 3D : grenades, projectiles de tir
 * (roquettes, mortier...), et ce qui se passe au bout de leur vol.
 *
 * Les vols sont ceux du document (`projectiles`), sur la même fenêtre que la 2D (le vol, puis une
 * courte traîne). Le chemin parcouru (traîne) est un repère d'analyse (`aids3d.projectilePaths`),
 * éteint par défaut : le jeu ne montre que l'objet qui vole. Les explosions sont celles de la 2D
 * (`buildRestFx` : grenades par type, projectiles de tir dont l'arme détone), à la même image
 * (explosion, nappe Dynamo, halo).
 *
 * LA HAUTEUR D'UN VOL N'EST PAS PUBLIÉE : le film donne (x, y) point par point. Elle est INTERPOLÉE
 * le long du chemin parcouru, de la main du lanceur (son emplacement au départ du vol) jusqu'au sol
 * sous le point d'explosion, cherché sous la hauteur de départ. Un vol en cloche se lit donc en
 * ligne droite inclinée : la courbe que l'on dessinerait serait inventée.
 *
 * Une détonation se joue comme dans le jeu, en moins d'une seconde (`explosionFx3d`, posée par
 * `explosions3d`) : éclair, boule de feu en bouffées, étincelles, voile de fumée, et une lumière brève
 * qui éclaire la pièce (`flash3d`), fonctions du temps écoulé depuis la détonation publiée. La sphère
 * du rayon de dégâts est un repère d'analyse (`aids3d.blastRadius`), éteint par défaut.
 *
 * Une grenade dont le modèle du jeu est chargé (`ActionContext.grenadeModel`) le montre à la place
 * de la tête lumineuse, en tournoyant ; posée avant de détoner (vol fini avant l'explosion publiée),
 * elle reste au bout de son vol jusqu'à l'explosion. La grenade plasma n'a pas de modèle : elle
 * montre son ORBE LUMINEUSE (cœur bleu-blanc, halo bleu saturé, pulsé par le temps ;
 * `grenadeLook3d`), en vol comme posée.
 */
import * as THREE from 'three'

import { msToFrames } from '@/lib/replay/replayLogic'

import { fxTintOf, type FxTint } from '../layers/fxInk'
import { DYNAMO_REST_HOLD_MS, GRENADE_REST_HOLD_MS, restKindOf, type GrenadeRestFx } from '../model/grenadeFx'
import { buildRestFx } from '../model/shotImpactFx'
import { vehicleShotStyleOf } from '../model/vehicleWeaponRegistry'
import { InstancePool, SegmentPool, firstFrom } from './actionKit'
import { grenadeLookOf, plasmaPulse, PLASMA_CORE_MIX, PLASMA_CORE_RADIUS, PLASMA_HALO_DIM, PLASMA_HALO_MULT, PLASMA_PULSE_DEPTH, SHOT_ORB_RADIUS, type GrenadeFlightLook } from './grenadeLook3d'
import { blastLight, blastStyleOf } from './explosionFx3d'
import { Explosions3d } from './explosions3d'
import { WeaponModelPool } from './weaponModels3d'
import type { ActionContext, ActionLayer3d } from './actionScene3d'
import { MUZZLE_HEIGHT } from './body3d'
import { toThree } from './tracks3d'

// Le vol reste visible brièvement après son dernier point (la traîne de la 2D).
const TAIL_FRAMES = 7
const TRAIL_RADIUS = 0.01
const HEAD_RADIUS = 0.05
// Au sol, l'objet repose sur sa face, pas sur son centre.
const REST_LIFT = 0.08
/** Le rayon de dégâts d'une explosion (u, ~3,4 m), celui de la 2D : le repère d'analyse le montre. */
export const BLAST_RADIUS = 1.1
/** La sphère du rayon de dégâts tient une seconde, et s'efface. */
const BLAST_RADIUS_SECONDS = 1
const NAPPE_RADIUS = 0.9
const HALO_RADIUS = 0.3
// La lumière d'une détonation éclaire la pièce sur ~18 m.
const DETONATION_LIGHT_RANGE = 6
// La couleur de cette lumière : la teinte de la déflagration mêlée de blanc incandescent.
const DETONATION_CORE_MIX = 0.35

// La grenade tournoie en vol (rad/s), autour d'un axe incliné.
const GRENADE_SPIN = 4 * Math.PI
const SPIN_AXIS = new THREE.Vector3(1, 0, 0.4).normalize()

interface Flight {
  t0: number
  /** Image absolue de chaque point. */
  at: number[]
  pts: THREE.Vector3[]
  end: number
  /** Image de l'explosion publiée (`Projectile.detoT`). */
  detoT: number
  /** Le rang de la grenade lancée, null pour un projectile de tir. */
  grenade: number | null
  /** La forme du vol (`grenadeLook3d`) : le modèle du jeu, ou l'orbe plasma. */
  look: GrenadeFlightLook
  /** Le rayon du cœur de l'orbe (u), quand le vol en est une. */
  orbRadius: number
  tint: FxTint
}

interface Blast {
  rest: GrenadeRestFx
  at: THREE.Vector3
  hold: number
  kind: 'explosion' | 'nappe' | 'halo'
  tint: FxTint
}

export class Flights3dLayer implements ActionLayer3d {
  private readonly trails: SegmentPool
  private readonly heads: InstancePool
  /** Les cœurs des orbes plasma (additifs). */
  private readonly plasmaCore: InstancePool
  /** Les halos des orbes plasma (additifs, plus larges, plus assourdis). */
  private readonly plasmaHalo: InstancePool
  private readonly blasts: InstancePool
  private readonly nappes: InstancePool
  /** Les sphères du rayon de dégâts (repère d'analyse). */
  private readonly radii: InstancePool
  private readonly explosions: Explosions3d
  private readonly pools: readonly { begin(): void; end(): void; dispose(): void }[]
  private readonly flashInk = new THREE.Color()
  private readonly models: WeaponModelPool
  private readonly flights: Flight[]
  private readonly blastList: Blast[]
  private readonly maxHold: number
  private readonly maxSpan: number
  private readonly p = new THREE.Vector3()
  private readonly q = new THREE.Quaternion()
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
    // Les vols : ceux partis depuis la plus longue durée de vol possible, triés par départ.
    for (let i = firstFrom(this.flights, (f) => f.t0, frame - this.maxSpan); i < this.flights.length; i++) {
      const f = this.flights[i]
      if (f.t0 > frame) break
      if (frame > lastFrame(f)) continue
      this.drawFlight(f, frame, f.grenade !== null ? grenadeInk : ink(f.tint), { fps, paths: inputs.aids.projectilePaths })
    }
    const core = this.ctx.ink.of(inputs.inks.fx.core)
    for (let i = firstFrom(this.blastList, (b) => b.rest.frame, frame - this.maxHold); i < this.blastList.length; i++) {
      const b = this.blastList[i]
      if (b.rest.frame > frame) break
      const age = (frame - b.rest.frame) / fps
      if (b.kind === 'explosion') {
        this.drawDetonation(b, age, ink(b.tint), core)
        if (inputs.aids.blastRadius && age < BLAST_RADIUS_SECONDS) {
          this.radii.add(b.at, null, BLAST_RADIUS, this.flashInk.copy(ink(b.tint)).multiplyScalar(0.2 * (1 - age / BLAST_RADIUS_SECONDS)))
        }
        continue
      }
      const u = (frame - b.rest.frame) / b.hold
      if (u <= 1) this.drawBlast(b, u, ink(b.tint))
    }
    for (const pool of this.pools) pool.end()
  }

  dispose(): void {
    for (const pool of this.pools) pool.dispose()
    this.models.dispose()
  }

  /** drawDetonation : l'explosion (`explosions3d`) et sa lumière, `age` secondes après elle. */
  private drawDetonation(b: Blast, age: number, tint: THREE.Color, core: THREE.Color): void {
    const style = blastStyleOf(b.tint)
    this.explosions.add(b.at, style, age, b.rest.seed, { core, tint })
    const light = blastLight(style, age)
    if (light > 0) this.ctx.flashes.add(b.at, this.flashInk.copy(tint).lerp(core, DETONATION_CORE_MIX), light, DETONATION_LIGHT_RANGE)
  }

  /** drawFlight : le projectile en vol ; son chemin parcouru seulement si le tiroir le demande (`paths`). */
  private drawFlight(f: Flight, frame: number, color: THREE.Color, { fps, paths }: { fps: number; paths: boolean }): void {
    const model = f.look === 'model' && f.grenade !== null ? this.ctx.grenadeModel(f.grenade) : null
    let i = 1
    for (; i < f.pts.length && f.at[i] <= frame; i++) {
      if (paths && frame <= f.end + TAIL_FRAMES) this.trails.add(f.pts[i - 1], f.pts[i], TRAIL_RADIUS, color)
    }
    if (frame > f.end) {
      // Posée avant de détoner : la grenade attend l'explosion au bout de son vol.
      if (f.look === 'orb' && f.grenade !== null) this.drawPlasmaOrb(f, f.pts[f.pts.length - 1], frame, fps)
      else if (model && frame <= f.detoT) this.models.add(model, f.pts[f.pts.length - 1], this.spin(f.end - f.t0, fps))
      return
    }
    // La tête : interpolée entre le dernier point passé et le suivant.
    const a = f.pts[i - 1]
    const b = f.pts[Math.min(i, f.pts.length - 1)]
    const span = (f.at[Math.min(i, f.at.length - 1)] - f.at[i - 1]) || 1
    const head = this.p.lerpVectors(a, b, Math.min(1, Math.max(0, (frame - f.at[i - 1]) / span)))
    if (paths) this.trails.add(a, head, TRAIL_RADIUS, color)
    if (f.look === 'orb') this.drawPlasmaOrb(f, head, frame, fps)
    else if (model) this.models.add(model, head, this.spin(frame - f.t0, fps))
    else this.heads.add(head, null, HEAD_RADIUS, color)
  }

  /**
   * drawPlasmaOrb : la grenade plasma, en vol ou posée — un cœur bleu-blanc et un halo bleu
   * saturé, additifs, pulsés par le temps (`grenadeLook3d.plasmaPulse`). A shot projectile drawn
   * as an orb (`SHOT_ORB_RADIUS`, the fuel rod) takes its own tint and radius, in flight only.
   */
  private drawPlasmaOrb(f: Flight, at: THREE.Vector3, frame: number, fps: number): void {
    const fx = this.ctx.inputs().inks.fx
    const gain = 1 - PLASMA_PULSE_DEPTH / 2 + PLASMA_PULSE_DEPTH * plasmaPulse(frame / fps)
    this.orbTint.copy(this.ctx.ink.of(fx.tint[f.tint] || fx.tint.plasma_cool))
    this.orbCore.copy(this.orbTint).lerp(this.ctx.ink.of(fx.core), PLASMA_CORE_MIX)
    this.orbHalo.copy(this.orbTint).multiplyScalar(PLASMA_HALO_DIM * gain)
    this.plasmaCore.add(at, null, f.orbRadius * gain, this.orbCore)
    this.plasmaHalo.add(at, null, f.orbRadius * PLASMA_HALO_MULT, this.orbHalo)
  }

  /** spin : l'orientation de la grenade `frames` images après son départ. */
  private spin(frames: number, fps: number): THREE.Quaternion {
    return this.q.setFromAxisAngle(SPIN_AXIS, (frames / fps) * GRENADE_SPIN)
  }

  /** drawBlast : la nappe Dynamo ou le halo d'une fin de vol sans détonation, `u` dans [0, 1] sur sa durée. */
  private drawBlast(b: Blast, u: number, color: THREE.Color): void {
    if (b.kind === 'nappe') {
      this.nappes.add(b.at, null, new THREE.Vector3(NAPPE_RADIUS, 1, NAPPE_RADIUS), color)
      return
    }
    // Gonfle vite, puis retombe : le halo se lit comme un éclat, pas comme un objet.
    const r = HALO_RADIUS * (u < 0.15 ? u / 0.15 : 1 - ((u - 0.15) / 0.85) * 0.8)
    this.blasts.add(b.at, null, r, color)
  }
}

/** Le tireur ou le lanceur d'un vol, et la nature de ce qu'il a tiré. */
interface FlightOwner {
  slot: number
  /** Le rang de la grenade lancée, null pour un tir. */
  grenade: number | null
  tint: FxTint
  /** The weapon key of the shot (`WeaponLabel.key`), undefined for a grenade. */
  key?: string
}

/** lastFrame : la dernière image où un vol se dessine (sa traîne, ou sa grenade posée). */
function lastFrame(f: Flight): number {
  return Math.max(f.end + TAIL_FRAMES, f.grenade !== null ? f.detoT : 0)
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
  for (const g of doc.grenades) {
    if (g.proj !== undefined) owners.set(g.proj, { slot: g.slot, grenade: g.rank, tint: grenadeLookOf(g.rank).tint })
  }
  return owners
}

function buildFlights(ctx: ActionContext): Flight[] {
  const owners = ownersOf(ctx)
  const out: Flight[] = []
  ctx.doc.projectiles.forEach((pr, i) => {
    if (pr.p.length < 2) return
    const owner = owners.get(i)
    const [x0, y0] = [pr.p[0][1], pr.p[0][2]]
    const s = owner ? ctx.slotState(owner.slot, pr.t0) : null
    const start = s ? s.z - ctx.originAboveFloor + MUZZLE_HEIGHT : (ctx.ground.floorY(x0, y0, null) ?? 0) + MUZZLE_HEIGHT
    const last = pr.p[pr.p.length - 1]
    const end = (ctx.ground.floorY(pr.detoX, pr.detoY, start) ?? start - MUZZLE_HEIGHT) + REST_LIFT
    const orbRadius = owner?.key !== undefined ? SHOT_ORB_RADIUS[owner.key] : undefined
    out.push({
      t0: pr.t0,
      at: pr.p.map((st) => pr.t0 + st[0]),
      pts: heightsAlong(pr.p, start, end),
      end: pr.t0 + last[0],
      detoT: pr.detoT,
      grenade: owner?.grenade ?? null,
      look: owner && owner.grenade !== null ? grenadeLookOf(owner.grenade).flight : orbRadius !== undefined ? 'orb' : 'model',
      orbRadius: orbRadius ?? PLASMA_CORE_RADIUS,
      tint: owner?.tint ?? 'neutral',
    })
  })
  return out
}

/** heightsAlong : les points du vol en axes three, la hauteur répartie sur la distance parcourue. */
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
  // Le bout de chaque vol, par image d'explosion : l'explosion se pose à la hauteur où le vol finit.
  const endsByFrame = new Map<number, THREE.Vector3[]>()
  for (const f of flights) endsByFrame.set(f.detoT, [...(endsByFrame.get(f.detoT) ?? []), f.pts[f.pts.length - 1]])
  return buildRestFx(doc).map((rest) => {
    const kind = rest.tint ? 'explosion' : restKindOf(rest.rank)
    const [x, , z] = toThree(rest.x, rest.y, 0)
    const near = (endsByFrame.get(rest.frame) ?? []).find((e) => Math.hypot(e.x - x, e.z - z) < 1.5)
    const y = near?.y ?? (ctx.ground.floorY(rest.x, rest.y, null) ?? 0) + REST_LIFT
    return {
      rest,
      at: new THREE.Vector3(x, y, z),
      hold: kind === 'nappe' ? holdNappe : holdBlast,
      kind,
      tint: rest.tint ?? grenadeLookOf(rest.rank).tint,
    }
  })
}
