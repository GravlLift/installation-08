// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shots3d.ts — LES TIRS DANS LA SCÈNE 3D : éclair de bouche (gerbe de pétales au bout du canon
 * dessiné, `muzzleFlash3d` ; lumière brève, `flash3d`), balle en vol, étincelle d'impact.
 *
 * Les tirs sont ceux de la 2D (`buildShotFx`, tir continu compris), dans la même teinte de
 * décharge. La 3D leur donne un vol : la balle part du canon du modèle d'arme que le tireur tient à
 * l'image du tir (`muzzle3d` : main du Spartan, ou tenue de 1re personne quand la caméra est le
 * tireur), ou, sans ces modèles et pour un tir de véhicule, de `MUZZLE_HEIGHT` au-dessus de ses
 * pieds ; elle suit la direction de son
 * regard (cap du tir, tangage de sa visée), et file vers le premier mur touché sous la forme d'un
 * trait court à la vitesse d'une balle (`tracerSpan`) ; elle s'éteint à l'impact, qui jette une
 * étincelle brève. Les durées sont en temps réel, converties par la cadence du document : la
 * rémanence de 0,6 s de la 2D, appliquée à un trait tendu de la bouche au mur, en faisait un laser.
 *
 * Un tir de projectile d'énergie (familles de `BOLT_SPEED` : plasma, aiguilles) n'a pas de trait :
 * un point de feu file à sa vitesse, plus lente, jusqu'au mur.
 *
 * The spread shot (family `spread`, the Heatwave) is a fan of energy bolts, each a short glowing
 * streak that flies at its projectile speed, ricochets once off the scenery and sparks where it ends
 * (`spreadShots3d`). As a `light` tracer (the 0.4 mm wire of a bullet, at a bullet's speed) it was
 * not seen at all.
 *
 * Le tir de choc (famille `shock`) n'a ni balle ni trait : TROIS faisceaux électriques sains,
 * de la bouche au mur (`shockShots3d`), pleins à l'instant du tir, agités par bac de jitter et
 * fondus linéairement sur `SHOCK_BEAM_SECONDS`.
 *
 * L'éclair de bouche se pose au bout de l'arme que la scène DESSINE à l'image affichée
 * (`drawnWeapon`) : en 1re personne, l'arme dessinée est le rig bras + arme, qui n'a pas d'arme en
 * main du Spartan — la gerbe est alors à la bouche du rig dont le vol est parti (`viewPath`), le
 * long de la direction du tir. Sans arme dessinée, pas de gerbe, seulement la lumière, à
 * l'origine du vol.
 *
 * Un tir sans cap lisible n'a pas de balle, seulement l'éclair : la 2D en fait une bouffée ronde,
 * pour la même raison (pas de direction inventée). Le film ne dit pas ce qu'une balle a touché :
 * le point d'impact est celui du décor, jamais un joueur.
 *
 * La ligne de tir entière (de la bouche au mur, tenue la rémanence de la 2D) est un repère
 * d'analyse (`aids3d.shotLines`), éteint par défaut : le jeu ne la montre pas.
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
import { flashPetals, muzzleFlashSite, muzzleFlashStrength, rigFlashSite, type FlashPetal } from './muzzleFlash3d'
import { newRecoil, type Recoil } from './recoil3d'
import { recoilPoint } from './recoilPose3d'
import { boltEndAge, boltPath, boltTrail, spreadDirections, SPREAD_BOUNCE_RANGE, SPREAD_RANGE, SPREAD_SPEED, SPREAD_TRAIL, type BoltPath } from './spreadShots3d'
import { shockBeamPaths, shockJitterBucket, SHOCK_BEAM_SECONDS, SHOCK_BEAMS, SHOCK_HD, type ShockBeam } from './shockShots3d'
import { ShooterRecoil } from './recoilShots3d'
import { aimDirThree, toThree } from './tracks3d'
import { viewGripOf } from './viewGrip3d'
import { weaponModelKey } from './weaponModels3d'

// Vitesse apparente d'une balle : 300 u/s, ~900 m/s (une unité vaut ~3 m).
export const TRACER_SPEED = 300
// Longueur du trait d'une balle en vol : ~3,5 m, le filé d'une balle à l'écran.
export const TRACER_LENGTH = 1.2
// Portée d'une balle sans mur : ~240 m.
const TRACER_RANGE = 80
// ~2,5 mm d'épaisseur : un fil, qui ne masque pas la vue en 1re personne.
const TRACER_RADIUS = 0.0004
// La bouche de repli est un peu devant le corps, au bout de l'arme.
const MUZZLE_FORWARD = 0.3
// La gerbe de l'éclair : la teinte de l'arme mêlée de blanc ; et une lumière brève qui éclaire le
// tireur et le décor proche.
const PETAL_CORE_MIX = 0.3
// La gerbe de l'arme de la caméra se dessine après le reste de la scène.
const VIEW_FLASH_ORDER = 10
export const MUZZLE_LIGHT = 2.5
const MUZZLE_LIGHT_RANGE = 2.5
export const IMPACT_SECONDS = 0.12
const IMPACT_RADIUS = 0.012
// Le blanc de la balle, mêlé à la teinte de l'arme : un trait chaud, pas un néon de la couleur pure.
const CORE_MIX = 0.5
// Energy discharges (plasma, electric, Forerunner...) keep their own color: the game shows a
// saturated bolt, so only a touch of the white core goes in.
const ENERGY_CORE_MIX = 0.1
const CAPACITY = 512
// Bacs à sable du tir de 1re personne : le repère caméra est tourné dans la visée, aucun tir n'alloue.
const VUE_HAUT = new THREE.Vector3(0, 1, 0)
const VUE_Q = new THREE.Quaternion()
const VUE_M = new THREE.Matrix4()
const BAC_CIBLE = new THREE.Vector3()
const BAC_VUE = new THREE.Vector3()
const BAC_BOCHE = new THREE.Vector3()
/**
 * Les familles dont le tir est un projectile lent et lumineux, pas une balle : un point de feu qui
 * file à sa vitesse (u/s) jusqu'au mur, sans trait. Vitesses choisies à l'œil, de l'ordre du jeu.
 */
export const BOLT_SPEED: Partial<Record<ShotFamily, number>> = { plasma: 45, needles: 25 }
// ~8 cm : le point de feu d'un projectile d'énergie.
const BOLT_RADIUS = 0.025
// Le faisceau du tir de choc : l'arc électrique entier, de la bouche au mur.
export const BEAM_RADIUS = 0.012
// La lueur du faisceau : un second segment sur le même chemin, à ce multiple du rayon du cœur
// et à cette fraction de son intensité, au même fondu.
export const BEAM_GLOW_MULT = 4
export const BEAM_GLOW_DIM = 0.25
// La vie du faisceau : plein à l'instant du tir, fondu linéairement jusqu'à zéro.
export const BEAM_SECONDS = 0.25
// La ligne de tir (repère d'analyse) : un fil un peu plus épais que la balle, assourdi.
const LINE_RADIUS = 0.004
const LINE_DIM = 0.6
// The spread's bolt: a streak this thick (~9 cm, an ESTIMATE of the game's glowing bar), and its
// glow around it at the beam's multiple and dim.
export const SPREAD_BOLT_RADIUS = 0.03
// La vie la plus longue d'un tir : vol du projectile le plus lent jusqu'à la portée, puis l'étincelle.
const SLOWEST = Math.min(TRACER_SPEED, ...Object.values(BOLT_SPEED))
const LIFE_SECONDS = Math.max((TRACER_RANGE + TRACER_LENGTH) / SLOWEST, (SPREAD_RANGE + SPREAD_BOUNCE_RANGE + SPREAD_TRAIL) / SPREAD_SPEED) + IMPACT_SECONDS

interface ShotPath {
  from: THREE.Vector3
  /** Le bout du vol ; null sans cap lisible. */
  to: THREE.Vector3 | null
  /** Le vol s'arrête sur le décor (et non à la portée maximale). */
  hit: boolean
  /** Longueur du vol, en unités. */
  length: number
}

/**
 * tracerSpan : la portion du vol (distances depuis la bouche) que couvre le trait de la balle
 * `age` secondes après le tir, null quand la balle a fini sa course. La tête avance à
 * `TRACER_SPEED` et s'arrête au bout du vol ; la queue la suit à `TRACER_LENGTH` et rentre dans
 * le point d'impact.
 */
export function tracerSpan(length: number, age: number, speed = TRACER_SPEED, trail = TRACER_LENGTH): { tail: number; head: number } | null {
  if (age < 0) return null
  const head = Math.min(length, age * speed)
  const tail = Math.max(0, age * speed - trail)
  return tail < length ? { tail, head } : null
}

/** impactAge : l'âge (s) de l'étincelle d'un vol de `length` unités, null avant l'arrivée du projectile. */
export function impactAge(length: number, age: number, speed = TRACER_SPEED): number | null {
  const since = age - length / speed
  return since >= 0 && since < IMPACT_SECONDS ? since : null
}

/** shotLineShown : la ligne de tir (repère d'analyse) tient la rémanence de la 2D, `holdSeconds`. */
export function shotLineShown(age: number, holdSeconds: number): boolean {
  return age >= 0 && age <= holdSeconds
}

/**
 * Ce que dessine le VOL d'un tir selon sa famille : un faisceau instantané (tir de choc), un
 * point de feu lent (projectile d'énergie, familles de `BOLT_SPEED`), ou un trait court qui file
 * à la vitesse de la balle.
 */
export type ShotFlightForm = 'beam' | 'bolt' | 'tracer' | 'spread'

/** formeVol : la forme du vol d'une famille de tir. */
export function formeVol(fam: ShotFamily): ShotFlightForm {
  if (fam === 'shock') return 'beam'
  if (fam === 'spread') return 'spread'
  return BOLT_SPEED[fam] !== undefined ? 'bolt' : 'tracer'
}

/**
 * beamFade : la force (0..1) du faisceau du tir de choc `age` secondes après le tir : plein à
 * l'instant, fondu linéairement jusqu'à zéro à `seconds`, éteint au-delà.
 */
export function beamFade(age: number, seconds: number = BEAM_SECONDS): number {
  if (age < 0) return 0
  return Math.min(1, Math.max(0, 1 - age / seconds))
}

/**
 * lunetteSansGerbe : la gerbe d'un tir de la vue 1re personne se retire quand la lunette est
 * montée sur cette vue : les bras quittent l'écran, il n'y a plus de bouche dessinée où la poser
 * (elle filerait au centre de l'écran). La lunette du joueur suivi ne touche pas un tir vu de
 * 3e personne, dont le Spartan garde son arme dessinée.
 */
export function lunetteSansGerbe(vue: boolean, lunetteMontee: boolean): boolean {
  return vue && lunetteMontee
}

/**
 * Ce qu'un tir dit de son dessin : le tir, sa famille, la rémanence de sa ligne (s, négative :
 * éteinte), et si la caméra est le tireur (1re personne).
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
  /** La gerbe de l'arme de la caméra : par-dessus l'arme, dont le corps cache la bouche à l'œil. */
  private readonly viewPetals: InstancePool
  private readonly pools: readonly { begin(): void; end(): void; dispose(): void }[]
  private readonly lineInk = new THREE.Color()
  private source: readonly ShotFxEntry[] | null = null
  private sorted: ShotFxEntry[] = []
  private readonly paths = new Map<ShotFxEntry, ShotPath | null>()
  /** The spread's bolts of each flight, traced once. */
  private readonly spreads = new WeakMap<ShotPath, BoltPath[]>()
  /** Les trois faisceaux du tir de choc, remplis à chaque image (bacs réutilisables). */
  private readonly shockBeams: ShockBeam[] = Array.from({ length: SHOCK_BEAMS }, () => ({ points: [] }))
  private readonly fromMuzzle = new Map<ShotFxEntry, ShotPath | null>()
  private readonly fromView = new Map<ShotFxEntry, ShotPath | null>()
  /** L'arme en main de chaque tir (identifiant), lue une fois. */
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
    // En 1re personne le canon file droit devant l'œil : le corps de l'arme masque sa bouche. La
    // gerbe passe devant (comme le jeu dessine l'arme et ses effets à part) ; rien d'autre ne tient
    // entre l'œil et une bouche à ~25 cm.
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
      const window = Math.max(LIFE_SECONDS, hold) * fps
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

  private reindex(shotFx: readonly ShotFxEntry[]): void {
    this.source = shotFx
    this.sorted = [...shotFx].sort((p, q) => p.time - q.time)
    this.paths.clear()
    this.fromMuzzle.clear()
    this.fromView.clear()
    this.held.clear()
  }

  /**
   * draw : l'éclair à la bouche, la balle (trait court) ou le projectile d'énergie (point de feu) sur
   * son vol, l'étincelle qui s'éteint au point d'impact ; la ligne de tir entière si le tiroir la
   * demande (`hold` en secondes, négatif : éteinte).
   */
  private draw(path: ShotPath, age: number, tint: THREE.Color, core: THREE.Color, shot: ShotLook): void {
    const k = muzzleFlashStrength(age)
    if (k > 0) this.flash(path, k, tint, core, shot)
    if (!path.to) return
    if (shotLineShown(age, shot.hold)) this.lines.add(path.from, path.to, LINE_RADIUS, this.lineInk.copy(tint).multiplyScalar(LINE_DIM))
    if (formeVol(shot.fam) === 'spread') {
      this.drawSpread(path, path.to, age, tint)
      return
    }
    if (formeVol(shot.fam) === 'beam') {
      // Le tir de choc : trois faisceaux, de la bouche au mur ; son impact est à distance nulle,
      // l'étincelle naît au tir.
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
   * flash : l'éclair de bouche à la force `k` (`muzzleFlashStrength`) : la gerbe au bout de l'arme que
   * la scène dessine pour le tireur, le long de son canon, et la lumière. En 1re personne le rig n'a
   * pas d'arme dessinée : la gerbe se pose à la bouche du rig VIVANT, lue à l'image (`ctx.rigMuzzleWorld`),
   * le long de son canon dessiné ; sans elle, `rigFlashSite` la pose à la bouche du vol. Sans arme
   * dessinée, la lumière seule, à l'origine du vol : aucune forme n'est posée hors d'un canon dessiné.
   */
  private flash(path: ShotPath, k: number, tint: THREE.Color, core: THREE.Color, shot: ShotLook): void {
    const e = shot.e
    const xuid = e.vehicleShot ? null : this.xuidOf(e.slot)
    const drawn = xuid ? this.ctx.drawnWeapon(xuid) : null
    const site =
      (shot.view && e.vehicleShot === null && this.rigLoaded(e) && this.ctx.rigMuzzleWorld?.(this.muzzle, this.barrel) === true) ||
      muzzleFlashSite(e.vehicleShot !== null, drawn, this.muzzle, this.barrel) ||
      rigFlashSite(shot.view && e.vehicleShot === null && this.rigLoaded(e), path, this.muzzle, this.barrel)
    this.ctx.flashes.add(site ? this.muzzle : path.from, tint, MUZZLE_LIGHT * k, MUZZLE_LIGHT_RANGE)
    // Lunette montée : les bras sont retirés de l'écran, la gerbe n'a plus de bouche dessinée où se
    // poser (sans elle elle filerait au centre de l'écran) ; la lumière et le tir lui-même restent.
    if (!site || lunetteSansGerbe(shot.view, this.ctx.scopeMounted?.() === true)) return
    const color = this.petalInk.copy(tint).lerp(core, PETAL_CORE_MIX).multiplyScalar(k)
    const pool = shot.view ? this.viewPetals : this.petals
    for (const p of flashPetals(this.barrel, k, e.seed, this.burst)) pool.add(this.muzzle, p.rotation, p.size, color)
  }

  /** rigLoaded : le rig de 1re personne de l'arme tenue du tir est chargé (`ctx.rigMuzzle`). */
  private rigLoaded(e: ShotFxEntry): boolean {
    const held = this.heldOf(e)
    return this.ctx.rigMuzzle != null && held !== null && this.ctx.rigMuzzle(weaponModelKey(held), BAC_BOCHE)
  }

  /**
   * pathOf : la bouche du tireur et le bout du vol, calculés une fois par tir : du canon de l'arme
   * tenue quand le modèle est là (main du Spartan, ou tenue de 1re personne quand `view` : la caméra
   * est le tireur), sinon de l'origine de repli. Un vol depuis le canon n'est retenu qu'une fois les
   * modèles chargés.
   */
  private pathOf(e: ShotFxEntry, view: boolean): ShotPath | null {
    const cache = view ? this.fromView : this.fromMuzzle
    const known = cache.get(e)
    if (known) return known
    if (known === undefined) {
      const held = this.heldOf(e)
      // Le recul des tirs précédents de la rafale, à l'image fractionnaire du tir : la balle part du canon dessiné.
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

  /** heldOf : l'arme en main (identifiant) du tireur à l'image du tir, lue une fois par tir. */
  private heldOf(e: ShotFxEntry): string | null {
    let held = this.held.get(e)
    if (held === undefined) {
      held = heldWeaponAt(this.ctx.doc, e.slot, e.frame, this.ctx.inputs().locale)?.id ?? null
      this.held.set(e, held)
    }
    return held
  }

  /** xuidOf : le joueur de l'emplacement de bipède `slot`, null pour un bipède sans joueur. */
  private xuidOf(slot: number): string | null {
    if (!this.slotXuid) this.slotXuid = new Map(this.ctx.doc.tracks.map((t) => [t.slot, t.xuid ?? null]))
    return this.slotXuid.get(slot) ?? null
  }

  /** poseOf : les clips du tireur à l'image du tir (`motion3d`), null pour un bipède sans joueur. */
  private poseOf(e: ShotFxEntry): ClipMix | null {
    const xuid = this.xuidOf(e.slot)
    return xuid ? this.motion.at(xuid, e.frame, false, this.mix) : null
  }
}

/** shotPath : le vol de repli, de `MUZZLE_HEIGHT` au-dessus des pieds du tireur (sans modèle, véhicule). */
function shotPath(ctx: ActionContext, e: ShotFxEntry): ShotPath | null {
  const s = ctx.slotState(e.slot, e.frame)
  // La hauteur du tireur ; à défaut (tir d'un véhicule, bipède embarqué), le sol sous le tir.
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
 * muzzlePath : le vol depuis la bouche du modèle d'arme que le Spartan du tireur tient à l'image du
 * tir (`MuzzleProbe`). null : ce tir n'en a pas (tir d'un véhicule, sans cap, sans arme en main,
 * bipède sans position) ; undefined : le Spartan ou le modèle n'est pas encore chargé.
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
 * viewPath : le vol depuis la bouche de l'arme tenue en 1re personne, l'œil du tireur à l'image du
 * tir. Quand le rig bras + arme est chargé pour l'arme tenue (`ctx.rigMuzzle`), la bouche est celle
 * du rig (repère caméra, posée comme `placer` le pose) tournée dans la visée du tir : l'arme animée
 * dessine elle-même son recul, on n'en décale plus la bouche. Sans rig chargé, la bouche est celle du
 * modèle statique (`viewMuzzle`), déplacée par le recul `recoil` comme la vue le dessine. null : ce
 * tir n'en a pas ; undefined : le modèle (ou le rig) n'est pas encore chargé.
 */
function viewPath(ctx: ActionContext, e: ShotFxEntry, held: string | null, recoil: Recoil | null): ShotPath | null | undefined {
  const s = ctx.slotState(e.slot, e.frame)
  if (e.vehicleShot || e.h === null || !s || !held) return null
  const key = weaponModelKey(held)
  const [x, , z] = toThree(s.x, s.y, 0)
  const eye = new THREE.Vector3(x, s.z - ctx.originAboveFloor + EYE_HEIGHT - s.dropOeil, z)
  const dir = new THREE.Vector3(...aimDirThree(e.h, s.p))
  if (ctx.rigMuzzle) {
    // Le rig répond pour l'arme tenue : sa bouche (bac à sable), dans la visée du tir. Recul ignoré :
    // l'anim de tir du rig déplace lui-même l'arme, la gerbe part de la bouche au repos.
    if (ctx.rigMuzzle(key, BAC_BOCHE)) return flight(ctx, vueTiree(eye, dir, BAC_BOCHE, BAC_VUE).clone(), dir)
    // Le rig n'est pas chargé pour cette arme (ou il n'a pas de rig) : le modèle statique dessiné.
  }
  const weapon = ctx.weaponModel(held)
  if (!weapon) return undefined
  const local = recoil ? recoilPoint(muzzleOfModel(weapon), recoil, new THREE.Vector3()) : muzzleOfModel(weapon)
  const from = viewMuzzle(eye, dir, viewGripOf(key), local, new THREE.Vector3())
  return flight(ctx, from, dir)
}

/**
 * vueTiree : un point en repère CAMÉRA (x à droite, y en haut, -z vers l'avant) tourné dans la
 * visée du tir (avant = `dir`, haut = le monde +Y) et posé depuis l'œil `eye`. `out` est rempli.
 */
function vueTiree(eye: THREE.Vector3, dir: THREE.Vector3, point: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  // Le repère d'une caméra en `eye` qui regarde le long de `dir` : son -Z vers l'avant, son +X à droite.
  VUE_M.lookAt(eye, BAC_CIBLE.copy(eye).add(dir), VUE_HAUT)
  VUE_Q.setFromRotationMatrix(VUE_M)
  return out.copy(point).applyQuaternion(VUE_Q).add(eye)
}

/** flight : le vol d'une balle partie de `from` le long de `dir`, jusqu'au premier mur ou à la portée. */
function flight(ctx: ActionContext, from: THREE.Vector3, dir: THREE.Vector3): ShotPath {
  const hit = ctx.ground.hit(from, dir, TRACER_RANGE)
  const to = hit ? hit.clone() : from.clone().addScaledVector(dir, TRACER_RANGE)
  return { from, to, hit: hit !== null, length: from.distanceTo(to) }
}
