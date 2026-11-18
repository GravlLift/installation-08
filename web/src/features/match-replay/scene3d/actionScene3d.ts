// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * actionScene3d.ts — THE MATCH ACTION IN THE 3D SCENE: the layer contract and their set.
 *
 * An action layer reads the document and the page inputs (`Action3dInputs`) and places, at each
 * frame, what's visible (shots, flights, ground weapons, vehicles, deaths...) in its batches of
 * shapes (`actionKit`). The scene calls `update(frame)` after placing the players, on screen as
 * during an export: the shapes are in the rendered frame, labels are repainted by the export.
 *
 * Three questions rise from the layers to the players, and the set answers them for the scene:
 * the held weapon (`heldWeapon`), the Spartan's motion (`motion`, the game clips chosen by
 * `motion3d`), and an embarked player's position (`riderAt`): a biped aboard no longer replicates
 * his own position, he follows his vehicle.
 */
import * as THREE from 'three'

import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import type { Action3dInputs } from './action3dInputs'
import type { Ground, InkCache, LabelPool } from './actionKit'
import { flagBannerInk } from './flagBanner3d'
import type { Aids3d } from './aids3d'
import type { Dress, SpartanArmory } from './armory3d'
import type { AttachBone, DrawnWeapon } from './avatar3d'
import { BodyFx3d } from './bodyFx3d'
import type { BodyFxState } from './bodyShell3d'
import type { BakedLight } from './bakedLightShader'
import type { ClipMix } from './clipSample3d'
import type { FlashLights } from './flash3d'
import type { HeldWeapon3d } from './heldWeapon3d'
import { Motion3d } from './motion3d'
import { actionsParSlot, episodesRechargementParSlot } from './filmActions3d'
import { indexShotTimes, type SlotShots } from './recoilShots3d'
import { prepareFirstPersonEvents } from './firstPersonEvents3d'
import type { WeaponSwitch, FirstPersonFrameEvents } from './firstPersonActions3d'
import type { ReloadEpisode } from './firstPersonReload3d'
import type { ShotFxEntry } from '../model/shotFx'
import { newRecoil, type Recoil } from './recoil3d'
import { ShooterRecoil } from './recoilShots3d'
import type { PlayerState3d, Tracks3d } from './tracks3d'
import { weaponModelKey } from './weaponModels3d'

/** What each layer receives at construction. */
export interface ActionContext {
  readonly doc: ReplayDocumentReady
  readonly tracks: Tracks3d
  readonly ground: Ground
  readonly ink: InkCache
  /** The group where the layer places its batches and labels. */
  readonly root: THREE.Group
  /** Height of a player's published origin above his feet (u). */
  readonly originAboveFloor: number
  /** The page's current inputs: re-read every frame (theme, drawer, language). */
  inputs(): Action3dInputs
  /**
   * Where a player stands at frame `frame` (three axes, feet on the ground), vehicle included;
   * null if he isn't alive. The vehicle layer answers this for embarked players.
   */
  playerFeet(xuid: string, frame: number): THREE.Vector3 | null
  /** The same question by biped slot (shots and grenades name a slot). */
  slotState(slot: number, frame: number): PlayerState3d | null
  /** The game's model of weapon `id` (to clone), null until it is loaded (`weaponModels3d`). */
  weaponModel(id: string): THREE.Object3D | null
  /**
   * The game's model of the flag `id` (to clone) dressed with the banner of team `team`, its cloth
   * tinted `ink` (`flagBannerInk`; null: the effect's white), the bare model while the banner is
   * not known, null until the model is loaded (`weaponModels3d.flagModel`).
   */
  flagModel(id: string, team: number | null, ink: THREE.Color | null): THREE.Object3D | null
  /** The game's model of the grenade projectile of rank `rank` (to clone), null until it is loaded. */
  grenadeModel(rank: number): THREE.Object3D | null
  /** The game's skinned Spartan (to clone via `SkeletonUtils`), null until it is loaded. */
  spartanModel(): THREE.Object3D | null
  /** Player `xuid`'s dress (`armory3d`), null until it is ready or without armor served. */
  dressOf(xuid: string): Dress | null
  /**
   * The match's armory (held weapons' coatings, and the default-style paint of the map objects:
   * the pad, rack and ground weapons, `armory3d.paintObject`/`objectCoat`); null until it is posed
   * (the action layers may be built before the armor query answers).
   */
  armurerie?: () => SpartanArmory | null
  /**
   * The weapon the scene draws in player `xuid`'s hand at the placed frame (`avatar3d.drawnWeapon`),
   * null without a drawn weapon: the muzzle flash is placed at the end of its own barrel.
   */
  drawnWeapon(xuid: string): DrawnWeapon | null
  /** The slot the camera carries in first person at frame `frame`, null otherwise. */
  firstPersonSlot(frame: number): number | null
  /**
   * The first-person rig's muzzle (camera frame) for the held weapon `held` (model key); true and
   * `out` filled when that weapon's rig is loaded, false otherwise (the shot takes the static model).
   */
  rigMuzzle?: (held: string | null, out: THREE.Vector3) => boolean
  /**
   * The first-person rig's muzzle in WORLD space, read at the rendered frame (`pos` and `axe` of
   * the unit barrel); true when a visible rig has a measured muzzle, false otherwise (the flash
   * follows the flight).
   */
  rigMuzzleWorld?: (pos: THREE.Vector3, axe: THREE.Vector3) => boolean
  /**
   * Where a first-person grapple cable leaves, in WORLD space at the rendered frame: the viewer's
   * left hand (`grapple3d_logic.fpCableStart`), written in `out`; null when the scene has no rig.
   */
  firstPersonLeftHand?: (out: THREE.Vector3) => THREE.Vector3 | null
  /**
   * Where bone `node` (the skin joint of that rank: the render model's node) of the body drawn for
   * the biped of slot `slot` is at the rendered frame, its world matrix written in `out`: 'drawn'.
   * In first person on that biped, the first-person rig's bone of the same name when it has one,
   * else 'hidden' (nothing of him is drawn there). 'none' when no body is drawn for that slot
   * (no such player, out of life, no Spartan model): the caller keeps its own placement.
   */
  attachBone?: (slot: number, node: number, out: THREE.Matrix4) => AttachBone

  /**
   * Is the scope mounted on the rendered frame's first-person view (arms removed from screen),
   * read at the same frame; `null` when the scene doesn't carry it.
   */
  scopeMounted?: () => boolean
  /** The served folder of the weapon library (its index and files), null until known. */
  weaponLibrary?: () => string | null
  /**
   * The WORLD frame of the idle-effect marker `marker` of weapon `key` on the visible first-person
   * rig (its bone's world matrix, then the marker's offset), written in `out`; false when the rig of
   * that weapon is not shown or does not carry the marker. `instance`: which of the marker's instances,
   * in the index's order (0 the first).
   */
  firstPersonEffectAnchor?: (key: string, marker: string, out: THREE.Matrix4, instance?: number) => boolean
  /** Why the last `firstPersonEffectAnchor` call failed, for review (null when it succeeded). */
  firstPersonAnchorMiss?: () => string | null
  /** The length in seconds of the first-person clip `action` of weapon `key` (its rig index), null without one. */
  weaponClipSeconds?: (key: string, action: string) => number | null
  /** The brief flash lights: the set opens and closes them around the layers. */
  readonly flashes: FlashLights
  /** The map's baked light (`lighting.takeGameLight`), grafted onto players' armor. */
  readonly baked?: BakedLight | null
  /** The environment probe nearest a point (reflections off: null); without one, players stand with no probe. */
  readonly probeAt?: (position: THREE.Vector3) => THREE.Texture | null
}

export interface ActionLayer3d {
  update(frame: number): void
  /** Finish the deferred work frame `frame` needs before it is drawn (`ActionScene3d.settle`). */
  settle?(frame: number): void
  prepareCorpses?(): THREE.Object3D[]
  /** The layer's labels (repainted in the exported frame). */
  readonly labels?: LabelPool
  /** An embarked player: his feet (three axes) on his vehicle, or null. */
  riderAt?(xuid: string, frame: number): THREE.Vector3 | null
  /** His vehicle's heading (degrees): an embarked player's camera looks where it's going. */
  riderHeadingAt?(xuid: string, frame: number): number | null
  /** The feet of victim `xuid`'s inert body at frame `frame` (three axes), written in `out`; null without a body. */
  corpseFeet?(xuid: string, frame: number, out: THREE.Vector3): THREE.Vector3 | null
  dispose(): void
}

/**
 * The held weapon as the capsule shows it: its name, its shots' tint, its game model, and that
 * model's key (null when the identifier doesn't give one).
 */
export interface HeldShown {
  name: string
  color: THREE.Color
  model: THREE.Object3D | null
  key: string | null
  /** The weapon's recoil at the frame (`recoil3d`), overwritten on each call for that slot. */
  recoil: Recoil
}

/** The set of an action scene's layers. */
const EMPTY: readonly number[] = []
const NO_CHANGE: readonly WeaponSwitch[] = []
const NO_RELOAD: readonly ReloadEpisode[] = []

export class ActionScene3d {
  private readonly ctx: ActionContext
  private readonly layers: readonly ActionLayer3d[]
  private readonly held: { at(slot: number, frame: number): HeldWeapon3d | null }
  private readonly body: BodyFx3d
  private readonly moves: Motion3d
  private readonly recoil: ShooterRecoil
  private readonly reloadsBySlot: Map<number, ReloadEpisode[]>
  private readonly meleesBySlot: Map<number, number[]>
  private readonly firstPerson: ReturnType<typeof prepareFirstPersonEvents>
  private shotSource: readonly ShotFxEntry[] | null = null
  private shots = new Map<number, SlotShots>()
  private firstPersonXuid = ''
  private readonly events: FirstPersonFrameEvents = {
    reloads: [], strikes: [], shots: [], grenades: [], weaponSwitches: [], sprints: [], slides: [], crouches: [], jumps: [], climbs: [], usages: [], frame: 0, fps: 1,
    reloadValid: (t, f) => this.moves.rechargementValide(this.firstPersonXuid, t, f),
  }
  private readonly kicks = new Map<number, Recoil>()

  constructor(
    ctx: ActionContext,
    layers: readonly ActionLayer3d[],
    held: { at(slot: number, frame: number): HeldWeapon3d | null },
  ) {
    this.ctx = ctx
    this.layers = layers
    this.held = held
    this.reloadsBySlot = episodesRechargementParSlot(ctx.doc)
    this.meleesBySlot = actionsParSlot(ctx.doc, 'melee')
    this.firstPerson = prepareFirstPersonEvents(ctx.doc, (slot, frame) => held.at(slot, frame))
    this.body = new BodyFx3d(ctx)
    this.moves = new Motion3d(ctx, (slot, frame) => held.at(slot, frame))
    this.recoil = new ShooterRecoil(ctx.doc, () => ctx.inputs())
  }

  evenementsPremierePersonne(xuid: string, slot: number, frame: number, fps: number): FirstPersonFrameEvents {
    const source = this.ctx.inputs().shotFx
    if (source !== this.shotSource) {
      this.shotSource = source
      this.shots = indexShotTimes(source)
    }
    this.firstPersonXuid = xuid
    const e = this.events
    e.reloads = this.reloadsBySlot.get(slot) ?? NO_RELOAD
    e.strikes = this.meleesBySlot.get(slot) ?? EMPTY
    e.shots = this.shots.get(slot)?.frames ?? EMPTY
    e.grenades = this.firstPerson.grenades.get(slot) ?? EMPTY
    e.weaponSwitches = this.firstPerson.weaponSwitches.get(slot) ?? NO_CHANGE
    e.sprints = this.firstPerson.sprints.get(slot) ?? []
    e.slides = this.firstPerson.slides.get(slot) ?? []
    const postures = this.moves.postures(slot)
    e.crouches = postures.crouch
    e.jumps = postures.jump
    e.climbs = postures.clamber
    e.usages = this.moves.firstPersonUses(slot, fps)
    e.frame = frame
    e.fps = fps
    return e
  }

  update(frame: number): void {
    this.ctx.flashes.begin()
    for (const l of this.layers) l.update(frame)
    this.ctx.flashes.end()
  }

  /**
   * settle finishes, before frame `frame` is drawn, the work a layer otherwise spreads over the
   * frames of the view (the ragdoll bakes of the bodies visible there). The video export calls it
   * on each frame so that no encoded frame shows a stopgap; the screen never does.
   */
  settle(frame: number): void {
    for (const l of this.layers) l.settle?.(frame)
  }

  prepareCorpses(): THREE.Object3D[] {
    return this.layers.flatMap((layer) => layer.prepareCorpses?.() ?? [])
  }

  heldWeapon(slot: number, frame: number): HeldShown | null {
    const w = this.held.at(slot, frame)
    if (!w) return null
    const inputs = this.ctx.inputs()
    const fx = inputs.inks.fx
    let recoil = this.kicks.get(slot)
    if (!recoil) this.kicks.set(slot, (recoil = newRecoil()))
    return {
      name: w.name,
      color: this.ctx.ink.of(fx.tint[w.tint] || fx.core),
      model: w.flagTeam === undefined
        ? this.ctx.weaponModel(w.id)
        : this.ctx.flagModel(w.id, w.flagTeam, flagBannerInk(inputs, w.flagTeam, this.ctx.ink)),
      key: weaponModelKey(w.id),
      recoil: this.recoil.at(slot, frame, w.id, recoil),
    }
  }

  /**
   * motion: the player's game clip mix at the frame (`motion3d`), written in `out`; null out of
   * life or without an animated Spartan. `aboard`: aboard a vehicle.
   */
  motion(xuid: string, frame: number, aboard: boolean, out: ClipMix): ClipMix | null {
    return this.moves.at(xuid, frame, aboard, out)
  }

  /** bodyFx: what the player's body shows at the frame (shield), overwritten on each call. */
  bodyFx(xuid: string, frame: number): BodyFxState {
    return this.body.at(xuid, frame)
  }

  riderAt(xuid: string, frame: number): THREE.Vector3 | null {
    for (const l of this.layers) {
      const p = l.riderAt?.(xuid, frame)
      if (p) return p
    }
    return null
  }

  riderHeadingAt(xuid: string, frame: number): number | null {
    for (const l of this.layers) {
      const h = l.riderHeadingAt?.(xuid, frame)
      if (h !== undefined && h !== null) return h
    }
    return null
  }

  /** corpseFeet: the feet of `xuid`'s inert body at frame `frame` (the deaths layer answers this). */
  corpseFeet(xuid: string, frame: number, out: THREE.Vector3): THREE.Vector3 | null {
    for (const l of this.layers) {
      const p = l.corpseFeet?.(xuid, frame, out)
      if (p) return p
    }
    return null
  }

  /** aids: the 3D drawer's analysis aids (`aids3d`), re-read on every call. */
  aids(): Aids3d {
    return this.ctx.inputs().aids
  }

  labelPools(): LabelPool[] {
    return this.layers.flatMap((l) => (l.labels ? [l.labels] : []))
  }

  dispose(): void {
    for (const l of this.layers) l.dispose()
  }
}
