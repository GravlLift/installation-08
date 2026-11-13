/**
 * objectives3d.ts — LES OBJECTIFS DU MODE DANS LA SCÈNE 3D : zones, marqueurs, drapeaux, crâne,
 * bombe, couronne VIP.
 *
 * Les règles sont celles de la 2D, lues par `objectives3dModel` ; ce calque ne fait que poser :
 *  - une ZONE est un contour plat (cercle de son rayon, ou rectangle de ses demi-cotés le long
 *    de `fwd`) et une paroi translucide basse au sol, teints par le propriétaire connu ;
 *  - un MARQUEUR (apparition, socle, livraison) est une hampe fine de `MARKER_HEIGHT` ;
 *  - un DRAPEAU est une hampe et un fanion : au-dessus de la tête de son porteur, ou au sol ; sa
 *    base vide garde un drapeau fantôme ; un portage sans fin datée a le fanion fantôme ;
 *  - le CRÂNE est une sphère, la BOMBE une boîte, la COURONNE un cône : au-dessus du porteur, ou
 *    au sol pour les deux premiers.
 *
 * Un objet porté suit les pieds 3D de son porteur (`playerFeet`, véhicule compris) ; quand la 3D
 * ne le situe pas mais que la 2D le fait (fenêtre après la mort), il se pose au-dessus du point 2D.
 * Le clignotement des objets portés de la 2D n'a pas d'équivalent : un lot n'a qu'une opacité.
 *
 * Unités monde Halo (cf. `tracks3d`).
 */
import * as THREE from 'three'

import type { FilmAllegiance } from '@/lib/replay/filmAllegiance'
import type { XY } from '@/lib/replay/replayLogic'

import type { ObjectiveElementReady } from '../layers/objectivesLayer'
import type { ReplayInks } from '../layers/useReplayInks'
import { vipActiveAt } from '../layers/vipCrownLayer'
import type { CarrierPosAt } from '../model/carriedGlyphPlace'
import { buildCarrierPosAt } from '../model/carrierPosition'
import { skullSocle } from '../model/skullPresence'
import type { Action3dInputs } from './action3dInputs'
import { InstancePool, LabelPool } from './actionKit'
import type { ActionContext, ActionLayer3d } from './actionScene3d'
import { HEAD_TOP } from './body3d'
import {
  bombExplosionsOf,
  bombPlaceAt,
  flagPlacesAt,
  objectivesShown,
  prepareFlag,
  prepareObjectives,
  sideInkOf,
  skullPlaceAt,
  zoneDisplayInkAt,
  type FeetZAt,
  type Objectives3dFamilies,
  type Objectives3dShown,
  type ObjectPlace,
  type PreparedFlag,
  type PreparedObjectives,
  type SkullSources,
  type ZoneInks,
} from './objectives3dModel'
import { toThree } from './tracks3d'
import { zoneOutlineGeometry, zoneWallGeometry } from './zoneOutline3d'

/** Hauteur de reference pour les etiquettes de zone (u). */
const ZONE_HEIGHT = 1.2
/** Rayon minimal d'un cylindre de zone (u) : une zone dégénérée reste visible. */
const ZONE_MIN_RADIUS = 0.2
/** La lettre de la zone, au-dessus du volume (u). */
const ZONE_LETTER_LIFT = 0.25
/** Hampe d'un marqueur (u). */
const MARKER_HEIGHT = 1
const MARKER_RADIUS = 0.03
/** Le drapeau : hampe et fanion triangulaire (u). */
const FLAG_POLE_HEIGHT = 0.5
const FLAG_POLE_RADIUS = 0.02
const FLAG_WING_WIDTH = 0.3
const FLAG_WING_HEIGHT = 0.2
/** Un objet porté flotte à cet écart au-dessus du sommet de la tête (u). */
const CARRIED_GAP = 0.08
/** Le crâne (~21 cm, la taille du modèle du jeu), la bombe (largeur, hauteur, profondeur), la couronne (u). */
const SKULL_RADIUS = 0.035
const BOMB_SIZE = { w: 0.3, h: 0.18, d: 0.22 }
const CROWN_RADIUS = 0.12
const CROWN_HEIGHT = 0.2
const CROWN_SIDES = 5
/** Opacité du drapeau fantôme (base vide, fanion d'un portage non daté). */
const GHOST_OPACITY = 0.35
/** Plafonds des lots. */
const ZONE_CAP = 64
const MARKER_CAP = 64
const CROWN_CAP = 8

const Y_AXIS = new THREE.Vector3(0, 1, 0)

/**
 * Ce que la page passe au calque en plus du contexte commun.
 *
 * - `allegiance` : `model.allegiance`, la même que celle des calques 2D (`useZoneStates`,
 *   `useReplayFlagCarries`, `useReplayVipCrown`) ; elle porte le point de vue.
 * - `families` : les interrupteurs par famille du tiroir (`showFlagCarries`, `showVipCrown`,
 *   `showSkullCarrier`, `showBombCarrier`), relus à chaque image. Absent, `show.objectives` les
 *   commande tous (cf. `objectivesShown`).
 */
export interface Objectives3dPage {
  allegiance: Pick<FilmAllegiance, 'ofTeam' | 'ofXuid'>
  families?: () => Objectives3dFamilies
}

/** Les deux lots d'une opacité de zone : contours circulaires et rectangulaires. */
class ZoneVolumes {
  private readonly cyl: InstancePool
  private readonly box: InstancePool
  private readonly wallCyl: InstancePool
  private readonly wallBox: InstancePool
  private readonly fade: THREE.DataTexture
  private readonly q = new THREE.Quaternion()
  private readonly p = new THREE.Vector3()
  private readonly s = new THREE.Vector3()

  constructor(parent: THREE.Object3D) {
    const cyl = zoneOutlineGeometry('cylinder')
    const box = zoneOutlineGeometry('box')
    this.cyl = new InstancePool(parent, cyl, volumeMaterial(0.9), ZONE_CAP)
    this.box = new InstancePool(parent, box, volumeMaterial(0.9), ZONE_CAP)
    this.fade = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255, 255, 0, 255, 255]), 1, 2)
    this.fade.magFilter = THREE.LinearFilter
    this.fade.minFilter = THREE.LinearFilter
    this.fade.needsUpdate = true
    const wallMaterial = () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, alphaMap: this.fade, depthWrite: false, side: THREE.DoubleSide })
    this.wallCyl = new InstancePool(parent, zoneWallGeometry('cylinder'), wallMaterial(), ZONE_CAP)
    this.wallBox = new InstancePool(parent, zoneWallGeometry('box'), wallMaterial(), ZONE_CAP)
  }

  begin(): void {
    this.cyl.begin()
    this.box.begin()
    this.wallCyl.begin()
    this.wallBox.begin()
  }

  add(e: ObjectiveElementReady, color: THREE.Color, floor: number): void {
    this.p.set(...toThree(e.x, e.y, floor + 0.02))
    if (e.family === 'cylinder') {
      const r = Math.max(e.radius, ZONE_MIN_RADIUS)
      this.cyl.add(this.p, null, this.s.set(r, 1, r), color)
      this.wallCyl.add(this.p, null, this.s.set(r, 0.45, r), color)
      return
    }
    // L'axe X local de la boîte suit `fwd` : (x, y) Halo devient (x, -y) dans le plan three.
    this.q.setFromAxisAngle(Y_AXIS, Math.atan2(e.fwd.y, e.fwd.x))
    this.box.add(this.p, this.q, this.s.set(2 * e.halfX, 1, 2 * e.halfY), color)
    this.wallBox.add(this.p, this.q, this.s.set(2 * e.halfX, 0.45, 2 * e.halfY), color)
  }

  end(): void {
    this.cyl.end()
    this.box.end()
    this.wallCyl.end()
    this.wallBox.end()
  }

  dispose(): void {
    this.cyl.dispose()
    this.box.dispose()
    this.wallCyl.dispose()
    this.wallBox.dispose()
    this.fade.dispose()
  }
}

function volumeMaterial(opacity: number): THREE.Material {
  return new THREE.MeshBasicMaterial({ transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide })
}

function ghostMaterial(): THREE.Material {
  return new THREE.MeshBasicMaterial({ transparent: true, opacity: GHOST_OPACITY, depthWrite: false, side: THREE.DoubleSide })
}

/** Une hampe : cylindre fin, base à y = 0. */
function poleGeometry(radius: number, height: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(radius, radius, height, 8).translate(0, height / 2, 0)
}

/** Le fanion : un triangle au sommet de la hampe, pointe vers +X. */
function wingGeometry(): THREE.BufferGeometry {
  const top = FLAG_POLE_HEIGHT
  const g = new THREE.BufferGeometry()
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [0, top, 0, FLAG_WING_WIDTH, top - FLAG_WING_HEIGHT / 2, 0, 0, top - FLAG_WING_HEIGHT, 0],
      3,
    ),
  )
  g.computeVertexNormals()
  return g
}

/** Les lots d'un drapeau (hampe + fanion), plein ou fantôme. */
interface FlagPools {
  poles: InstancePool
  wings: InstancePool
}

/** Le calque des objectifs du mode. */
export class Objectives3dLayer implements ActionLayer3d {
  readonly labels: LabelPool
  private readonly volumes: ZoneVolumes
  private readonly markers: InstancePool
  private readonly flag: FlagPools
  private readonly ghost: FlagPools
  private readonly skull: InstancePool
  private readonly bomb: InstancePool
  private readonly crowns: InstancePool
  private readonly posOf: CarrierPosAt
  private readonly zOf: FeetZAt

  private readonly flags: PreparedFlag[]
  private readonly skullSources: SkullSources
  private readonly explosions: readonly number[] | null
  private readonly v = new THREE.Vector3()
  private prepared: { from: readonly ObjectiveElementReady[]; value: PreparedObjectives } | null = null
  private readonly ctx: ActionContext
  private readonly page: Objectives3dPage

  constructor(ctx: ActionContext, page: Objectives3dPage) {
    this.ctx = ctx
    this.page = page
    const doc = ctx.doc
    this.posOf = buildCarrierPosAt(doc)
    this.zOf = (xuid, f) => {
      const s = ctx.tracks.sample(xuid, f) ?? ctx.tracks.lastLifeBefore(xuid, f)
      return s ? s.z - ctx.originAboveFloor : null
    }

    this.flags = doc.flagCarries.map((c) => prepareFlag(c, this.zOf))
    this.skullSources = { lives: doc.objectiveObjects, carries: doc.skullCarries, socle: skullSocle(doc.objectiveObjects) }
    this.explosions = bombExplosionsOf(doc)
    this.labels = new LabelPool(ctx.root)
    this.volumes = new ZoneVolumes(ctx.root)
    this.markers = new InstancePool(ctx.root, poleGeometry(MARKER_RADIUS, MARKER_HEIGHT), new THREE.MeshLambertMaterial(), MARKER_CAP)
    const flagCap = Math.max(1, this.flags.length)
    this.flag = this.flagPools(new THREE.MeshLambertMaterial(), new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), flagCap)
    this.ghost = this.flagPools(ghostMaterial(), ghostMaterial(), flagCap)
    this.skull = new InstancePool(ctx.root, new THREE.SphereGeometry(SKULL_RADIUS, 16, 12), new THREE.MeshLambertMaterial(), 1)
    this.bomb = new InstancePool(
      ctx.root,
      new THREE.BoxGeometry(BOMB_SIZE.w, BOMB_SIZE.h, BOMB_SIZE.d),
      new THREE.MeshLambertMaterial(),
      1,
    )
    const crown = new THREE.ConeGeometry(CROWN_RADIUS, CROWN_HEIGHT, CROWN_SIDES).translate(0, CROWN_HEIGHT / 2, 0)
    this.crowns = new InstancePool(ctx.root, crown, new THREE.MeshLambertMaterial(), CROWN_CAP)
  }

  private flagPools(pole: THREE.Material, wing: THREE.Material, cap: number): FlagPools {
    return {
      // Deux lots par drapeau vivant (le fanion fantôme d'un portage non daté) : capacité doublée.
      poles: new InstancePool(this.ctx.root, poleGeometry(FLAG_POLE_RADIUS, FLAG_POLE_HEIGHT), pole, 2 * cap),
      wings: new InstancePool(this.ctx.root, wingGeometry(), wing, 2 * cap),
    }
  }

  update(frame: number): void {
    const inputs = this.ctx.inputs()
    const shown = objectivesShown(inputs.show.objectives, this.page.families?.() ?? null)
    this.begin()
    if (shown.zones) this.paintZones(frame, inputs)
    if (shown.flags) this.paintFlags(frame, inputs.inks)
    this.paintCarriedObjects(frame, inputs.inks, shown)
    this.end()
  }

  private begin(): void {
    this.volumes.begin()
    for (const p of this.instancePools()) p.begin()
    this.labels.begin()
  }

  private end(): void {
    this.volumes.end()
    for (const p of this.instancePools()) p.end()
    this.labels.end()
  }

  private instancePools(): InstancePool[] {
    return [this.markers, this.flag.poles, this.flag.wings, this.ghost.poles, this.ghost.wings, this.skull, this.bomb, this.crowns]
  }

  /** Les objectifs préparés, refaits seulement quand la page sert une autre liste. */
  private objectives(list: readonly ObjectiveElementReady[]): PreparedObjectives {
    if (this.prepared?.from !== list) this.prepared = { from: list, value: prepareObjectives(list, this.ctx.doc) }
    return this.prepared.value
  }

  private paintZones(frame: number, inputs: Action3dInputs): void {
    const { inks } = inputs
    const k: ZoneInks = {
      inkOf: sideInkOf(this.page.allegiance, inks.teamColorOf),
      neutral: inks.zone.fill,
    }
    const prepared = this.objectives(inputs.mapObjectives)
    for (const z of prepared.zones) {
      const ink = zoneDisplayInkAt(z, frame, k)
      if (ink === null) continue
      // shortcut: contour horizontal sur sol incliné, épouser le terrain quand son tracé sera disponible.
      const floor = this.ctx.ground.floorY(z.e.x, z.e.y, z.e.z) ?? z.e.z
      this.volumes.add(z.e, this.ctx.ink.of(ink), floor)
      if (z.letter === null) continue
      this.v.set(...toThree(z.e.x, z.e.y, floor + ZONE_HEIGHT + ZONE_LETTER_LIFT))
      this.labels.add(this.v, z.letter, ink)
    }
    for (const e of prepared.markers) {
      this.v.set(...toThree(e.x, e.y, e.z))
      this.markers.add(this.v, null, 1, this.ctx.ink.of(k.inkOf(e.team) ?? k.neutral))
    }
  }

  private paintFlags(frame: number, inks: ReplayInks): void {
    const inkOf = sideInkOf(this.page.allegiance, inks.teamColorOf)
    for (const f of this.flags) {
      const now = flagPlacesAt(f, frame, this.posOf, this.zOf)
      if (!now) continue
      const color = this.ctx.ink.of(inkOf(now.team) ?? inks.floor.edge)
      if (now.home) this.addFlag(this.placeOf(now.home, frame), color, this.ghost, this.ghost)
      this.addFlag(this.placeOf(now.live, frame), color, this.flag, now.hollow ? this.ghost : this.flag)
    }
  }

  private addFlag(at: THREE.Vector3 | null, color: THREE.Color, pole: FlagPools, wing: FlagPools): void {
    if (!at) return
    pole.poles.add(at, null, 1, color)
    wing.wings.add(at, null, 1, color)
  }

  /**
   * La bombe et les couronnes : au-dessus du porteur, ou au sol. Le crâne : au sol seulement, porté
   * il est dans la main de son porteur (arme tenue, `heldWeapon3d`).
   */
  private paintCarriedObjects(frame: number, inks: ReplayInks, shown: Objectives3dShown): void {
    const objectInk = this.ctx.ink.of(inks.neutral)
    const skull = skullPlaceAt(this.skullSources, frame, this.posOf, this.zOf)
    if (skull && skull.on === 'floor' && shown.skullFree) {
      this.addCentered(this.skull, this.placeOf(skull, frame), SKULL_RADIUS, objectInk)
    }
    if (shown.bombCarrier) {
      const bomb = bombPlaceAt(this.ctx.doc.bombCarries, this.explosions, frame, this.posOf, this.zOf)
      if (bomb) this.addCentered(this.bomb, this.placeOf(bomb, frame), BOMB_SIZE.h / 2, objectInk)
    }
    if (shown.vipCrown) this.paintCrowns(frame, inks)
  }

  private paintCrowns(frame: number, inks: ReplayInks): void {
    for (const p of vipActiveAt(this.ctx.doc.vipCrown, frame)) {
      const at = this.placeOf({ on: 'carrier', xuid: p.xuid }, frame)
      if (!at) continue
      const ally = this.page.allegiance.ofXuid(p.xuid)
      this.crowns.add(at, null, 1, this.ctx.ink.of(ally === null ? inks.floor.edge : inks.teamColorOf(ally)))
    }
  }

  /** Pose une forme centrée sur son origine, son dessous à la place servie. */
  private addCentered(pool: InstancePool, at: THREE.Vector3 | null, halfHeight: number, color: THREE.Color): void {
    if (!at) return
    at.y += halfHeight
    pool.add(at, null, 1, color)
  }

  /**
   * placeOf — le point three où se pose le DESSOUS de l'objet : au-dessus de la tête du porteur,
   * ou au sol. Le vecteur rendu est partagé : à consommer avant le prochain appel.
   */
  private placeOf(place: ObjectPlace, frame: number): THREE.Vector3 | null {
    if (place.on === 'floor') return this.floorAt(place.at, place.hint)
    const feet = this.ctx.playerFeet(place.xuid, frame)
    const base = feet ? this.v.copy(feet) : this.floorUnderCarrier(place.xuid, frame)
    if (!base) return null
    base.y += HEAD_TOP + CARRIED_GAP
    return base
  }

  /** Le porteur que la 3D ne situe pas mais que la 2D situe : le sol sous son point 2D. */
  private floorUnderCarrier(xuid: string, frame: number): THREE.Vector3 | null {
    const at = this.posOf(xuid, frame)
    return at ? this.floorAt(at, this.zOf(xuid, frame)) : null
  }

  private floorAt(at: XY, hint: number | null): THREE.Vector3 | null {
    const y = this.ctx.ground.floorY(at.x, at.y, hint) ?? hint
    if (y === null) return null
    const [x, , z] = toThree(at.x, at.y, 0)
    return this.v.set(x, y, z)
  }

  dispose(): void {
    this.volumes.dispose()
    for (const p of this.instancePools()) p.dispose()
    this.labels.dispose()
  }
}
