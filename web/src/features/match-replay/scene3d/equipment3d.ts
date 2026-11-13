/**
 * equipment3d.ts — L'ÉQUIPEMENT DANS LA SCÈNE 3D : les poses (mur, écran occultant, capteur,
 * traqueur, champ de réparation, objets lâchés), les stations de la faille du translocateur, les
 * câbles de grappin et les poussées du répulseur.
 *
 * TOUTES LES DÉCISIONS SONT CELLES DE LA 2D, relues et jamais recopiées :
 *  - ce qui se dessine et sous quelle forme : `placementKind` (table par famille, objets lâchés,
 *    panneaux du mur), sur `drawablePlacements` (poses du document puis objets engendrés situés) ;
 *  - jusqu'à quand : `placementEndFrame` (fin lue, sinon durée de repli de la famille) et
 *    `placementShows` (le traqueur ne montre que son impulsion) ;
 *  - le cap du mur : `wallHeading` (cap de pose, sinon trajectoire, sinon visée) ;
 *  - les failles : `riftStations` (pose, échanges, fin lue ou repli) ;
 *  - le câble : la fenêtre mesurée [t0, t1] de `grappleLines` (un fil sombre comme celui du jeu ; le
 *    trait clair et le point d'accroche sont un repère d'analyse, `aids3d.grappleLines`) ;
 *  - la poussée : la fenêtre de `waveProgress` (`KNOCKBACK_FX_MS`), la couleur de l'auteur.
 * La 3D n'y ajoute que la hauteur (le sol sous chaque objet) et le volume (`equipment3dShapes`).
 *
 * LES DEUX BASCULES QUE LE TIROIR 3D NE PORTE PAS valent leur défaut du tiroir 2D : objets non
 * identifiés éteints, objets lâchés allumés (`PLACEMENT_TOGGLES_3D`). Poses et failles suivent
 * l'interrupteur des poses ; câbles et poussées n'en ont pas, en 2D non plus.
 *
 * LES REPÈRES D'ANALYSE (`aids3d`, éteints par défaut) coiffent ce que le jeu ne montre pas tel
 * quel : les formes des poses (`placementShapes` : tout sauf capteur et champ, dont le dôme et
 * l'anneau restent comme en jeu, `ALWAYS_SHOWN`) et les flèches de poussée (`knockbackArrows`).
 */
import * as THREE from 'three'

import type { ReplayEquipmentPlacement } from '@/lib/api/types'
import { frameToMs } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import { placementKind, type PlacementKind, type PlacementToggles } from '../layers/equipmentPlacementsLayer'
import { waveProgress } from '../layers/knockbackFx'
import { wallHeading } from '../layers/placementWall'
import { placementEndFrame, placementShows } from '../model/placementWindow'
import { covers } from '../model/replaySpans'
import { riftStations, type RiftStation } from '../model/riftStations'
import { drawablePlacements } from '../model/spawnedObjects'
import type { Action3dInputs } from './action3dInputs'
import type { ActionContext, ActionLayer3d } from './actionScene3d'
import { EquipmentShapes3d } from './equipment3dShapes'
import { toThree } from './tracks3d'

type GrappleLine = ReplayDocumentReady['grappleLines'][number]
type Knockback = ReplayDocumentReady['knockbacks'][number]

/** Les bascules 2D sans commande en 3D : leurs défauts du tiroir (`useReplaySettings`). */
export const PLACEMENT_TOGGLES_3D: PlacementToggles = { showUnnamed: false, showDropped: true }

/** Les poses dessinées hors du repère `placementShapes` : le jeu montre leur portée. */
const ALWAYS_SHOWN: ReadonlySet<PlacementKind> = new Set<PlacementKind>(['sensor', 'field'])

/** placementDrawn — la pose se dessine-t-elle, le repère des formes des poses allumé ou non ? */
export function placementDrawn(kind: PlacementKind, shapes: boolean): boolean {
  return shapes || ALWAYS_SHOWN.has(kind)
}

/** Hauteur de la main au-dessus des pieds (u) : le câble part de là. */
const HAND_ABOVE_FEET_U = 0.45
/** Hauteur du centre du corps au-dessus des pieds (u) : la flèche de poussée part de là. */
const BODY_ABOVE_FEET_U = 0.345
/** Longueur de la flèche par unité de vitesse imposée, et son plafond (u). */
const KNOCKBACK_U_PER_SPEED = 0.2
const KNOCKBACK_MAX_U = 1.5

/** L'axe de temps d'une fenêtre de pose : durée réelle d'une image et nombre d'images. */
export interface EquipmentTime3d {
  frameMs: number
  frames: number
}

export function equipmentTime3d(doc: ReplayDocumentReady): EquipmentTime3d {
  return { frameMs: frameToMs(1, doc), frames: doc.frameCount }
}

/** Une pose que la 2D dessinerait, avec sa forme et sa dernière image affichée. */
export interface PlacementSpan3d {
  p: ReplayEquipmentPlacement
  kind: PlacementKind
  end: number
}

/** placementSpans3d — les poses dessinables du document, par la porte du tracé 2D. */
export function placementSpans3d(doc: ReplayDocumentReady, time: EquipmentTime3d): PlacementSpan3d[] {
  const out: PlacementSpan3d[] = []
  for (const p of drawablePlacements(doc)) {
    const kind = placementKind(p, PLACEMENT_TOGGLES_3D)
    if (!kind) continue
    out.push({ p, kind, end: placementEndFrame(p, kind, time) })
  }
  return out
}

/** placementShownAt — la pose montre-t-elle quelque chose à cette image ? */
export function placementShownAt(s: PlacementSpan3d, frame: number, time: EquipmentTime3d): boolean {
  if (frame < s.p.t0 || frame > s.end) return false
  return placementShows(s.p, s.kind, { frame, ...time, ...PLACEMENT_TOGGLES_3D })
}

/** grappleShownAt — le câble est-il tendu à cette image ? (fenêtre mesurée, traction non vide). */
export function grappleShownAt(l: GrappleLine, frame: number): boolean {
  return l.t1 > l.t0 && covers(l, frame)
}

/** knockbackShownAt — la poussée est-elle dans la fenêtre de son effet 2D ? */
export function knockbackShownAt(k: Knockback, frame: number, time: EquipmentTime3d): boolean {
  return waveProgress((frame - k.t) * time.frameMs, false) !== null
}

/**
 * knockbackArrow — la direction (axes three, unitaire) et la longueur (u) de la flèche, ou null sans
 * impulsion publiée (la 2D ne trace alors pas de sillage). La verticale absente vaut zéro.
 */
export function knockbackArrow(k: Knockback): { dir: THREE.Vector3; length: number } | null {
  if (k.vx == null || k.vy == null) return null
  const dir = new THREE.Vector3(...toThree(k.vx, k.vy, k.vz ?? 0))
  const speed = dir.length()
  if (!(speed > 0)) return null
  return { dir: dir.divideScalar(speed), length: Math.min(speed * KNOCKBACK_U_PER_SPEED, KNOCKBACK_MAX_U) }
}

interface PlacementItem extends PlacementSpan3d {
  /** Le point au sol (axes three) ; null quand ni le sol ni la hauteur publiée ne le situent. */
  at: THREE.Vector3 | null
  /** Cap du mur (degrés Halo), null sans source ; inutilisé hors mur et faille. */
  heading: number | null
}

interface RiftItem {
  s: RiftStation
  at: THREE.Vector3 | null
  heading: number
}

interface GrappleItem {
  l: GrappleLine
  anchor: THREE.Vector3 | null
}

export class Equipment3dLayer implements ActionLayer3d {
  private readonly ctx: ActionContext
  private readonly time: EquipmentTime3d
  private readonly placements: PlacementItem[]
  private readonly rifts: RiftItem[]
  private readonly grapples: GrappleItem[]
  private readonly knockbacks: readonly Knockback[]
  private readonly shapes: EquipmentShapes3d
  private readonly scratch = { a: new THREE.Vector3(), b: new THREE.Vector3() }

  constructor(ctx: ActionContext) {
    this.ctx = ctx
    const doc = ctx.doc
    this.time = equipmentTime3d(doc)
    this.placements = placementSpans3d(doc, this.time).map((s) => this.placementItem(s))
    this.rifts = this.riftItems(doc)
    this.grapples = doc.grappleLines.filter((l) => l.t1 > l.t0).map((l) => ({ l, anchor: this.anchorOf(l) }))
    this.knockbacks = doc.knockbacks.filter((k) => knockbackArrow(k) !== null)
    this.shapes = new EquipmentShapes3d(ctx.root)
  }

  update(frame: number): void {
    const inputs = this.ctx.inputs()
    this.shapes.begin()
    if (inputs.show.placements) {
      this.paintPlacements(frame, inputs)
      if (inputs.aids.placementShapes) this.paintRifts(frame, inputs)
    }
    this.paintGrapples(frame, inputs)
    if (inputs.aids.knockbackArrows) this.paintKnockbacks(frame, inputs)
    this.shapes.end()
  }

  dispose(): void {
    this.shapes.dispose()
  }

  // --- Préparation (une fois par document) -------------------------------------------------------

  /** floorAt — le sol sous (x, y) Halo, sous la hauteur `z` quand elle est connue ; à défaut `z`. */
  private floorAt(x: number, y: number, z: number | null): THREE.Vector3 | null {
    const y3 = this.ctx.ground.floorY(x, y, z) ?? z
    if (y3 === null) return null
    const [tx, , tz] = toThree(x, y, 0)
    return new THREE.Vector3(tx, y3, tz)
  }

  private placementItem(s: PlacementSpan3d): PlacementItem {
    const { p, kind } = s
    const at = this.floorAt(p.x, p.y, p.z ?? null)
    let heading: number | null = null
    if (kind === 'wall') heading = wallHeading(p, this.ctx.doc.tracks)?.deg ?? null
    else if (kind === 'rift') heading = p.h ?? this.ctx.slotState(p.owner, p.t0)?.h ?? 0
    return { ...s, at, heading }
  }

  /**
   * riftItems — les stations, situées en hauteur : la station ne porte que (x, y), la hauteur vient
   * de la pose (`riftPoses[].z`) ou de l'échange (`translocations[].fz`) qui l'ouvre, même slot et
   * même image ; à défaut, celle du porteur. La faille regarde où regardait son porteur.
   */
  private riftItems(doc: ReplayDocumentReady): RiftItem[] {
    const zOf = new Map<string, number>()
    for (const t of doc.translocations) if (t.fz !== undefined) zOf.set(`${t.slot}:${t.t}`, t.fz)
    for (const p of doc.riftPoses) if (p.z !== undefined) zOf.set(`${p.slot}:${p.t}`, p.z)
    return riftStations(doc).map((s) => {
      const carrier = this.ctx.slotState(s.slot, s.t0)
      const z = zOf.get(`${s.slot}:${s.t0}`) ?? carrier?.z ?? null
      return { s, at: this.floorAt(s.x, s.y, z), heading: carrier?.h ?? 0 }
    })
  }

  /** anchorOf — le point d'accroche publié ; sans hauteur, le sol sous lui près du tireur. */
  private anchorOf(l: GrappleLine): THREE.Vector3 | null {
    if (l.az !== undefined) return new THREE.Vector3(...toThree(l.ax, l.ay, l.az))
    return this.floorAt(l.ax, l.ay, this.ctx.slotState(l.slot, l.t0)?.z ?? null)
  }

  // --- Peinture (à chaque image) ------------------------------------------------------------------

  /** feetAt — les pieds du bipède de `slot` à cette image (axes three), relevés de `lift`. */
  private feetAt(slot: number, frame: number, lift: number, out: THREE.Vector3): THREE.Vector3 | null {
    const s = this.ctx.slotState(slot, frame)
    if (!s) return null
    const [x, y, z] = toThree(s.x, s.y, s.z)
    return out.set(x, y - this.ctx.originAboveFloor + lift, z)
  }

  /** ownerInk — la couleur du poseur à sa pose (règle 2D `inkOf`), la frontière d'une vie comprise. */
  private ownerInk(p: ReplayEquipmentPlacement, inputs: Action3dInputs): THREE.Color {
    const neutral = inputs.inks.floor.edge
    if (p.owner < 0) return this.ctx.ink.of(neutral)
    // Un objet lâché à la mort naît à `finVie + 1` : l'image d'avant est encore celle du lâcheur.
    const css = inputs.colorOfSlot(p.owner, p.t0) ?? inputs.colorOfSlot(p.owner, p.t0 - 1) ?? neutral
    return this.ctx.ink.of(css)
  }

  private paintPlacements(frame: number, inputs: Action3dInputs): void {
    const ink = this.ctx.ink
    const rift = { a: ink.of(inputs.inks.rift.rim), b: ink.of(inputs.inks.rift.core) }
    const shroud = { a: ink.of(inputs.inks.shroud.core), b: ink.of(inputs.inks.shroud.glow) }
    for (const it of this.placements) {
      if (!it.at || !placementDrawn(it.kind, inputs.aids.placementShapes) || !placementShownAt(it, frame, this.time)) continue
      const ageMs = (frame - it.p.t0) * this.time.frameMs
      switch (it.kind) {
        case 'wall':
          this.shapes.wall(it.at, it.heading, ink.of(inputs.inks.wall))
          break
        case 'rift':
          this.shapes.rift(it.at, it.heading ?? 0, rift)
          break
        case 'shroud':
          this.shapes.shroud(it.at, shroud)
          break
        case 'sensor':
          this.shapes.sensor(it.at, ageMs, this.ownerInk(it.p, inputs))
          break
        case 'seeker':
          this.shapes.seeker(it.at, ageMs, this.ownerInk(it.p, inputs))
          break
        case 'field':
          this.shapes.field(it.at, this.ownerInk(it.p, inputs))
          break
        default:
          this.shapes.dropped(it.at, this.ownerInk(it.p, inputs))
      }
    }
  }

  private paintRifts(frame: number, inputs: Action3dInputs): void {
    const ink = { a: this.ctx.ink.of(inputs.inks.rift.rim), b: this.ctx.ink.of(inputs.inks.rift.core) }
    for (const r of this.rifts) {
      if (r.at && covers(r.s, frame)) this.shapes.rift(r.at, r.heading, ink)
    }
  }

  private paintGrapples(frame: number, inputs: Action3dInputs): void {
    const color = this.ctx.ink.of(inputs.inks.grapple)
    for (const g of this.grapples) {
      if (!g.anchor || !grappleShownAt(g.l, frame)) continue
      const hand = this.feetAt(g.l.slot, frame, HAND_ABOVE_FEET_U, this.scratch.a)
      if (hand) this.shapes.cable(hand, g.anchor, color, inputs.aids.grappleLines)
    }
  }

  private paintKnockbacks(frame: number, inputs: Action3dInputs): void {
    for (const k of this.knockbacks) {
      if (!knockbackShownAt(k, frame, this.time)) continue
      const arrow = knockbackArrow(k)
      const from = this.feetAt(k.slot, frame, BODY_ABOVE_FEET_U, this.scratch.b)
      if (!arrow || !from) continue
      // La couleur de l'AUTEUR à l'image de la poussée, sinon celle du poussé (règle 2D).
      const css = (k.by != null ? inputs.colorOfSlot(k.by, k.t) : null) ?? inputs.colorOfSlot(k.slot, k.t)
      this.shapes.arrow(from, arrow.dir, arrow.length, this.ctx.ink.of(css ?? inputs.inks.fx.core))
    }
  }
}
