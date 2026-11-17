// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * objectives3d.ts — THE MODE'S OBJECTIVES IN THE 3D SCENE: zones, markers, flags, skull, bomb,
 * VIP crown.
 *
 * The rules are the 2D's own, read by `objectives3dModel`; this layer only places things:
 *  - a ZONE is a flat outline (a circle of its radius, or a rectangle of its half-sides along
 *    `fwd`) and a low translucent wall at ground level, tinted by the known owner;
 *  - a MARKER (spawn, pad, delivery) is a thin pole of `MARKER_HEIGHT`; a CTF base
 *    has none once the flag model is drawn (`markersToDraw`);
 *  - a FLAG is the game's model (the flag's `weap`, `flagObjectIdOf`): in its carrier's hand (the
 *    held weapon, `heldWeapon3d`), otherwise standing on the ground, on its base or wherever it
 *    fell. The base's pedestal is a map variant object, placed with it;
 *  - the SKULL is a sphere, the BOMB a box, the CROWN a cone: above the carrier, or on the
 *    ground for the first two.
 *
 * A carried object follows its carrier's 3D feet (`playerFeet`, including a vehicle); when the
 * 3D does not place them but the 2D does (the window after death), it is placed at the 2D point.
 * The 2D's carried-object blinking has no equivalent here: a batch has only one opacity.
 *
 * Halo world units (see `tracks3d`).
 */
import * as THREE from 'three'

import type { FilmAllegiance } from '@/lib/replay/filmAllegiance'
import type { XY } from '@/lib/replay/replayLogic'

import type { ObjectiveElementReady } from '../layers/objectivesLayer'
import type { ReplayInks } from '../layers/useReplayInks'
import { vipActiveAt } from '../layers/vipCrownLayer'
import { flagObjectIdOf } from '../model/weaponInHand'
import type { CarrierPosAt } from '../model/carriedGlyphPlace'
import { buildCarrierPosAt } from '../model/carrierPosition'
import { skullSocle } from '../model/skullPresence'
import type { Action3dInputs } from './action3dInputs'
import { InstancePool, LabelPool } from './actionKit'
import type { ActionContext, ActionLayer3d } from './actionScene3d'
import { HEAD_TOP } from './body3d'
import { flagBannerInk } from './flagBanner3d'
import { standingWeaponPose } from './groundWeaponPose3d'
import {
  bombExplosionsOf,
  bombPlaceAt,
  flagPlaceAt3d,
  markersToDraw,
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
import { WeaponModelPool } from './weaponModels3d'
import { zoneOutlineGeometry, zoneWallGeometry } from './zoneOutline3d'

/** Reference height for zone labels (u). */
const ZONE_HEIGHT = 1.2
/** Minimum radius of a zone cylinder (u): a degenerate zone stays visible. */
const ZONE_MIN_RADIUS = 0.2
/** The zone's letter, above the volume (u). */
const ZONE_LETTER_LIFT = 0.25
/** A marker's pole (u). */
const MARKER_HEIGHT = 1
const MARKER_RADIUS = 0.03
/** A carried object floats this far above the top of the head (u). */
const CARRIED_GAP = 0.08
/** The skull (~21cm, the game model's size), the bomb (width, height, depth), the crown (u). */
const SKULL_RADIUS = 0.035
const BOMB_SIZE = { w: 0.3, h: 0.18, d: 0.22 }
const CROWN_RADIUS = 0.12
const CROWN_HEIGHT = 0.2
const CROWN_SIDES = 5
/** Batch caps. */
const ZONE_CAP = 64
const MARKER_CAP = 64
const CROWN_CAP = 8

const Y_AXIS = new THREE.Vector3(0, 1, 0)

/**
 * What the page passes to the layer in addition to the common context.
 *
 * - `allegiance`: `model.allegiance`, the same one the 2D layers use (`useZoneStates`,
 *   `useReplayFlagCarries`, `useReplayVipCrown`); it carries the viewpoint.
 * - `families`: the drawer's per-family toggles (`showFlagCarries`, `showVipCrown`,
 *   `showSkullCarrier`, `showBombCarrier`), re-read every frame. When absent, `show.objectives`
 *   drives all of them (see `objectivesShown`).
 */
export interface Objectives3dPage {
  allegiance: Pick<FilmAllegiance, 'ofTeam' | 'ofXuid'>
  families?: () => Objectives3dFamilies
}

/** The two batches of a zone's opacity: circular and rectangular outlines. */
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
    // The box's local X axis follows `fwd`: Halo (x, y) becomes (x, -y) in the three.js plane.
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

/** A pole: a thin cylinder, base at y = 0. */
function poleGeometry(radius: number, height: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(radius, radius, height, 8).translate(0, height / 2, 0)
}

/** The mode's objectives layer. */
export class Objectives3dLayer implements ActionLayer3d {
  readonly labels: LabelPool
  private readonly volumes: ZoneVolumes
  private readonly markers: InstancePool
  /** Flags placed on the ground: copies of the game's model. */
  private readonly flagModels: WeaponModelPool
  /** This film's flag `weap`, null with no carry naming one. */
  private readonly flagId: string | null
  /** The flag model's standing pose, measured once on the loaded model. */
  private flagPose: { model: THREE.Object3D; pose: ReturnType<typeof standingWeaponPose> } | null = null
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

    this.flags = doc.flagCarries.map(prepareFlag)
    this.flagId = flagObjectIdOf(doc)
    this.skullSources = { lives: doc.objectiveObjects, carries: doc.skullCarries, socle: skullSocle(doc.objectiveObjects) }
    this.explosions = bombExplosionsOf(doc)
    this.labels = new LabelPool(ctx.root)
    this.volumes = new ZoneVolumes(ctx.root)
    this.markers = new InstancePool(ctx.root, poleGeometry(MARKER_RADIUS, MARKER_HEIGHT), new THREE.MeshLambertMaterial(), MARKER_CAP)
    this.flagModels = new WeaponModelPool(ctx.root)
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

  update(frame: number): void {
    const inputs = this.ctx.inputs()
    const shown = objectivesShown(inputs.show.objectives, this.page.families?.() ?? null)
    this.begin()
    if (shown.zones) this.paintZones(frame, inputs, shown.flags)
    if (shown.flags) this.paintFlags(frame, inputs)
    this.paintCarriedObjects(frame, inputs.inks, shown)
    this.end()
  }

  private begin(): void {
    this.volumes.begin()
    for (const p of this.instancePools()) p.begin()
    this.flagModels.begin()
    this.labels.begin()
  }

  private end(): void {
    this.volumes.end()
    for (const p of this.instancePools()) p.end()
    this.labels.end()
  }

  private instancePools(): InstancePool[] {
    return [this.markers, this.skull, this.bomb, this.crowns]
  }

  /** The prepared objectives, remade only when the page serves another list. */
  private objectives(list: readonly ObjectiveElementReady[]): PreparedObjectives {
    if (this.prepared?.from !== list) this.prepared = { from: list, value: prepareObjectives(list, this.ctx.doc) }
    return this.prepared.value
  }

  private paintZones(frame: number, inputs: Action3dInputs, flagsShown: boolean): void {
    const { inks } = inputs
    const k: ZoneInks = {
      inkOf: sideInkOf(this.page.allegiance, inks.teamColorOf),
      neutral: inks.zone.fill,
    }
    const prepared = this.objectives(inputs.mapObjectives)
    for (const z of prepared.zones) {
      const ink = zoneDisplayInkAt(z, frame, k)
      if (ink === null) continue
      // shortcut: a horizontal outline on sloped ground, hug the terrain once its trace is available.
      const floor = this.ctx.ground.floorY(z.e.x, z.e.y, z.e.z) ?? z.e.z
      this.volumes.add(z.e, this.ctx.ink.of(ink), floor)
      if (z.letter === null) continue
      this.v.set(...toThree(z.e.x, z.e.y, floor + ZONE_HEIGHT + ZONE_LETTER_LIFT))
      this.labels.add(this.v, z.letter, ink)
    }
    for (const e of markersToDraw(prepared.markers, flagsShown && this.flagModel() !== null)) {
      this.v.set(...toThree(e.x, e.y, e.z))
      this.markers.add(this.v, null, 1, this.ctx.ink.of(k.inkOf(e.team) ?? k.neutral))
    }
  }

  /**
   * Flags out of hand: the game's model standing on the ground, with its team's banner
   * (`flagBanner3d`). The one held by a carrier the 3D places is in their hand (`heldWeapon3d`);
   * a carrier it does not place leaves it on the ground under their 2D point. While the model is
   * not loaded, nothing. The standing pose is measured on the bare model (the banner hangs above its foot).
   */
  private paintFlags(frame: number, inputs: Action3dInputs): void {
    const model = this.flagModel()
    if (!model || !this.flagId) return
    if (this.flagPose?.model !== model) this.flagPose = { model, pose: standingWeaponPose(model) }
    const { pose } = this.flagPose
    for (const f of this.flags) {
      const place = flagPlaceAt3d(f, frame, this.posOf, this.zOf)
      if (!place || (place.on === 'carrier' && this.ctx.playerFeet(place.xuid, frame))) continue
      const at = place.on === 'floor' ? this.floorAt(place.at, place.hint) : this.floorUnderCarrier(place.xuid, frame)
      if (!at) continue
      at.y += pose.lift
      const ink = flagBannerInk(inputs, f.carry.team, this.ctx.ink)
      this.flagModels.add(this.ctx.flagModel(this.flagId, f.carry.team, ink) ?? model, at, pose.rotation)
    }
  }

  /** The game's flag model once loaded, null before or without a flag in this film. */
  private flagModel(): THREE.Object3D | null {
    return this.flagId ? this.ctx.weaponModel(this.flagId) : null
  }

  /**
   * The bomb and the crowns: above the carrier, or on the ground. The skull: on the ground only,
   * once carried it is in its carrier's hand (held weapon, `heldWeapon3d`).
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

  /** Places a shape centered on its origin, its underside at the served spot. */
  private addCentered(pool: InstancePool, at: THREE.Vector3 | null, halfHeight: number, color: THREE.Color): void {
    if (!at) return
    at.y += halfHeight
    pool.add(at, null, 1, color)
  }

  /**
   * placeOf — the three.js point where the object's UNDERSIDE sits: above the carrier's head, or
   * on the ground. The returned vector is shared: consume it before the next call.
   */
  private placeOf(place: ObjectPlace, frame: number): THREE.Vector3 | null {
    if (place.on === 'floor') return this.floorAt(place.at, place.hint)
    const feet = this.ctx.playerFeet(place.xuid, frame)
    const base = feet ? this.v.copy(feet) : this.floorUnderCarrier(place.xuid, frame)
    if (!base) return null
    base.y += HEAD_TOP + CARRIED_GAP
    return base
  }

  /** A carrier the 3D does not place but the 2D does: the ground under their 2D point. */
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
    this.flagModels.dispose()
    this.labels.dispose()
  }
}
