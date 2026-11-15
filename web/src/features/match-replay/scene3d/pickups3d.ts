/**
 * pickups3d.ts — LES SOCLES D'ARME ET LES ARMES AU SOL DANS LA SCÈNE 3D.
 *
 * Aucune règle n'est réécrite ici : la présence, l'état d'un socle, le filtre des armes au sol et
 * la nature d'une arme sont ceux de la vue 2D, appelés tels quels.
 *  - The pad itself (floor pad, wall rack) is the game's own model, drawn by the variant object
 *    layer (`variantLayer.ts`); this layer draws only the weapon it holds. Full, a weapon box in its
 *    family ink (`padFamilyOf`) floats above the pad and turns slowly; uncertain, the box is a ghost;
 *    empty, nothing is drawn (`padStateAt`). A WEAPON RACK (the map spawner the server crossed the
 *    pad with is a `rack`, `rackMountsOf`) holds its weapon still, on the front of its shut doors,
 *    in the rack's own orientation (`rackWeaponRotation`): no lift, no spin, same full / uncertain /
 *    empty states. Every crossed pad stands at its spawner's position, never at a floor ray read at
 *    construction. Without that crossing, a pad above the floor (`padMountOf`) keeps the earlier
 *    fallback: only the game's weapon model is posed, at its height. `window.__it3dPickups` reads
 *    what each pad drew (`debugRows`). Un socle hors des bornes de la carte
 *    (`padOutOfBounds`) n'est pas dessiné du tout. Les socles sont préparés comme en 2D : croisés
 *    avec les emplacements de la carte, datés par les ramassages natifs, puis leur incertitude
 *    ramenée à ce qu'un joueur a pu faire (`useReplayWeaponPads`).
 *  - Le MODÈLE DU JEU de l'arme (`weaponModels3d`) remplace la boîte pleine dès qu'il est chargé.
 *    A power-up pad names its item by equipment family (`powerup_camo`); the library resolves the
 *    family to the pickup object's own model (`equipmentKeys3d`), drawn the same way. An
 *    EQUIPMENT pad (`repulsor`, `wall`, `grapple`, `sensor`, `thruster`..., crossed as `equipment`)
 *    is the same: its item floats and turns above the pad while it is there and is gone once
 *    taken. Every floating pad item, weapon or not, turns about the center of its model, over the
 *    pad's center (`centerOffset`).
 *  - Une ARME AU SOL est la même boîte, couchée au sol, à l'encre de sa nature ; dans sa fenêtre de
 *    disparition non datée (`vanishing`), elle passe au lot fantôme (`groundWeaponPresenceAt`). Les
 *    filtres du tiroir (armes spéciales seulement, armes de départ) sont ceux de
 *    `useReplayGroundWeapons`.
 *
 * La rotation se déduit de l'image, jamais de l'horloge : l'écran et l'export rendent la même pose.
 * Unités monde Halo (cf. `tracks3d`).
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
import { toThree } from './tracks3d'
import { WeaponModelPool, weaponModelKey } from './weaponModels3d'
import { centerOffset, faceMountOffset, groundWeaponPose, standingItemCorrection } from './groundWeaponPose3d'

/** La boîte d'arme : longueur, hauteur, largeur (u). */
const BOX_LENGTH = 0.5
const BOX_HEIGHT = 0.08
const BOX_WIDTH = 0.12
/** Gap between a floor pad's feet and the underside of the weapon floating above it (u). */
const PAD_BOX_LIFT = 0.28
/** Vitesse de rotation de la boîte d'un socle plein (radians par image). */
const PAD_SPIN_PER_FRAME = 0.02
/** Déphasage d'un socle à l'autre, pour que les boîtes ne tournent pas en bloc (radians). */
const PAD_SPIN_PHASE = 0.7
/** Orientation d'une arme couchée : l'angle d'or, qui disperse les caps sans motif visible. */
const GROUND_YAW_STEP = Math.PI * (3 - Math.sqrt(5))
/**
 * Un z publié se recale sur le sol qu'il surplombe de moins que ceci (u) : l'origine d'un objet
 * flotte de quelques centimètres. Au-delà (un râtelier mural), le z publié fait foi.
 */
const FLOOR_SNAP = 0.3
/**
 * A pad more than this above the floor under it is a wall rack, not a floor pad: only the game's
 * weapon model is posed on it, at its height (u).
 */
const PAD_MOUNT_THRESHOLD = 0.25
/**
 * How far in front of a rack's spawner its weapon hangs, along the rack's forward (u): the front of
 * the rack kit's shut doors (+0.068 u, measured on the kit mesh of Live Fire's variant layer; the
 * kit's box is the same 0.25 x 0.17 x 0.46 u on every measured map) plus a small gap.
 */
const RACK_FACE = 0.073
/** Un socle au-delà de cette marge hors des bornes de la carte n'est pas dessiné (u). */
const PAD_OUT_OF_BOUNDS_MARGIN = 5
/** Plafond des lots : quelques centaines d'objets au plus. */
const POOL_CAP = 400
/** Opacité du lot fantôme (incertain, en disparition). */
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

/** Les champs du document dont la préparation des socles a besoin. */
export type PadSources = Pick<ReplayDocumentReady, 'weaponPads' | 'mapWeaponPads' | 'padPickups' | 'tracks'>

/** Le catalogue d'armes du document, tel qu'il arrive. */
type Labels = ReplayDocumentReady['weaponLabels']

/** Les champs du document dont le filtre des armes au sol a besoin. */
export interface GroundSources {
  groundWeapons: readonly ReplayGroundWeapon[]
  weaponLabels?: Labels
  loadouts: ReplayDocumentReady['loadouts']
}

/**
 * prepareWeaponPads — les socles tels que la 2D les dessine : position croisée avec la carte, puis
 * datation par le ramassage natif, puis raffinement de l'incertitude. L'ordre est celui de
 * `useReplayWeaponPads`. Une passe par document.
 */
export function prepareWeaponPads(doc: PadSources): readonly ReplayWeaponPadReady[] {
  return refinePadPresence(
    applyPadPickupDating(crossedWeaponPads(doc.weaponPads, doc.mapWeaponPads), doc.padPickups),
    doc.tracks,
  )
}

/**
 * pickupFamilyOf — la nature d'une arme, socle ou sol. La clé canonique se lit sous la forme
 * normalisée de l'identifiant (`weaponLabelKeyOf`), idempotente sur celle des socles.
 */
export function pickupFamilyOf(weapon: string, labels: Labels): PadFamily {
  return padFamilyOf(weapon, labels?.[weaponLabelKeyOf(weapon)]?.key)
}

/**
 * shownGroundWeapons — les armes au sol que les filtres du tiroir gardent, dans l'ordre de
 * `useReplayGroundWeapons` : armes spéciales d'abord, armes de départ ensuite.
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

/** Le rendu d'une boîte d'arme à une image : pleine, fantôme, ou absente. */
export type BoxLook = 'solid' | 'ghost' | null

/** padBoxLook — plein : boîte pleine ; incertain : boîte fantôme ; vide : pas de boîte. */
export function padBoxLook(state: PadState): BoxLook {
  if (state === 'full') return 'solid'
  return state === 'uncertain' ? 'ghost' : null
}

/** groundBoxLook — présente : pleine ; en disparition non datée : fantôme ; sinon rien. */
export function groundBoxLook(item: ReplayGroundWeapon, frame: number): BoxLook {
  const presence = groundWeaponPresenceAt(item, frame)
  if (!presence) return null
  return presence.vanishing ? 'ghost' : 'solid'
}

/**
 * floorUnder — la hauteur three du sol sous un objet. Sans z publié, le premier sol sous le
 * plafond ; avec, le sol sous lui s'il en est assez proche, sinon le z publié lui-même.
 */
export function floorUnder(ground: Pick<Ground, 'floorY'>, x: number, y: number, z: number | undefined): number | null {
  if (z === undefined) return ground.floorY(x, y, null)
  const f = ground.floorY(x, y, z)
  return f !== null && z - f <= FLOOR_SNAP ? f : z
}

/**
 * padMountOf — un socle est MURAL quand il surplombe le sol sous lui de plus que
 * PAD_MOUNT_THRESHOLD ; sinon il est AU SOL. Sans z publié ni sol connu, il est au sol : un inconnu
 * n'invente pas un râtelier (le sol se lit dans le maillage de la carte, pas dans le document).
 */
export function padMountOf(z: number | undefined, floor: number | null): 'floor' | 'mounted' {
  if (z === undefined || floor === null) return 'floor'
  return z - floor > PAD_MOUNT_THRESHOLD ? 'mounted' : 'floor'
}

/**
 * padOutOfBounds — un socle est hors jeu, donc non dessiné, s'il dépasse les bornes de la carte de
 * PAD_OUT_OF_BOUNDS_MARGIN en x ou en y. Sans bornes, rien n'est hors jeu.
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
}

/**
 * crossedSlotsOf — per match pad index, the map spawner that confirmed it. The first citation of a
 * pad wins, as in `crossedWeaponPads`. Without crossing (map off-catalog, an earlier answer) the map
 * is empty and every pad keeps its earlier drawing.
 */
export function crossedSlotsOf(cross: ReplayDocumentReady['mapWeaponPads']): Map<number, CrossedSlot> {
  const out = new Map<number, CrossedSlot>()
  for (const spot of cross?.pads ?? []) {
    if (!out.has(spot.pad)) out.set(spot.pad, { family: spot.family, forward: spot.forward, up: spot.up })
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

/**
 * rackWeaponRotation — the still pose of a weapon on a rack. The weapon model's frame is three's
 * (X toward the muzzle, Y up); on the rack it stands upright, muzzle along the rack's up, its side
 * facing out along the rack's forward, so it fills the rack's tall, narrow frame (the kit's box is
 * 0.46 u tall, 0.25 u wide, 0.17 u deep on every measured map). Without published axes the rack is
 * upright and faces +X.
 */
export function rackWeaponRotation(mount: RackMount): THREE.Quaternion {
  const up = threeAxis(mount.up) ?? new THREE.Vector3(0, 1, 0)
  let forward = threeAxis(mount.forward)
  if (forward) forward.addScaledVector(up, -forward.dot(up))
  if (!forward || forward.lengthSq() < 1e-8) {
    forward = new THREE.Vector3(1, 0, 0).addScaledVector(up, -up.x)
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1).addScaledVector(up, -up.z)
  }
  forward.normalize()
  // Model X (muzzle) -> rack up, model Z (side) -> rack forward, model Y -> forward x up.
  const top = new THREE.Vector3().crossVectors(forward, up)
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(up, top, forward))
}

/** The still pose of a rack weapon: its rotation, and the face-mount offset of its loaded model. */
interface RackPose {
  rotation: THREE.Quaternion
  model?: THREE.Object3D
  offset?: THREE.Vector3
}

/**
 * glowMaterialOf — the glow copy of a pad item's material: the same material (color, color map,
 * normal map, its compile hooks and its `userData` by reference, as `lighting.copyPerProbe` does:
 * `clone` copies `userData` through JSON, which turns the coating masks' textures into plain
 * objects, and drops `onBeforeCompile`), plus a faint emissive in `ink`. A textured material glows
 * through its own color map, so the tint follows the texture instead of washing over it.
 */
export function glowMaterialOf(source: THREE.Material, ink: THREE.Color): THREE.Material {
  const { userData } = source
  source.userData = {}
  const copy = source.clone()
  source.userData = userData
  copy.userData = userData
  copy.onBeforeCompile = source.onBeforeCompile
  copy.customProgramCacheKey = source.customProgramCacheKey
  const std = copy as THREE.MeshStandardMaterial
  if (std.emissive instanceof THREE.Color) {
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
}

/** Un socle cuit : sa donnée, sa nature, son pied (axes three), son type (sol ou râtelier mural). */
interface PadSpot {
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
  phase: number
  last?: PadDrawn
  /** A floating pad item, turned about its model center: its loaded model and that center offset. */
  item?: { model: THREE.Object3D; offset: THREE.Vector3 }
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

/** Une arme au sol cuite : sa donnée, sa nature, son pied au sol, son cap fixe. */
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
  pads.forEach((pad, i) => {
    if (padOutOfBounds(ctx.doc.bounds, pad.x, pad.y)) return
    const family = pickupFamilyOf(pad.weapon, ctx.doc.weaponLabels)
    const phase = i * PAD_SPIN_PHASE
    const slot = slots.get(i)
    if (slot && pad.z !== undefined) {
      // A crossed pad stands at its spawner, to the centimeter: a floor pad kit's origin is its
      // base, a rack's is the middle of its frame. No floor ray: the ground is read once, at
      // construction, before a Forge map's variant layer (its floors and the pad kits) arrives,
      // and a ray from above the spawner could land on whatever is overhead.
      const feet = new THREE.Vector3(...toThree(pad.x, pad.y, pad.z))
      const rack = slot.family === 'rack' ? { rotation: rackWeaponRotation(slot) } : undefined
      out.push({ index: i, pad, family, slot: slot.family, feet, mounted: rack !== undefined, rack, phase })
      return
    }
    const floor = ctx.ground.floorY(pad.x, pad.y, pad.z ?? null)
    const mounted = padMountOf(pad.z, floor) === 'mounted'
    // Un râtelier tient au z publié (la boîte du socle est absente) ; un socle au sol se cale sur le sol.
    const feet = mounted ? new THREE.Vector3(...toThree(pad.x, pad.y, pad.z!)) : feetOf(ctx.ground, pad.x, pad.y, pad.z)
    if (feet) out.push({ index: i, pad, family, slot: slot?.family ?? null, feet, mounted, phase })
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

/** Le calque des socles et des armes au sol. */
export class Pickups3dLayer implements ActionLayer3d {
  private readonly ctx: ActionContext
  private readonly pads: PadSpot[]
  private readonly groundSpots: Map<ReplayGroundWeapon, GroundSpot>
  private readonly solidBoxes: InstancePool
  private readonly ghostBoxes: InstancePool
  /** Les modèles du jeu, pleins seulement : un incertain reste une boîte fantôme. */
  private readonly models: WeaponModelPool
  private readonly scratch = { p: new THREE.Vector3(), q: new THREE.Quaternion(), o: new THREE.Vector3(), c: new THREE.Vector3() }
  /** Per source model: the standing correction of an equipment item (its thinnest axis horizontal). */
  private readonly standings = new Map<THREE.Object3D, { rotation: THREE.Quaternion; center: THREE.Vector3 }>()
  /** Per source model: the glow copy (its materials cloned and emissive); drawn for floating pad items. */
  private readonly glows = new Map<THREE.Object3D, THREE.Object3D>()
  /** The glow materials, disposed with the layer (shared by a glow copy's pool clones). */
  private readonly glowMaterials: THREE.Material[] = []
  private filterKey = ''
  private shownGround: GroundSpot[] = []

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

  update(frame: number): void {
    const { show, inks } = this.ctx.inputs()
    this.solidBoxes.begin()
    this.ghostBoxes.begin()
    this.models.begin()
    if (show.weaponPads) this.paintPads(frame, inks.pad)
    else for (const spot of this.pads) spot.last = undefined
    if (show.groundWeapons) this.paintGround(frame, inks.pad, show.groundWeaponsSpecialOnly, show.groundWeaponsStarting)
    this.solidBoxes.end()
    this.ghostBoxes.end()
  }

  private paintPads(frame: number, ink: Readonly<Record<PadFamily, string>>): void {
    const { p, q, c } = this.scratch
    for (const spot of this.pads) {
      const state = padStateAt(spot.pad, frame)
      const last: PadDrawn = { state, drawn: null, pos: null }
      spot.last = last
      if (spot.rack) {
        this.paintRack(spot, spot.rack, state, ink, last)
        continue
      }
      if (spot.mounted) {
        // A wall rack: only the game's weapon model is posed, at its height; the glow marks it
        // as a floating item (a rack's own weapon is drawn bare and still, in `paintRack`).
        const model = this.ctx.weaponModel(spot.pad.weapon)
        if (!model) continue
        q.setFromAxisAngle(Y_AXIS, frame * PAD_SPIN_PER_FRAME + spot.phase)
        this.models.add(this.glowOf(model, this.ctx.ink.of(ink[spot.family])), p.copy(spot.feet), q)
        Object.assign(last, { drawn: 'model', pos: p.clone() })
        continue
      }
      const look = padBoxLook(state)
      if (!look) continue
      p.copy(spot.feet).setY(spot.feet.y + PAD_BOX_LIFT + BOX_HEIGHT / 2)
      q.setFromAxisAngle(Y_AXIS, frame * PAD_SPIN_PER_FRAME + spot.phase)
      const model = look === 'solid' ? this.ctx.weaponModel(spot.pad.weapon) : null
      if (model) {
        if (spot.slot === 'equipment') {
          // An equipment GLB is not authored with the weapon's up: stand the item on its thinnest
          // bounding-box edge (a disc stands on its edge) BEFORE the spin about world up, and
          // center it on the float height.
          const standing = this.standingOf(model)
          q.multiply(standing.rotation)
          p.sub(c.copy(standing.center).applyQuaternion(q))
        } else {
          // Every floating item turns about its model center, over the pad's center: a weapon
          // turned about its grip swept its barrel past the pad's rim (the S7 on Fortress reached
          // 0.4 u off the kit), and from above read as lying on the floor beside the pad.
          if (spot.item?.model !== model) spot.item = { model, offset: centerOffset(model) }
          p.add(this.scratch.o.copy(spot.item.offset).applyQuaternion(q))
        }
        this.models.add(this.glowOf(model, this.ctx.ink.of(ink[spot.family])), p, q)
      } else {
        this.poolOf(look).add(p, q, 1, this.ctx.ink.of(ink[spot.family]))
      }
      Object.assign(last, { drawn: model ? 'model' : look === 'solid' ? 'box' : 'ghost', pos: p.clone() })
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
        o.material = Array.isArray(o.material) ? o.material.map(tint) : tint(o.material)
      })
      this.glows.set(model, glow)
    }
    return glow
  }

  /**
   * A weapon rack: the weapon held still in the rack's pose, by the pad's state; no lift, no spin.
   * In the game the rack's doors open on the weapon inside; the variant layer draws the kit with
   * its doors shut, so the weapon is hung just in front of them (`RACK_FACE`) to be seen.
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
    const model = look === 'solid' ? this.ctx.weaponModel(spot.pad.weapon) : null
    if (model) {
      if (rack.model !== model || !rack.offset) {
        rack.model = model
        rack.offset = faceMountOffset(model, rack.rotation, RACK_FACE)
      }
      this.models.add(model, p.copy(spot.feet).add(rack.offset), rack.rotation)
      Object.assign(last, { drawn: 'model', pos: p.clone() })
      return
    }
    // The stand-in box (its width runs along the model's Z), hung on the same face.
    p.copy(spot.feet).add(new THREE.Vector3(0, 0, RACK_FACE + BOX_WIDTH / 2).applyQuaternion(rack.rotation))
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
      // Une arme au sol garde son modèle jusqu'au bout, disparition non datée comprise : la boîte
      // n'est que le repli d'un modèle absent.
      const model = this.ctx.weaponModel(spot.item.w)
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

  /** Les armes au sol gardées par les filtres : recalculées seulement quand un filtre change. */
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

/** Une boîte d'arme neuve : chaque lot dispose de sa propre géométrie. */
function boxGeometry(): THREE.BoxGeometry {
  return new THREE.BoxGeometry(BOX_LENGTH, BOX_HEIGHT, BOX_WIDTH)
}
