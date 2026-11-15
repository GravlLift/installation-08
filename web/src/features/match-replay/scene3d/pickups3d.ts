/**
 * pickups3d.ts — LES SOCLES D'ARME ET LES ARMES AU SOL DANS LA SCÈNE 3D.
 *
 * Aucune règle n'est réécrite ici : la présence, l'état d'un socle, le filtre des armes au sol et
 * la nature d'une arme sont ceux de la vue 2D, appelés tels quels.
 *  - The pad itself (floor pad, wall rack) is the game's own model, drawn by the variant object
 *    layer (`variantLayer.ts`); this layer draws only the weapon it holds. Full, a weapon box in its
 *    family ink (`padFamilyOf`) floats above the pad and turns slowly; uncertain, the box is a ghost;
 *    empty, nothing is drawn (`padStateAt`). A WEAPON RACK (the map spawner the server crossed the
 *    pad with is a `rack`, `rackMountsOf`) holds its weapon still, inside its frame, in the rack's
 *    own orientation (`rackWeaponRotation`): no lift, no spin, same full / uncertain / empty states.
 *    Without that crossing, a pad above the floor (`padMountOf`) keeps the earlier fallback: only
 *    the game's weapon model is posed, at its height. Un socle hors des bornes de la carte
 *    (`padOutOfBounds`) n'est pas dessiné du tout. Les socles sont préparés comme en 2D : croisés
 *    avec les emplacements de la carte, datés par les ramassages natifs, puis leur incertitude
 *    ramenée à ce qu'un joueur a pu faire (`useReplayWeaponPads`).
 *  - Le MODÈLE DU JEU de l'arme (`weaponModels3d`) remplace la boîte pleine dès qu'il est chargé.
 *    A power-up pad names its item by equipment family (`powerup_camo`); the library resolves the
 *    family to the pickup object's own model (`equipmentKeys3d`), drawn the same way.
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
import { WeaponModelPool } from './weaponModels3d'
import { centeredOffset, groundWeaponPose } from './groundWeaponPose3d'

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
/** Un socle au-delà de cette marge hors des bornes de la carte n'est pas dessiné (u). */
const PAD_OUT_OF_BOUNDS_MARGIN = 5
/** Plafond des lots : quelques centaines d'objets au plus. */
const POOL_CAP = 400
/** Opacité du lot fantôme (incertain, en disparition). */
const GHOST_OPACITY = 0.35

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
 * rackMountsOf — per match pad index, the WEAPON RACK spawner that confirmed it. The map variant
 * names the spawner's kind (`family`, from its type_id): `rack` is the rack that holds its weapon,
 * `power` and `powerup` are floor pads, whose weapon floats and turns. The first citation of a pad
 * wins, as in `crossedWeaponPads`. Without crossing (map off-catalog, an earlier answer), nothing is
 * a rack and every pad keeps its earlier drawing.
 */
export function rackMountsOf(cross: ReplayDocumentReady['mapWeaponPads']): Map<number, RackMount> {
  const out = new Map<number, RackMount>()
  const seen = new Set<number>()
  for (const spot of cross?.pads ?? []) {
    if (seen.has(spot.pad)) continue
    seen.add(spot.pad)
    if (spot.family === 'rack') out.set(spot.pad, { forward: spot.forward, up: spot.up })
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

/** The still pose of a rack weapon: its rotation, and the centering offset of its loaded model. */
interface RackPose {
  rotation: THREE.Quaternion
  model?: THREE.Object3D
  offset?: THREE.Vector3
}

/** Un socle cuit : sa donnée, sa nature, son pied (axes three), son type (sol ou râtelier mural). */
interface PadSpot {
  pad: ReplayWeaponPadReady
  family: PadFamily
  feet: THREE.Vector3
  /** Fallback wall rack (no crossing): only the weapon model is posed, at its height. */
  mounted: boolean
  /** A weapon rack: the weapon is held still at the spawner (feet), in this pose. */
  rack?: RackPose
  phase: number
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
  const racks = rackMountsOf(ctx.doc.mapWeaponPads)
  pads.forEach((pad, i) => {
    if (padOutOfBounds(ctx.doc.bounds, pad.x, pad.y)) return
    const family = pickupFamilyOf(pad.weapon, ctx.doc.weaponLabels)
    const phase = i * PAD_SPIN_PHASE
    const rack = racks.get(i)
    if (rack) {
      // The crossed position IS the spawner's, and the game creates the weapon there (median
      // 0.01 m): the weapon is held at that point, never snapped to the floor under the rack.
      const feet = pad.z !== undefined ? new THREE.Vector3(...toThree(pad.x, pad.y, pad.z)) : feetOf(ctx.ground, pad.x, pad.y, pad.z)
      if (feet) out.push({ pad, family, feet, mounted: true, rack: { rotation: rackWeaponRotation(rack) }, phase })
      return
    }
    const floor = ctx.ground.floorY(pad.x, pad.y, pad.z ?? null)
    const mounted = padMountOf(pad.z, floor) === 'mounted'
    // Un râtelier tient au z publié (la boîte du socle est absente) ; un socle au sol se cale sur le sol.
    const feet = mounted ? new THREE.Vector3(...toThree(pad.x, pad.y, pad.z!)) : feetOf(ctx.ground, pad.x, pad.y, pad.z)
    if (feet) out.push({ pad, family, feet, mounted, phase })
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
  private readonly scratch = { p: new THREE.Vector3(), q: new THREE.Quaternion() }
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
  }

  update(frame: number): void {
    const { show, inks } = this.ctx.inputs()
    this.solidBoxes.begin()
    this.ghostBoxes.begin()
    this.models.begin()
    if (show.weaponPads) this.paintPads(frame, inks.pad)
    if (show.groundWeapons) this.paintGround(frame, inks.pad, show.groundWeaponsSpecialOnly, show.groundWeaponsStarting)
    this.solidBoxes.end()
    this.ghostBoxes.end()
  }

  private paintPads(frame: number, ink: Readonly<Record<PadFamily, string>>): void {
    const { p, q } = this.scratch
    for (const spot of this.pads) {
      if (spot.rack) {
        this.paintRack(spot, spot.rack, frame, ink)
        continue
      }
      if (spot.mounted) {
        // A wall rack: only the game's weapon model is posed, at its height.
        const model = this.ctx.weaponModel(spot.pad.weapon)
        if (!model) continue
        q.setFromAxisAngle(Y_AXIS, frame * PAD_SPIN_PER_FRAME + spot.phase)
        this.models.add(model, p.copy(spot.feet), q)
        continue
      }
      const look = padBoxLook(padStateAt(spot.pad, frame))
      if (!look) continue
      p.copy(spot.feet).setY(spot.feet.y + PAD_BOX_LIFT + BOX_HEIGHT / 2)
      q.setFromAxisAngle(Y_AXIS, frame * PAD_SPIN_PER_FRAME + spot.phase)
      const model = look === 'solid' ? this.ctx.weaponModel(spot.pad.weapon) : null
      if (model) this.models.add(model, p, q)
      else this.poolOf(look).add(p, q, 1, this.ctx.ink.of(ink[spot.family]))
    }
  }

  /** A weapon rack: the weapon held still in the rack's pose, by the pad's state; no lift, no spin. */
  private paintRack(spot: PadSpot, rack: RackPose, frame: number, ink: Readonly<Record<PadFamily, string>>): void {
    const look = padBoxLook(padStateAt(spot.pad, frame))
    if (!look) return
    const { p } = this.scratch
    const model = look === 'solid' ? this.ctx.weaponModel(spot.pad.weapon) : null
    if (model) {
      if (rack.model !== model || !rack.offset) {
        rack.model = model
        rack.offset = centeredOffset(model, rack.rotation)
      }
      this.models.add(model, p.copy(spot.feet).add(rack.offset), rack.rotation)
      return
    }
    this.poolOf(look).add(p.copy(spot.feet), rack.rotation, 1, this.ctx.ink.of(ink[spot.family]))
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
    this.solidBoxes.dispose()
    this.ghostBoxes.dispose()
    this.models.dispose()
  }
}

/** Une boîte d'arme neuve : chaque lot dispose de sa propre géométrie. */
function boxGeometry(): THREE.BoxGeometry {
  return new THREE.BoxGeometry(BOX_LENGTH, BOX_HEIGHT, BOX_WIDTH)
}
