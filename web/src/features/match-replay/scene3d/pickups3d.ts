// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * pickups3d.ts — WEAPON PADS AND GROUND WEAPONS IN THE 3D SCENE.
 *
 * No rule is rewritten here: a pad's presence and state, the ground weapon filter, and a
 * weapon's nature are those of the 2D view, called as they are.
 *  - The pad itself (floor pad, wall rack) is the game's own model, drawn by the variant object
 *    layer (`variantLayer.ts`); this layer draws only the weapon it holds. Full, a weapon box in its
 *    family ink (`padFamilyOf`) floats above the pad and turns slowly; uncertain, the box is a ghost;
 *    empty, nothing is drawn (`padStateAt`). A WEAPON RACK (the map spawner the server crossed the
 *    pad with is a `rack`, `rackMountsOf`) holds its weapon still, inside the rack at the rack
 *    model's own mount marker (`rackWeaponOffset`, `rackWeaponRotation`), outlined like a pickup:
 *    no lift, no spin, same full / uncertain / empty states. Every crossed pad stands at its spawner's position, never at a floor ray read at
 *    construction. Without that crossing, a pad above the floor (`padMountOf`) keeps the earlier
 *    fallback: only the game's weapon model is posed, at its height. `window.__it3dPickups` reads
 *    what each pad drew (`debugRows`). A pad outside the map's bounds (`padOutOfBounds`) is not
 *    drawn at all. Pads are prepared as in 2D: crossed with the map's slots, dated by native
 *    pickups, then their uncertainty brought back to what a player could have done
 *    (`useReplayWeaponPads`).
 *  - The weapon's GAME MODEL (`weaponModels3d`) replaces the solid box as soon as it is loaded.
 *    A power-up pad names its item by equipment family (`powerup_camo`); the library resolves the
 *    family to the pickup object's own model (`equipmentKeys3d`), drawn the same way. An
 *    EQUIPMENT pad (`repulsor`, `wall`, `grapple`, `sensor`, `thruster`..., crossed as `equipment`)
 *    is the same: its item floats and turns above the pad while it is there and is gone once
 *    taken. Every floating pad item, weapon or not, turns about the center of its model, over the
 *    pad's center (`centerOffset`).
 *  - A GROUND WEAPON is the same box, lying on the ground, in the ink of its nature; in its
 *    undated vanishing window (`vanishing`), it moves to the ghost pool (`groundWeaponPresenceAt`).
 *    The drawer's filters (special weapons only, starting weapons) are those of
 *    `useReplayGroundWeapons`.
 *
 * The rotation is derived from the frame, never from the clock: the screen and the export render
 * the same pose. Halo world units (see `tracks3d`).
 */
import * as THREE from 'three'

import type { ReplayBounds, ReplayGroundWeapon } from '@/lib/api/types'
import type { ReplayDocumentReady, ReplayWeaponPadReady } from '@/lib/replay/replayNormalize'

import {
  crossedWeaponPads,
  isSpecialWeaponRole,
  weaponLabelKeyOf,
  weaponRoleOf,
} from '../layers/useReplayWeaponPads'
import { groundWeaponPresenceAt } from '../model/groundWeaponTime'
import { applyPadPickupDating } from '../model/padPickupDating'
import { refinePadPresence } from '../model/padPresenceRefine'
import { visibleGroundWeapons } from '../model/startingWeaponsOnGround'
import { padFamilyOf, type PadFamily } from '../model/weaponPadFamilies'
import { padStateAt, type PadState } from '../model/weaponPadTime'
import { InstancePool, type Ground } from './actionKit'
import type { ActionContext, ActionLayer3d } from './actionScene3d'
import { addPickupOutline } from './itemOutline3d'
import { toThree } from './tracks3d'
import { WeaponModelPool, weaponModelKey } from './weaponModels3d'
import { centerOffset, groundWeaponPose, standingItemCorrection } from './groundWeaponPose3d'
import { applyWeaponCoating } from './avatar3d'
import { padItemRotation, type PadOffset } from './padOffsets3d'
import { frameToMs } from '@/lib/replay/replayLogic'

/** The weapon box: length, height, width (u). */
const BOX_LENGTH = 0.5
const BOX_HEIGHT = 0.08
const BOX_WIDTH = 0.12
/** Gap between a floor pad's feet and the underside of the weapon floating above it (u). */
const PAD_BOX_LIFT = 0.28
/**
 * One full turn of a floating pad item, seconds. The game's own: the power pad's animation graph
 * (jmad 03e2398d, under Rani e647e90e of mach fca8a400) holds a 120-frame, 30 fps clip (b56ddd4e)
 * that turns the pad's weapon-mount node (58c3647e, marker 630cde8c, 0.3 u up) once about the
 * pad's up, counterclockwise seen from above, at a constant 3 degrees a frame, with no bob.
 */
export const PAD_SPIN_PERIOD_S = 4
/**
 * Phase offset from one pad to the next, so the items don't all turn in lockstep (radians). Not
 * the game's: when each pad's clip starts is not known.
 */
const PAD_SPIN_PHASE = 0.7

/** padSpinPerFrame — a floating pad item's turn per film frame (radians), from the film's frame interval. */
export function padSpinPerFrame(frameMs: number): number {
  return frameMs > 0 ? (2 * Math.PI * frameMs) / (PAD_SPIN_PERIOD_S * 1000) : 0
}
/** A lying weapon's orientation: the golden angle, which scatters headings with no visible pattern. */
const GROUND_YAW_STEP = Math.PI * (3 - Math.sqrt(5))
/**
 * A published z snaps to the floor it overhangs by less than this (u): an object's origin floats
 * by a few centimeters. Beyond that (a wall rack), the published z is trusted.
 */
const FLOOR_SNAP = 0.3
/**
 * A pad more than this above the floor under it is a wall rack, not a floor pad: only the game's
 * weapon model is posed on it, at its height (u).
 */
const PAD_MOUNT_THRESHOLD = 0.25
/**
 * Where a rack holds its weapon, along the rack's forward from its spawner (u): the rack's render
 * model (`mode 630f65b3`, placed at identity by its Forge kit `foki 2497072f`) carries the marker
 * `630cde8c` on its tray bone (`03e84948`) at +0.0201, and the rack's open clip (jmad `8542a522`,
 * reached through the machine's `Rani 51bd09f2`) slides that tray +0.0315 forward as the doors
 * part. Open, the weapon's origin sits at +0.0516, inside the rack (its front is at +0.065).
 */
export const RACK_WEAPON_MOUNT = 0.0201 + 0.0315
/** A pad past this margin outside the map's bounds is not drawn (u). */
const PAD_OUT_OF_BOUNDS_MARGIN = 5
/** Pool cap: a few hundred objects at most. */
const POOL_CAP = 400
/** Opacity of the ghost pool (uncertain, vanishing). */
const GHOST_OPACITY = 0.35
/**
 * Emissive strength of the glow on a floating pad item: a faint self-lit tint in its family ink so
 * it reads at a distance. The scene's outline is the team line (ally/enemy mask channels of
 * `outline3d`); a pad item would need a third category in those shaders, so the glow stays a
 * one-time material clone with no extra draw call. At 0.35 a flat ink over the weapons' untextured
 * dark metal drowned their shading: Fortress's S7 drew as a pale flat silhouette.
 */
export const GLOW_EMISSIVE = 0.1

const Y_AXIS = new THREE.Vector3(0, 1, 0)

/** The document fields pad preparation needs. */
export type PadSources = Pick<ReplayDocumentReady, 'weaponPads' | 'mapWeaponPads' | 'padPickups' | 'tracks'>

/** The document's weapon catalog, as it arrives. */
type Labels = ReplayDocumentReady['weaponLabels']

/** The document fields the ground weapon filter needs. */
export interface GroundSources {
  groundWeapons: readonly ReplayGroundWeapon[]
  weaponLabels?: Labels
  loadouts: ReplayDocumentReady['loadouts']
}

/**
 * prepareWeaponPads — pads the way 2D draws them: position crossed with the map, then dated by
 * native pickup, then uncertainty refined. The order is `useReplayWeaponPads`'s own. One pass per
 * document.
 */
export function prepareWeaponPads(doc: PadSources): readonly ReplayWeaponPadReady[] {
  return refinePadPresence(
    applyPadPickupDating(crossedWeaponPads(doc.weaponPads, doc.mapWeaponPads), doc.padPickups),
    doc.tracks,
  )
}

/**
 * pickupFamilyOf — a weapon's nature, pad or ground. The canonical key is read under the
 * normalized form of the id (`weaponLabelKeyOf`), idempotent on a pad's own.
 */
export function pickupFamilyOf(weapon: string, labels: Labels): PadFamily {
  return padFamilyOf(weapon, labels?.[weaponLabelKeyOf(weapon)]?.key)
}

/**
 * shownGroundWeapons — the ground weapons the drawer's filters keep, in `useReplayGroundWeapons`'s
 * order: special weapons first, starting weapons next.
 */
export function shownGroundWeapons(
  doc: GroundSources,
  specialOnly: boolean,
  includeStarting: boolean,
): readonly ReplayGroundWeapon[] {
  const candidates = specialOnly
    ? doc.groundWeapons.filter((item) => isSpecialWeaponRole(weaponRoleOf(item.w, doc.weaponLabels)))
    : doc.groundWeapons
  return visibleGroundWeapons(candidates, doc.loadouts, includeStarting)
}

/** How a weapon box looks at a frame: solid, ghost, or absent. */
export type BoxLook = 'solid' | 'ghost' | null

/** padBoxLook — full: solid box; uncertain: ghost box; empty: no box. */
export function padBoxLook(state: PadState): BoxLook {
  if (state === 'full') return 'solid'
  return state === 'uncertain' ? 'ghost' : null
}

/** groundBoxLook — present: solid; vanishing undated: ghost; otherwise nothing. */
export function groundBoxLook(item: ReplayGroundWeapon, frame: number): BoxLook {
  const presence = groundWeaponPresenceAt(item, frame)
  if (!presence) return null
  return presence.vanishing ? 'ghost' : 'solid'
}

/**
 * floorUnder — the three-space height of the floor under an object. Without a published z, the
 * first floor under the ceiling; with one, the floor under it if close enough, else the published
 * z itself.
 */
export function floorUnder(ground: Pick<Ground, 'floorY'>, x: number, y: number, z: number | undefined): number | null {
  if (z === undefined) return ground.floorY(x, y, null)
  const f = ground.floorY(x, y, z)
  return f !== null && z - f <= FLOOR_SNAP ? f : z
}

/**
 * padMountOf — a pad is WALL-MOUNTED when it overhangs the floor under it by more than
 * PAD_MOUNT_THRESHOLD; otherwise it is ON THE FLOOR. Without a published z or a known floor, it is
 * on the floor: unknown does not invent a rack (the floor is read from the map's mesh, not from
 * the document).
 */
export function padMountOf(z: number | undefined, floor: number | null): 'floor' | 'mounted' {
  if (z === undefined || floor === null) return 'floor'
  return z - floor > PAD_MOUNT_THRESHOLD ? 'mounted' : 'floor'
}

/**
 * padOutOfBounds — a pad is out of play, and so not drawn, if it exceeds the map's bounds by
 * PAD_OUT_OF_BOUNDS_MARGIN in x or y. Without bounds, nothing is out of play.
 */
export function padOutOfBounds(
  bounds: Pick<ReplayBounds, 'minX' | 'maxX' | 'minY' | 'maxY'> | undefined,
  x: number,
  y: number,
): boolean {
  if (!bounds) return false
  return (
    x < bounds.minX - PAD_OUT_OF_BOUNDS_MARGIN ||
    x > bounds.maxX + PAD_OUT_OF_BOUNDS_MARGIN ||
    y < bounds.minY - PAD_OUT_OF_BOUNDS_MARGIN ||
    y > bounds.maxY + PAD_OUT_OF_BOUNDS_MARGIN
  )
}

/** A game-axes vector as the server publishes it: [x, y, z]. */
type GameAxis = readonly number[] | null | undefined

/** The rack spawner a match pad was crossed with: its own axes (game frame), when published. */
export interface RackMount {
  forward: GameAxis
  up: GameAxis
}

/**
 * The map spawner a match pad was crossed with: its kind (`rack`, `power`, `powerup`,
 * `equipment`) and axes.
 */
export interface CrossedSlot extends RackMount {
  family: string
  scale?: readonly number[] | null
}

/**
 * crossedSlotsOf — per match pad index, the map spawner that confirmed it. The first citation of a
 * pad wins, as in `crossedWeaponPads`. Without crossing (map off-catalog, an earlier answer) the map
 * is empty and every pad keeps its earlier drawing.
 */
export function crossedSlotsOf(cross: ReplayDocumentReady['mapWeaponPads']): Map<number, CrossedSlot> {
  const out = new Map<number, CrossedSlot>()
  for (const spot of cross?.pads ?? []) {
    if (!out.has(spot.pad)) out.set(spot.pad, { family: spot.family, forward: spot.forward, up: spot.up, scale: spot.scale })
  }
  return out
}

/**
 * rackMountsOf — per match pad index, the WEAPON RACK spawner that confirmed it. The map variant
 * names the spawner's kind (`family`, from its type_id): `rack` is the rack that holds its weapon,
 * `power` and `powerup` are floor pads, whose weapon floats and turns.
 */
export function rackMountsOf(cross: ReplayDocumentReady['mapWeaponPads']): Map<number, RackMount> {
  const out = new Map<number, RackMount>()
  for (const [i, slot] of crossedSlotsOf(cross)) {
    if (slot.family === 'rack') out.set(i, { forward: slot.forward, up: slot.up })
  }
  return out
}

/** threeAxis — a published game axis in three axes, normalized; null when absent or degenerate. */
function threeAxis(v: GameAxis): THREE.Vector3 | null {
  if (!v || v.length < 3) return null
  const out = new THREE.Vector3(...toThree(v[0], v[1], v[2]))
  return out.lengthSq() > 1e-8 ? out.normalize() : null
}

/** A Forge object's forward and up in the weapon model's frame. */
export function placedWeaponRotation(mount: RackMount): THREE.Quaternion {
  const forward = threeAxis(mount.forward)!
  const up = threeAxis(mount.up)!
  const right = new THREE.Vector3().crossVectors(forward, up).normalize()
  up.crossVectors(right, forward).normalize()
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward, up, right))
}

/** The rack's forward and up in three axes, squared; upright facing +X without published axes. */
function rackAxes(mount: RackMount): { forward: THREE.Vector3; up: THREE.Vector3 } {
  const up = threeAxis(mount.up) ?? new THREE.Vector3(0, 1, 0)
  let forward = threeAxis(mount.forward)
  if (forward) forward.addScaledVector(up, -forward.dot(up))
  if (!forward || forward.lengthSq() < 1e-8) {
    forward = new THREE.Vector3(1, 0, 0).addScaledVector(up, -up.x)
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1).addScaledVector(up, -up.z)
  }
  return { forward: forward.normalize(), up }
}

/**
 * rackWeaponRotation — the still pose of a weapon in a rack, the rack marker `630cde8c`'s own
 * (quaternion -0.5, -0.5, -0.5, 0.5 in the rack's frame): the weapon's muzzle along the rack's up,
 * its left side facing out along the rack's forward, its top toward the rack's left. In three's
 * axes (model X muzzle, Y up, Z right): X -> up, Y -> up x forward (the rack's left), Z -> -forward.
 * Jordan's Vacancy capture (2026-11-22) shows the VK78 that way: muzzle up, grip to the viewer's
 * left. Without published axes the rack is upright and faces +X.
 */
export function rackWeaponRotation(mount: RackMount): THREE.Quaternion {
  const { forward, up } = rackAxes(mount)
  const left = new THREE.Vector3().crossVectors(up, forward)
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(up, left, forward.clone().negate()))
}

/** rackWeaponOffset — the weapon's origin from the rack's spawner, three axes (`RACK_WEAPON_MOUNT`). */
export function rackWeaponOffset(mount: RackMount): THREE.Vector3 {
  return rackAxes(mount).forward.multiplyScalar(RACK_WEAPON_MOUNT)
}

/** The still pose of a rack weapon: its rotation and its origin from the spawner (`rackWeaponOffset`). */
interface RackPose {
  rotation: THREE.Quaternion
  offset: THREE.Vector3
}

/**
 * glowMaterialOf — the glow copy of a pad item's material: the same material (color, color map,
 * normal map, its compile hooks and its `userData` by reference, as `lighting.copyPerProbe` does:
 * `clone` copies `userData` through JSON, which turns the coating masks' textures into plain
 * objects, and drops `onBeforeCompile`), plus a faint emissive in `ink`. A textured material glows
 * through its own color map, so the tint follows the texture instead of washing over it. A
 * self-lit surface (`selfLit3d`) keeps its own light.
 */
export function glowMaterialOf(source: THREE.Material, ink: THREE.Color): THREE.Material {
  const { userData } = source
  source.userData = {}
  const copy = source.clone()
  source.userData = userData
  copy.userData = userData
  copy.onBeforeCompile = source.onBeforeCompile
  copy.customProgramCacheKey = source.customProgramCacheKey
  // The constant normal for the sun's shadow lookup (`lighting.giveFiniteNormal`): `clone` drops it.
  const defaults = (source as THREE.Material & { defaultAttributeValues?: unknown }).defaultAttributeValues
  if (defaults !== undefined) Object.assign(copy, { defaultAttributeValues: defaults })
  const std = copy as THREE.MeshStandardMaterial
  // A self-lit surface (a light strip, `selfLit3d`) keeps its own light.
  if (std.emissive instanceof THREE.Color && !userData.selfLit) {
    std.emissive.copy(ink)
    std.emissiveIntensity = GLOW_EMISSIVE
    if (std.map && !std.emissiveMap) std.emissiveMap = std.map
  }
  return copy
}

/** What the last `update` drew for a pad, for the debug hook. */
interface PadDrawn {
  state: PadState
  drawn: 'model' | 'box' | 'ghost' | null
  pos: THREE.Vector3 | null
  /** The world height (three y) of the top of the floating item's model, when one was drawn. */
  top?: number | null
}

/** Per source model: its bounds in its own frame (before its own position, turn and scale). */
const localBoxes = new WeakMap<THREE.Object3D, THREE.Box3>()
const _corner = new THREE.Vector3()

/**
 * itemTopY — the world height of the top of `model` posed at `position`, turned by `rotation`,
 * at `scale` times its own scale (as `WeaponModelPool.add` poses it).
 */
export function itemTopY(model: THREE.Object3D, position: THREE.Vector3, rotation: THREE.Quaternion, scale: number): number {
  let box = localBoxes.get(model)
  if (!box) {
    model.updateMatrixWorld(true)
    box = new THREE.Box3().setFromObject(model).applyMatrix4(model.matrixWorld.clone().invert())
    localBoxes.set(model, box)
  }
  let top = -Infinity
  for (let k = 0; k < 8; k++) {
    _corner.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z)
    _corner.multiply(model.scale).multiplyScalar(scale).applyQuaternion(rotation)
    top = Math.max(top, _corner.y)
  }
  return position.y + top
}

/** A baked pad: its data, its nature, its foot (three axes), its kind (floor or wall rack). */
export interface PadSpot {
  index: number
  pad: ReplayWeaponPadReady
  family: PadFamily
  /** The kind of the map spawner the pad was crossed with; null for a film-only pad. */
  slot: string | null
  feet: THREE.Vector3
  /** Fallback wall rack (no crossing): only the weapon model is posed, at its height. */
  mounted: boolean
  /** A weapon rack: the weapon is held still on the front of the rack (feet), in this pose. */
  rack?: RackPose
  placed?: { rotation: THREE.Quaternion; scale: THREE.Vector3 }
  phase: number
  /** The floating item's turn per film frame (radians, `padSpinPerFrame`). */
  spin: number
  last?: PadDrawn
  /** A floating pad item, turned about its model center: its loaded model and that center offset. */
  item?: { model: THREE.Object3D; offset: THREE.Vector3 }
}

/**
 * padItemCenter — the center (three axes) the item of `spot` is drawn at at `frame`, the same
 * point `paintPads` adds its model to. The caller passes the item's `look`, its loaded `model`
 * (null when not solid or not loaded), the pad `offset` marker (null when it has none) and the
 * equipment `standing` correction (null when the item is not an equipment pad); `groundScale`
 * is the item's ground scale. `out` is written and returned. This is the single source the 3D
 * pickups layer and the pad navpoint markers (`padNavpointMarkers3d`) share, so the icon always
 * sits where the item is drawn, not at the pad's base.
 */
export function padItemCenter(
  spot: PadSpot,
  frame: number,
  look: BoxLook,
  model: THREE.Object3D | null,
  offset: PadOffset | null,
  groundScale: number | null,
  standing: { rotation: THREE.Quaternion; center: THREE.Vector3 } | null,
  out: THREE.Vector3,
): THREE.Vector3 {
  const q = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, frame * spot.spin + spot.phase)
  const base = out.copy(spot.feet)
  if (spot.placed) {
    // A placed weapon stands at its spawner; the icon anchors on the spawner.
    return base
  }
  if (spot.rack) {
    // A rack holds its weapon still at its mount marker, inside the open rack.
    return base.add(spot.rack.offset)
  }
  if (spot.mounted) {
    // A wall rack (no crossing): the weapon is posed at its height; the icon anchors at the feet.
    return base
  }
  base.setY(spot.feet.y + PAD_BOX_LIFT + BOX_HEIGHT / 2)
  if (look === 'solid' && model && offset) {
    const scale = groundScale ?? 1
    q.copy(padItemRotation(offset, q, new THREE.Quaternion()))
    base.add(new THREE.Vector3().copy(spot.item?.offset ?? centerOffset(model)).multiplyScalar(scale).applyQuaternion(q))
    return base
  }
  if (look === 'solid' && model) {
    if (spot.slot === 'equipment' && standing) {
      q.multiply(standing.rotation)
      base.add(new THREE.Vector3().copy(standing.center).applyQuaternion(q).negate())
    } else {
      base.add(new THREE.Vector3().copy(spot.item?.offset ?? centerOffset(model)).applyQuaternion(q))
    }
    return base
  }
  // Box (ghost or solid-without-model): centered on the float height.
  return base
}

/** One row of `window.__it3dPickups`: what a pad holds and what the view drew for it. */
export interface PickupDebugRow {
  pad: number
  /** The spawner kind from the map (`rack`, `power`, `powerup`, `equipment`), `film` for a film-only pad. */
  family: string
  weaponKey: string
  state: PadState | null
  visible: boolean
  drawn: PadDrawn['drawn']
  modelLoaded: boolean
  /** Where the item was drawn, Halo axes; the pad's spawner when nothing was drawn. */
  worldPos: [number, number, number]
}

/** A baked ground weapon: its data, its nature, its ground foot, its fixed heading. */
interface GroundSpot {
  item: ReplayGroundWeapon
  family: PadFamily
  feet: THREE.Vector3
  rot: THREE.Quaternion
  yaw: number
  model?: THREE.Object3D
  pose?: ReturnType<typeof groundWeaponPose>
}

function feetOf(ground: Ground, x: number, y: number, z: number | undefined): THREE.Vector3 | null {
  const floor = floorUnder(ground, x, y, z)
  return floor === null ? null : new THREE.Vector3(...toThree(x, y, floor))
}

function padSpotsOf(ctx: ActionContext, pads: readonly ReplayWeaponPadReady[]): PadSpot[] {
  const out: PadSpot[] = []
  const slots = crossedSlotsOf(ctx.doc.mapWeaponPads)
  const spin = padSpinPerFrame(frameToMs(1, ctx.doc))
  pads.forEach((pad, i) => {
    if (padOutOfBounds(ctx.doc.bounds, pad.x, pad.y)) return
    const family = pickupFamilyOf(pad.weapon, ctx.doc.weaponLabels)
    const phase = i * PAD_SPIN_PHASE
    const slot = slots.get(i)
    if (slot?.family === 'placed') {
      const forward = threeAxis(slot.forward)
      const up = threeAxis(slot.up)
      if (!forward || !up || new THREE.Vector3().crossVectors(forward, up).lengthSq() < 1e-8) return
    }
    if (slot && (pad.z !== undefined || slot.family === 'placed')) {
      // A crossed pad stands at its spawner, to the centimeter: a floor pad kit's origin is its
      // base, a rack's is the middle of its frame. No floor ray: the ground is read once, at
      // construction, before a Forge map's variant layer (its floors and the pad kits) arrives,
      // and a ray from above the spawner could land on whatever is overhead.
      const feet = new THREE.Vector3(...toThree(pad.x, pad.y, pad.z ?? 0))
      const rack = slot.family === 'rack' ? { rotation: rackWeaponRotation(slot), offset: rackWeaponOffset(slot) } : undefined
      const placed = slot.family === 'placed' && threeAxis(slot.forward) && threeAxis(slot.up)
        ? { rotation: placedWeaponRotation(slot), scale: slot.scale?.length === 3
          ? new THREE.Vector3(slot.scale[0], slot.scale[2], slot.scale[1]) : new THREE.Vector3(1, 1, 1) }
        : undefined
      out.push({ index: i, pad, family, slot: slot.family, feet, mounted: rack !== undefined, rack, placed, phase, spin })
      return
    }
    const floor = ctx.ground.floorY(pad.x, pad.y, pad.z ?? null)
    const mounted = padMountOf(pad.z, floor) === 'mounted'
    // A rack holds at the published z (the pad's box is absent); a floor pad settles onto the floor.
    const feet = mounted ? new THREE.Vector3(...toThree(pad.x, pad.y, pad.z!)) : feetOf(ctx.ground, pad.x, pad.y, pad.z)
    if (feet) out.push({ index: i, pad, family, slot: slot?.family ?? null, feet, mounted, phase, spin })
  })
  return out
}

function groundSpotsOf(ctx: ActionContext, items: readonly ReplayGroundWeapon[]): Map<ReplayGroundWeapon, GroundSpot> {
  const out = new Map<ReplayGroundWeapon, GroundSpot>()
  items.forEach((item, i) => {
    const feet = feetOf(ctx.ground, item.x, item.y, item.z)
    if (!feet) return
    const yaw = i * GROUND_YAW_STEP
    const rot = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw)
    out.set(item, { item, family: pickupFamilyOf(item.w, ctx.doc.weaponLabels), feet, rot, yaw })
  })
  return out
}

function capacity(n: number): number {
  return Math.max(1, Math.min(POOL_CAP, n))
}

/** The layer of pads and ground weapons. */
export class Pickups3dLayer implements ActionLayer3d {
  private readonly ctx: ActionContext
  private readonly pads: PadSpot[]
  private readonly groundSpots: Map<ReplayGroundWeapon, GroundSpot>
  private readonly solidBoxes: InstancePool
  private readonly ghostBoxes: InstancePool
  /** The game's models, full only: uncertain stays a ghost box. */
  private readonly models: WeaponModelPool
  private readonly scratch = { p: new THREE.Vector3(), q: new THREE.Quaternion(), o: new THREE.Vector3(), c: new THREE.Vector3() }
  /** Per source model: the standing correction of an equipment item (its thinnest axis horizontal). */
  private readonly standings = new Map<THREE.Object3D, { rotation: THREE.Quaternion; center: THREE.Vector3 }>()
  /** Per source model: the glow copy (its materials cloned and emissive); drawn for floating pad items. */
  private readonly glows = new Map<THREE.Object3D, THREE.Object3D>()
  /** Per source model: the outlined copy a rack's weapon is drawn with (`outlinedOf`). */
  private readonly outlined = new Map<THREE.Object3D, THREE.Object3D>()
  /** The glow materials, disposed with the layer (shared by a glow copy's pool clones). */
  private readonly glowMaterials: THREE.Material[] = []
  private filterKey = ''
  private shownGround: GroundSpot[] = []
  /** The model keys this layer has already asked to paint (one request per model key, armory-side and layer-side). */
  private readonly paintRequested = new Set<string>()
  /** The painted map-item model per source model (its default-style coat, `armory.objectCoat`); null while the coat is pending. */
  private readonly painted = new Map<THREE.Object3D, THREE.Object3D | null>()
  /** The painted copies (owned by this layer, with their painted materials). */
  private readonly paintedModels: THREE.Object3D[] = []
  /** The painted materials, disposed with the layer (a painted model's and its glow copy's clones share them). */
  private readonly paintedMaterials: THREE.Material[] = []

  /** The baked pads (their data, feet, kind) the layer draws; `spot.last` holds what the last `update` drew. */
  get spots(): readonly PadSpot[] { return this.pads }

  constructor(ctx: ActionContext) {
    this.ctx = ctx
    this.pads = padSpotsOf(ctx, prepareWeaponPads(ctx.doc))
    this.groundSpots = groundSpotsOf(ctx, ctx.doc.groundWeapons)
    const boxes = capacity(this.pads.length + this.groundSpots.size)
    this.solidBoxes = new InstancePool(ctx.root, boxGeometry(), new THREE.MeshLambertMaterial(), boxes)
    this.ghostBoxes = new InstancePool(
      ctx.root,
      boxGeometry(),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: GHOST_OPACITY, depthWrite: false }),
      boxes,
    )
    this.models = new WeaponModelPool(ctx.root)
    installDebugHook(this)
  }

  /**
   * paintedObject — the painted form of a loaded map-item `model` (its default-style coat, one per
   * model key, `armory.objectCoat`); the bare model while the coat is pending. A map item is
   * painted before its glow copy, so the glow keeps the paint's shader hooks. An equipment item
   * (a pad's `shroud_screen`) paints by its pickup object's key; a scene with no weapon library
   * stays bare.
   */
  private paintedObject(id: string, model: THREE.Object3D): THREE.Object3D {
    const armory = this.ctx.armory?.()
    const key = this.modelKeyOf(id)
    const coat = armory && key ? armory.objectCoat(key, model) : null
    if (!coat) return model
    const cache = this.painted.get(model)
    if (cache) return cache
    const copy = model.clone()
    for (const m of applyWeaponCoating(copy, coat).values()) this.paintedMaterials.push(m)
    this.paintedModels.push(copy)
    this.painted.set(model, copy)
    return copy
  }

  /**
   * noShadow — a weapon pad and rack item casts no shadow (`castShadow = false` on every mesh,
   * the glow copy included): a camera-following light casts its dark copy on the floor behind the
   * item, and the floating weapon reads as lying on the ground. The painted copy is shared per
   * source model, so the flag is set once per copy; `receiveShadow` stays.
   */
  private noShadow(item: THREE.Object3D): THREE.Object3D {
    item.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = false
    })
    return item
  }

  /** modelKeyOf — the library key of a pad or ground item: a weapon's family, an equipment family's pickup object. */
  private modelKeyOf(id: string): string | null {
    return this.ctx.weaponModelKeyOf ? this.ctx.weaponModelKeyOf(id) : weaponModelKey(id)
  }

  update(frame: number): void {
    const { show, inks } = this.ctx.inputs()
    // Loaded map objects get painted in the background with their default style (once per model
    // key); the frame shows them bare while the paint is not ready.
    for (const spot of this.pads) this.prepareObject(spot.pad.weapon)
    for (const spot of this.groundSpots.values()) this.prepareObject(spot.item.w)
    this.solidBoxes.begin()
    this.ghostBoxes.begin()
    this.models.begin()
    if (show.weaponPads) this.paintPads(frame, inks.pad)
    else for (const spot of this.pads) spot.last = undefined
    if (show.groundWeapons) this.paintGround(frame, inks.pad, show.groundWeaponsSpecialOnly, show.groundWeaponsStarting)
    this.solidBoxes.end()
    this.ghostBoxes.end()
  }

  /**
   * prepareObject requests the default-style paint of object `id` in the background once its
   * model is loaded: the armory caches the paint by model key (ten pads of the same weapon paint
   * once). An object with no model key (yet) or a scene with no weapon library: nothing.
   */
  private prepareObject(id: string): void {
    const armory = this.ctx.armory?.()
    const key = this.modelKeyOf(id)
    if (!armory || !key) return
    if (this.paintRequested.has(key)) return
    const model = this.ctx.weaponModel(id)
    if (!model) return
    this.paintRequested.add(key)
    void armory.paintObject(key, model)
  }

  private paintPads(frame: number, ink: Readonly<Record<PadFamily, string>>): void {
    const { p, q } = this.scratch
    for (const spot of this.pads) {
      const state = padStateAt(spot.pad, frame)
      const last: PadDrawn = { state, drawn: null, pos: null }
      spot.last = last
      if (spot.placed) {
        if (padBoxLook(state) !== 'solid') continue
        const source = this.ctx.weaponModel(spot.pad.weapon)
        if (!source) continue
        const groundScale = this.ctx.weaponGroundScale?.(spot.pad.weapon)
        if (groundScale == null) continue
        const model = this.noShadow(this.paintedObject(spot.pad.weapon, source))
        const scale = spot.placed.scale.clone().multiplyScalar(groundScale)
        this.models.add(model, p.copy(spot.feet), spot.placed.rotation, scale)
        Object.assign(last, { drawn: 'model', pos: p.clone() })
        continue
      }
      if (spot.rack) {
        this.paintRack(spot, spot.rack, state, ink, last)
        continue
      }
      if (spot.mounted) {
        // A wall rack: only the game's weapon model is posed, at its height; the glow marks it
        // as a floating item (a rack's own weapon is drawn bare and still, in `paintRack`).
        const source = this.ctx.weaponModel(spot.pad.weapon)
        if (!source) continue
        const model = this.noShadow(this.paintedObject(spot.pad.weapon, source))
        q.setFromAxisAngle(Y_AXIS, frame * spot.spin + spot.phase)
        this.models.add(this.glowOf(model, this.ctx.ink.of(ink[spot.family])), p.copy(spot.feet), q)
        Object.assign(last, { drawn: 'model', pos: p.clone() })
        continue
      }
      const look = padBoxLook(state)
      if (!look) continue
      // The item's center is shared with the navpoint markers (`padItemCenter`): the same spin,
      // the same hold, the same ground scale, so the icon always sits where the item is drawn.
      const source = look === 'solid' ? this.ctx.weaponModel(spot.pad.weapon) : null
      let model: THREE.Object3D | null = null
      if (source) model = this.noShadow(this.paintedObject(spot.pad.weapon, source))
      const offset = model ? this.ctx.weaponPadOffset?.(spot.pad.weapon) ?? null : null
      const groundScale = this.ctx.weaponGroundScale?.(spot.pad.weapon) ?? null
      const standing = look === 'solid' && model && spot.slot === 'equipment' ? this.standingOf(model) : null
      padItemCenter(spot, frame, look, model, offset, groundScale, standing, p)
      let top: number | null = null
      if (model && offset) {
        // The game's own hold: the item turned so its `weapon_pad_offset` marker is upright on the
        // pad, weapons and equipment alike, and turning about up through the center of its
        // bounds (the Grapple's marker sits at its back end; the game spins it about its middle).
        // At the item's ground scale (weapons 1.3, the Grapple 2.75), as the game draws it.
        q.setFromAxisAngle(Y_AXIS, frame * spot.spin + spot.phase)
        q.copy(padItemRotation(offset, q, q))
        if (spot.item?.model !== model) spot.item = { model, offset: centerOffset(model) }
        this.models.add(this.glowOf(model, this.ctx.ink.of(ink[spot.family])), p, q, groundScale ?? 1)
        top = itemTopY(model, p, q, groundScale ?? 1)
      } else if (model) {
        q.setFromAxisAngle(Y_AXIS, frame * spot.spin + spot.phase)
        if (spot.slot === 'equipment' && standing) {
          // An equipment GLB is not authored with the weapon's up: stand the item on its thinnest
          // bounding-box edge (a disc stands on its edge) BEFORE the spin about world up, and
          // center it on the float height.
          q.multiply(standing.rotation)
        }
        // Every floating item turns about its model center, over the pad's center: a weapon
        // turned about its grip swept its barrel past the pad's rim (the S7 on Fortress reached
        // 0.4 u off the kit), and from above read as lying on the floor beside the pad.
        if (spot.slot !== 'equipment') {
          if (spot.item?.model !== model) spot.item = { model, offset: centerOffset(model) }
        }
        this.models.add(this.glowOf(model, this.ctx.ink.of(ink[spot.family])), p, q)
        top = itemTopY(model, p, q, 1)
      } else {
        q.setFromAxisAngle(Y_AXIS, frame * spot.spin + spot.phase)
        this.poolOf(look).add(p, q, 1, this.ctx.ink.of(ink[spot.family]))
      }
      Object.assign(last, { drawn: model ? 'model' : look === 'solid' ? 'box' : 'ghost', pos: p.clone(), top })
    }
  }

  /** standingOf — the standing correction of an equipment model, measured once per source model. */
  private standingOf(model: THREE.Object3D): { rotation: THREE.Quaternion; center: THREE.Vector3 } {
    let s = this.standings.get(model)
    if (!s) {
      s = standingItemCorrection(model)
      this.standings.set(model, s)
    }
    return s
  }

  /**
   * glowOf — the glow copy of `model`: its materials cloned and self-lit in the family ink, so a
   * floating pad item reads at a distance. The source model keeps its own materials: a power-up
   * pad sharing the model (and a rack weapon) is drawn bare.
   */
  private glowOf(model: THREE.Object3D, ink: THREE.Color): THREE.Object3D {
    let glow = this.glows.get(model)
    if (!glow) {
      glow = model.clone()
      const tint = (m: THREE.Material) => {
        const c = glowMaterialOf(m, ink)
        this.glowMaterials.push(c)
        return c
      }
      glow.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        o.castShadow = false
        o.material = Array.isArray(o.material) ? o.material.map(tint) : tint(o.material)
      })
      // The game's pickup outline around the floating item (`itemOutline3d`).
      addPickupOutline(glow)
      this.glows.set(model, glow)
    }
    return glow
  }

  /**
   * outlinedOf — `model` with the pickup outline (`itemOutline3d`) and no glow: a rack's weapon is
   * drawn in its own paint, outlined like every pickup (Jordan's Vacancy capture, 2026-11-22). The
   * copy shares the painted model's materials.
   */
  private outlinedOf(model: THREE.Object3D): THREE.Object3D {
    let copy = this.outlined.get(model)
    if (!copy) {
      copy = model.clone()
      addPickupOutline(copy)
      this.outlined.set(model, copy)
    }
    return copy
  }

  /**
   * A weapon rack: the weapon held still at the rack's mount marker (`rackWeaponOffset`,
   * `rackWeaponRotation`), inside the open rack, while the pad's state holds it; no lift, no spin.
   * At the weapon's ground scale, like a pad's weapon: in the capture the VK78 spans about 0.37 u
   * of the 0.46 u rack, its length at 1.3. The rack's doors are the variant layer's (baked shut
   * until their clips are exported); the weapon inside is hidden behind shut doors.
   */
  private paintRack(
    spot: PadSpot,
    rack: RackPose,
    state: PadState,
    ink: Readonly<Record<PadFamily, string>>,
    last: PadDrawn,
  ): void {
    const look = padBoxLook(state)
    if (!look) return
    const { p } = this.scratch
    p.copy(spot.feet).add(rack.offset)
    const source = look === 'solid' ? this.ctx.weaponModel(spot.pad.weapon) : null
    const model = source ? this.noShadow(this.paintedObject(spot.pad.weapon, source)) : null
    if (model) {
      const scale = this.ctx.weaponGroundScale?.(spot.pad.weapon) ?? 1
      this.models.add(this.outlinedOf(model), p, rack.rotation, scale)
      Object.assign(last, { drawn: 'model', pos: p.clone() })
      return
    }
    // The stand-in box (its length along the muzzle), at the same mount.
    this.poolOf(look).add(p, rack.rotation, 1, this.ctx.ink.of(ink[spot.family]))
    Object.assign(last, { drawn: look === 'solid' ? 'box' : 'ghost', pos: p.clone() })
  }

  /** debugRows — what each pad holds and what the last `update` drew (`window.__it3dPickups`). */
  debugRows(): PickupDebugRow[] {
    return this.pads.map((spot) => {
      const at = spot.last?.pos ?? spot.feet
      return {
        pad: spot.index,
        family: spot.slot ?? 'film',
        weaponKey: weaponModelKey(spot.pad.weapon) ?? spot.pad.weapon,
        state: spot.last?.state ?? null,
        visible: !!spot.last?.drawn,
        drawn: spot.last?.drawn ?? null,
        modelLoaded: this.ctx.weaponModel(spot.pad.weapon) !== null,
        // three (x, y up, z) back to Halo (x, y, z up).
        worldPos: [at.x, -at.z, at.y],
      }
    })
  }

  private paintGround(
    frame: number,
    ink: Readonly<Record<PadFamily, string>>,
    specialOnly: boolean,
    includeStarting: boolean,
  ): void {
    const { p } = this.scratch
    for (const spot of this.groundFor(specialOnly, includeStarting)) {
      const look = groundBoxLook(spot.item, frame)
      if (!look) continue
      // A ground weapon keeps its model to the end, undated vanishing included: the box is only
      // the fallback for an absent model.
      const source = this.ctx.weaponModel(spot.item.w)
      const model = source ? this.paintedObject(spot.item.w, source) : null
      if (model) {
        if (spot.model !== model || !spot.pose) {
          spot.model = model
          spot.pose = groundWeaponPose(model, spot.yaw)
        }
        this.models.add(model, p.copy(spot.feet).setY(spot.feet.y + spot.pose.lift), spot.pose.rotation)
        continue
      }
      p.copy(spot.feet).setY(spot.feet.y + BOX_HEIGHT / 2)
      this.poolOf(look).add(p, spot.rot, 1, this.ctx.ink.of(ink[spot.family]))
    }
  }

  /** The ground weapons kept by the filters: recomputed only when a filter changes. */
  private groundFor(specialOnly: boolean, includeStarting: boolean): readonly GroundSpot[] {
    const key = `${specialOnly}|${includeStarting}`
    if (key !== this.filterKey) {
      this.filterKey = key
      this.shownGround = shownGroundWeapons(this.ctx.doc, specialOnly, includeStarting).flatMap((item) => {
        const spot = this.groundSpots.get(item)
        return spot ? [spot] : []
      })
    }
    return this.shownGround
  }

  private poolOf(look: 'solid' | 'ghost'): InstancePool {
    return look === 'solid' ? this.solidBoxes : this.ghostBoxes
  }

  dispose(): void {
    removeDebugHook(this)
    this.solidBoxes.dispose()
    this.ghostBoxes.dispose()
    this.models.dispose()
    for (const m of this.glowMaterials) m.dispose()
    this.glowMaterials.length = 0
    // The painted models (and their placed copies) are ours; the painted materials too (the pool
    // copies' clones share those of the painted copy).
    for (const painted of this.paintedModels) this.ctx.root.remove(painted)
    this.paintedModels.length = 0
    for (const m of this.paintedMaterials) m.dispose()
    this.paintedMaterials.length = 0
    this.painted.clear()
  }
}

/** The window property of the read-only debug hook, and the layer that currently answers it. */
const DEBUG_HOOK = '__it3dPickups'
let debugOwner: Pickups3dLayer | null = null

/**
 * installDebugHook — `window.__it3dPickups` reads, on each access, the rows of the latest layer
 * (`debugRows`): read-only, a getter with no setter, gone when the layer is disposed.
 */
function installDebugHook(layer: Pickups3dLayer): void {
  if (typeof window === 'undefined') return
  debugOwner = layer
  Object.defineProperty(window, DEBUG_HOOK, {
    configurable: true,
    enumerable: false,
    get: () => debugOwner?.debugRows() ?? [],
  })
}

function removeDebugHook(layer: Pickups3dLayer): void {
  if (typeof window === 'undefined' || debugOwner !== layer) return
  debugOwner = null
  delete (window as unknown as Record<string, unknown>)[DEBUG_HOOK]
}

/** A fresh weapon box: each pool gets its own geometry. */
function boxGeometry(): THREE.BoxGeometry {
  return new THREE.BoxGeometry(BOX_LENGTH, BOX_HEIGHT, BOX_WIDTH)
}
