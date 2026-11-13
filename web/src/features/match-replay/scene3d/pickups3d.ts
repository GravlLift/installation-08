/**
 * pickups3d.ts — LES SOCLES D'ARME ET LES ARMES AU SOL DANS LA SCÈNE 3D.
 *
 * Aucune règle n'est réécrite ici : la présence, l'état d'un socle, le filtre des armes au sol et
 * la nature d'une arme sont ceux de la vue 2D, appelés tels quels.
 *  - Un SOCLE est un disque posé au sol, à l'encre de sa nature (`padFamilyOf`). Plein, une boîte
 *    d'arme flotte au-dessus et tourne lentement ; incertain, la boîte est fantôme ; vide, le disque
 *    reste seul (`padStateAt`). Un socle MONTÉ (un râtelier mural, qui surplombe le sol, `padMountOf`)
 *    n'a ni disque ni socle : seul le modèle du jeu y est posé. Un socle hors des bornes de la carte
 *    (`padOutOfBounds`) n'est pas dessiné du tout. Les socles sont préparés comme en 2D : croisés
 *    avec les emplacements de la carte, datés par les ramassages natifs, puis leur incertitude
 *    ramenée à ce qu'un joueur a pu faire (`useReplayWeaponPads`).
 *  - Le MODÈLE DU JEU de l'arme (`weaponModels3d`) remplace la boîte pleine dès qu'il est chargé.
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
import { groundWeaponPose } from './groundWeaponPose3d'

/** Rayon et épaisseur du disque d'un socle (u). */
const PAD_DISC_RADIUS = 0.35
const PAD_DISC_HEIGHT = 0.03
const PAD_DISC_SEGMENTS = 24
/** La boîte d'arme : longueur, hauteur, largeur (u). */
const BOX_LENGTH = 0.5
const BOX_HEIGHT = 0.08
const BOX_WIDTH = 0.12
/** Écart entre le dessus du disque et le dessous de la boîte qui flotte (u). */
const PAD_BOX_LIFT = 0.25
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
 * Un socle qui surplombe le sol sous lui de plus que ceci est un râtelier mural, pas un socle posé
 * au sol : il n'a ni disque ni socle, seul le modèle du jeu est posé (u).
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

/** Un socle cuit : sa donnée, sa nature, son pied (axes three), son type (sol ou râtelier mural). */
interface PadSpot {
  pad: ReplayWeaponPadReady
  family: PadFamily
  feet: THREE.Vector3
  /** Râtelier mural : pas de disque ni de socle, seul le modèle est posé à sa hauteur. */
  mounted: boolean
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
  pads.forEach((pad, i) => {
    if (padOutOfBounds(ctx.doc.bounds, pad.x, pad.y)) return
    const family = pickupFamilyOf(pad.weapon, ctx.doc.weaponLabels)
    const phase = i * PAD_SPIN_PHASE
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
  private readonly discs: InstancePool
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
    this.discs = new InstancePool(
      ctx.root,
      new THREE.CylinderGeometry(PAD_DISC_RADIUS, PAD_DISC_RADIUS, PAD_DISC_HEIGHT, PAD_DISC_SEGMENTS),
      new THREE.MeshLambertMaterial(),
      capacity(this.pads.length),
    )
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
    this.discs.begin()
    this.solidBoxes.begin()
    this.ghostBoxes.begin()
    this.models.begin()
    if (show.weaponPads) this.paintPads(frame, inks.pad)
    if (show.groundWeapons) this.paintGround(frame, inks.pad, show.groundWeaponsSpecialOnly, show.groundWeaponsStarting)
    this.discs.end()
    this.solidBoxes.end()
    this.ghostBoxes.end()
  }

  private paintPads(frame: number, ink: Readonly<Record<PadFamily, string>>): void {
    const { p, q } = this.scratch
    for (const spot of this.pads) {
      if (spot.mounted) {
        // Un râtelier mural n'a ni disque ni socle : seul le modèle du jeu y est posé, à sa hauteur.
        const model = this.ctx.weaponModel(spot.pad.weapon)
        if (!model) continue
        q.setFromAxisAngle(Y_AXIS, frame * PAD_SPIN_PER_FRAME + spot.phase)
        this.models.add(model, p.copy(spot.feet), q)
        continue
      }
      const color = this.ctx.ink.of(ink[spot.family])
      p.copy(spot.feet).setY(spot.feet.y + PAD_DISC_HEIGHT / 2)
      this.discs.add(p, null, 1, color)
      const look = padBoxLook(padStateAt(spot.pad, frame))
      if (!look) continue
      p.setY(spot.feet.y + PAD_DISC_HEIGHT + PAD_BOX_LIFT + BOX_HEIGHT / 2)
      q.setFromAxisAngle(Y_AXIS, frame * PAD_SPIN_PER_FRAME + spot.phase)
      const model = look === 'solid' ? this.ctx.weaponModel(spot.pad.weapon) : null
      if (model) this.models.add(model, p, q)
      else this.poolOf(look).add(p, q, 1, color)
    }
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
    this.discs.dispose()
    this.solidBoxes.dispose()
    this.ghostBoxes.dispose()
    this.models.dispose()
  }
}

/** Une boîte d'arme neuve : chaque lot dispose de sa propre géométrie. */
function boxGeometry(): THREE.BoxGeometry {
  return new THREE.BoxGeometry(BOX_LENGTH, BOX_HEIGHT, BOX_WIDTH)
}
