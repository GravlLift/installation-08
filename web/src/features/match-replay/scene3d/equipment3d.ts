// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * equipment3d.ts — EQUIPMENT IN THE 3D SCENE: placements (wall, shroud screen, sensor, seeker,
 * repair field, dropped objects), the translocator rift's stations, grapple cables and repulsor
 * knockbacks.
 *
 * EVERY DECISION IS 2D'S OWN, re-read and never recopied:
 *  - what draws and in what shape: `placementKind` (table by family, dropped objects, wall
 *    panels), on `drawablePlacements` (document placements then located spawned objects);
 *  - until when: `placementEndFrame` (read end, else the family's fallback duration) and
 *    `placementShows` (the seeker only shows its pulse);
 *  - the wall's heading: `wallHeading` (placement heading, else trajectory, else aim);
 *  - rifts: `riftStations` (placement, exchanges, read end or fallback);
 *  - the cable: the measured window [t0, t1] of `grappleLines` (a dark line like the game's; the
 *    bright line and the anchor point are an analysis aid, `aids3d.grappleLines`);
 *  - the knockback: the window of `waveProgress` (`KNOCKBACK_FX_MS`), the author's color.
 * 3D only adds height (the floor under each object) and volume (`equipment3dShapes`).
 *
 * THE EQUIPMENT IN USE, as the game shows it, each in its own module (pure timing and geometry in
 * its `*_logic.ts`): the grapple hook flying out and holding (`grapple3d`), the drop wall rising and
 * dissolving (`dropWall3d`), the shroud screen's bubble (`shroud3d`) and the thruster exhaust at
 * every measured use (`thruster3d`). Camouflage and overshield are on the body (`bodyFx3d`). The
 * repulsor shows nothing in the world: its use is the game's arm animation (`equipmentUse3d_logic`).
 *
 * IN FIRST PERSON (the slot `ctx.firstPersonSlot` names): the grapple cable leaves the viewer's left
 * hand (`ctx.firstPersonLeftHand`), the thruster draws no exhaust in the viewer's face, and the wall
 * and the bubble are world objects seen like any other (inside the bubble, its inner wall).
 *
 * THE TWO TOGGLES THE 3D DRAWER DOES NOT CARRY take their default from the 2D drawer: unidentified
 * objects off, dropped objects on (`PLACEMENT_TOGGLES_3D`). Placements and rifts follow the
 * placements switch (the drop wall and the bubble with them); grapple and thruster act on their
 * carrier and follow no switch, like camouflage and overshield.
 *
 * THE ANALYSIS AIDS (`aids3d`, off by default) cover what the game does not show as such: the
 * placement shapes (`placementShapes`: everything except wall, shroud screen, sensor and field,
 * which the game shows, `ALWAYS_SHOWN`) and the knockback arrows (`knockbackArrows`).
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
import { DropWall3d } from './dropWall3d'
import { wallPanels, wallPhaseAt, type WallPanel } from './dropWall3d_logic'
import { EquipmentShapes3d } from './equipment3dShapes'
import { Grapple3d } from './grapple3d'
import { grapplePhaseAt } from './grapple3d_logic'
import { Shroud3d, type ShroudColors } from './shroud3d'
import { shroudBubbleAt } from './shroud3d_logic'
import { Thruster3d } from './thruster3d'
import { thrusterBursts, thrusterJetAt, type ThrusterBurst } from './thruster3d_logic'
import { toThree } from './tracks3d'

type GrappleLine = ReplayDocumentReady['grappleLines'][number]
type Knockback = ReplayDocumentReady['knockbacks'][number]

/** The 2D toggles with no 3D control: their drawer defaults (`useReplaySettings`). */
export const PLACEMENT_TOGGLES_3D: PlacementToggles = { showUnnamed: false, showDropped: true }

/** Placements drawn outside the `placementShapes` aid: the game shows the wall's barrier, the screen's bubble, and the range of the sensor and the field. */
const ALWAYS_SHOWN: ReadonlySet<PlacementKind> = new Set<PlacementKind>(['wall', 'shroud', 'sensor', 'field'])

/** placementDrawn — does the placement draw, whether or not the placement-shapes aid is on? */
export function placementDrawn(kind: PlacementKind, shapes: boolean): boolean {
  return shapes || ALWAYS_SHOWN.has(kind)
}

/** Hand height above the feet (u): the cable starts there. */
const HAND_ABOVE_FEET_U = 0.45
/** Body center height above the feet (u): the knockback arrow and the thruster jet start there. */
const BODY_ABOVE_FEET_U = 0.345
/** Arrow length per unit of published speed, and its cap (u). */
const KNOCKBACK_U_PER_SPEED = 0.2
const KNOCKBACK_MAX_U = 1.5

/** A placement window's time axis: a frame's real duration and the frame count. */
export interface EquipmentTime3d {
  frameMs: number
  frames: number
}

export function equipmentTime3d(doc: ReplayDocumentReady): EquipmentTime3d {
  return { frameMs: frameToMs(1, doc), frames: doc.frameCount }
}

/** A placement 2D would draw, with its shape and its last shown frame. */
export interface PlacementSpan3d {
  p: ReplayEquipmentPlacement
  kind: PlacementKind
  end: number
}

/** placementSpans3d — the document's drawable placements, through the 2D trace's gate. */
export function placementSpans3d(doc: ReplayDocumentReady, time: EquipmentTime3d): PlacementSpan3d[] {
  const out: PlacementSpan3d[] = []
  for (const p of drawablePlacements(doc)) {
    const kind = placementKind(p, PLACEMENT_TOGGLES_3D)
    if (!kind) continue
    out.push({ p, kind, end: placementEndFrame(p, kind, time) })
  }
  return out
}

/** placementShownAt — does the placement show anything at this frame? */
export function placementShownAt(s: PlacementSpan3d, frame: number, time: EquipmentTime3d): boolean {
  if (frame < s.p.t0 || frame > s.end) return false
  return placementShows(s.p, s.kind, { frame, ...time, ...PLACEMENT_TOGGLES_3D })
}

/** knockbackShownAt — is the knockback within its 2D effect window? */
export function knockbackShownAt(k: Knockback, frame: number, time: EquipmentTime3d): boolean {
  return waveProgress((frame - k.t) * time.frameMs, false) !== null
}

/**
 * knockbackArrow — the arrow's direction (three axes, unit) and length (u), or null without a
 * published pulse (2D then draws no trail either). A missing vertical counts as zero.
 */
export function knockbackArrow(k: Knockback): { dir: THREE.Vector3; length: number } | null {
  if (k.vx == null || k.vy == null) return null
  const dir = new THREE.Vector3(...toThree(k.vx, k.vy, k.vz ?? 0))
  const speed = dir.length()
  if (!(speed > 0)) return null
  return { dir: dir.divideScalar(speed), length: Math.min(speed * KNOCKBACK_U_PER_SPEED, KNOCKBACK_MAX_U) }
}

interface PlacementItem extends PlacementSpan3d {
  /**
   * The ground point (three axes); null when neither the floor nor a published height locates it.
   * Re-read whenever the ground's surfaces change (`resolveHeights`).
   */
  at: THREE.Vector3 | null
  /** Wall heading (Halo degrees), null without a source; unused outside wall and rift. */
  heading: number | null
  /** The drop wall's panels (Halo axes), null without a heading or for another kind. */
  panels: WallPanel[] | null
}

interface RiftItem {
  s: RiftStation
  /** The height hint the floor is searched under (Halo z), null without one. */
  z: number | null
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
  private readonly bursts: readonly ThrusterBurst[]
  private readonly shapes: EquipmentShapes3d
  private readonly grapple: Grapple3d
  private readonly wall: DropWall3d
  private readonly shroud: Shroud3d
  private readonly thruster: Thruster3d
  private readonly pools: readonly { begin(): void; end(): void; dispose(): void }[]
  private readonly scratch = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3() }
  /** The ground's surfaces version the heights were read on (`Ground.version`). */
  private groundVersion: number | undefined

  constructor(ctx: ActionContext) {
    this.ctx = ctx
    const doc = ctx.doc
    this.time = equipmentTime3d(doc)
    this.groundVersion = ctx.ground.version
    this.placements = placementSpans3d(doc, this.time).map((s) => this.placementItem(s))
    this.rifts = this.riftItems(doc)
    this.grapples = doc.grappleLines.filter((l) => l.t1 > l.t0).map((l) => ({ l, anchor: this.anchorOf(l) }))
    this.knockbacks = doc.knockbacks.filter((k) => knockbackArrow(k) !== null)
    this.bursts = thrusterBursts(doc, this.time.frameMs)
    this.shapes = new EquipmentShapes3d(ctx.root)
    this.grapple = new Grapple3d(ctx.root)
    this.wall = new DropWall3d(ctx.root)
    this.shroud = new Shroud3d(ctx.root)
    this.thruster = new Thruster3d(ctx.root)
    this.pools = [this.shapes, this.grapple, this.wall, this.shroud, this.thruster]
  }

  update(frame: number): void {
    if (this.ctx.ground.version !== this.groundVersion) this.resolveHeights()
    const inputs = this.ctx.inputs()
    for (const p of this.pools) p.begin()
    if (inputs.show.placements) {
      this.paintPlacements(frame, inputs)
      if (inputs.aids.placementShapes) this.paintRifts(frame, inputs)
    }
    this.paintGrapples(frame, inputs)
    this.paintThrusters(frame, inputs)
    if (inputs.aids.knockbackArrows) this.paintKnockbacks(frame, inputs)
    for (const p of this.pools) p.end()
  }

  dispose(): void {
    for (const p of this.pools) p.dispose()
  }

  // --- Preparation (once per document) -------------------------------------------------------

  /**
   * resolveHeights — re-read every floor under the equipment once the ground's surfaces change.
   *
   * WHY: the layer is built with the map (`enableAction`), and a Forge map's floor arrives later
   * with the variant layer (`useVariantLayer` -> `attachLayer` -> `Ground.setPickables`). Read once
   * at construction, the floor under a drop wall on such a map was the canvas far below (Outlook:
   * 50 u, out of the search window), so the wall stood on its published height instead: the panel
   * object's origin, 0.26 to 0.63 u above its planter's feet (38 walls of match 05dfe4e9), which
   * is how it hovered.
   */
  private resolveHeights(): void {
    this.groundVersion = this.ctx.ground.version
    for (const it of this.placements) it.at = this.floorAt(it.p.x, it.p.y, it.p.z ?? null)
    for (const r of this.rifts) r.at = this.floorAt(r.s.x, r.s.y, r.z)
    for (const g of this.grapples) g.anchor = this.anchorOf(g.l)
  }

  /** floorAt — the floor under Halo (x, y), under height `z` when it is known; else `z`. */
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
    const panels = kind === 'wall' && heading !== null ? wallPanels({ x: p.x, y: p.y }, heading) : null
    return { ...s, at, heading, panels }
  }

  /**
   * riftItems — the stations, located in height: the station only carries (x, y), the height comes
   * from the placement (`riftPoses[].z`) or the exchange (`translocations[].fz`) that opens it,
   * same slot and same frame; else the carrier's. The rift faces where its carrier was facing.
   */
  private riftItems(doc: ReplayDocumentReady): RiftItem[] {
    const zOf = new Map<string, number>()
    for (const t of doc.translocations) if (t.fz !== undefined) zOf.set(`${t.slot}:${t.t}`, t.fz)
    for (const p of doc.riftPoses) if (p.z !== undefined) zOf.set(`${p.slot}:${p.t}`, p.z)
    return riftStations(doc).map((s) => {
      const carrier = this.ctx.slotState(s.slot, s.t0)
      const z = zOf.get(`${s.slot}:${s.t0}`) ?? carrier?.z ?? null
      return { s, z, at: this.floorAt(s.x, s.y, z), heading: carrier?.h ?? 0 }
    })
  }

  /** anchorOf — the published anchor point; without a height, the floor under it near the shooter. */
  private anchorOf(l: GrappleLine): THREE.Vector3 | null {
    if (l.az !== undefined) return new THREE.Vector3(...toThree(l.ax, l.ay, l.az))
    return this.floorAt(l.ax, l.ay, this.ctx.slotState(l.slot, l.t0)?.z ?? null)
  }

  // --- Painting (every frame) ------------------------------------------------------------------

  /** feetAt — the feet of the biped at `slot` for this frame (three axes), raised by `lift`. */
  private feetAt(slot: number, frame: number, lift: number, out: THREE.Vector3): THREE.Vector3 | null {
    const s = this.ctx.slotState(slot, frame)
    if (!s) return null
    const [x, y, z] = toThree(s.x, s.y, s.z)
    return out.set(x, y - this.ctx.originAboveFloor + lift, z)
  }

  /** ownerInk — the placer's color at their placement (2D rule `inkOf`), a life's boundary included. */
  private ownerInk(p: ReplayEquipmentPlacement, inputs: Action3dInputs): THREE.Color {
    const neutral = inputs.inks.floor.edge
    if (p.owner < 0) return this.ctx.ink.of(neutral)
    // An object dropped on death is born at `lifeEnd + 1`: the frame before is still the dropper's.
    const css = inputs.colorOfSlot(p.owner, p.t0) ?? inputs.colorOfSlot(p.owner, p.t0 - 1) ?? neutral
    return this.ctx.ink.of(css)
  }

  private paintPlacements(frame: number, inputs: Action3dInputs): void {
    const ink = this.ctx.ink
    const rift = { a: ink.of(inputs.inks.rift.rim), b: ink.of(inputs.inks.rift.core) }
    const s = inputs.inks.shroud
    const shroud: ShroudColors = { body: ink.of(s.core), rim: ink.of(s.glow), cell: ink.of(s.cell) }
    for (const it of this.placements) {
      if (!it.at || !placementDrawn(it.kind, inputs.aids.placementShapes)) continue
      if (it.kind === 'wall') {
        this.paintWall(it, it.at, frame, ink.of(inputs.inks.wall))
        continue
      }
      if (it.kind === 'shroud') {
        this.paintShroud(it, it.at, frame, shroud)
        continue
      }
      if (!placementShownAt(it, frame, this.time)) continue
      const ageMs = (frame - it.p.t0) * this.time.frameMs
      switch (it.kind) {
        case 'rift':
          this.shapes.rift(it.at, it.heading ?? 0, rift)
          break
        case 'sensor':
          this.shapes.sensor(this.sensorCenter(it, it.at), ageMs, this.ownerInk(it.p, inputs))
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

  /**
   * sensorCenter — the threat sensor's device and the center of its sphere: its published position
   * (it sticks to the floor or a wall where it lands), the ground point under it without a height.
   */
  private sensorCenter(it: PlacementItem, at: THREE.Vector3): THREE.Vector3 {
    return it.p.z != null ? this.scratch.c.set(...toThree(it.p.x, it.p.y, it.p.z)) : at
  }

  /**
   * paintWall — the drop wall: its barrier from the deployment, dissolving after its end
   * (`dropWall3d_logic`). Without a heading, the 2D ring on the ground over its window: no
   * orientation is invented.
   */
  private paintWall(it: PlacementItem, at: THREE.Vector3, frame: number, color: THREE.Color): void {
    if (!it.panels) {
      if (placementShownAt(it, frame, this.time)) this.shapes.wallRing(at, color)
      return
    }
    const phase = wallPhaseAt(it.p.t0, it.end, frame, this.time.frameMs)
    if (phase) this.wall.wall(at.y, it.panels, phase, color)
  }

  /**
   * paintShroud — the shroud screen's bubble over its window (`shroud3d_logic`), centered on the
   * bubble's published position (the grenade's rest without a read bubble), on the ground point
   * under it when the height is not published.
   */
  private paintShroud(it: PlacementItem, at: THREE.Vector3, frame: number, colors: ShroudColors): void {
    const bubble = shroudBubbleAt(it.p.t0, it.end, frame, this.time.frameMs)
    if (!bubble) return
    const center = it.p.z != null ? this.scratch.b.set(...toThree(it.p.x, it.p.y, it.p.z)) : at
    this.shroud.bubble(center, bubble, colors)
  }

  /**
   * paintThrusters — the exhaust of every measured thruster use, behind the carrier as he moves, in
   * his team color at the use; none for the first-person viewer (it would fill his own view).
   */
  private paintThrusters(frame: number, inputs: Action3dInputs): void {
    const core = this.ctx.ink.of(inputs.inks.fx.core)
    const viewer = this.ctx.firstPersonSlot(frame)
    for (const b of this.bursts) {
      if (b.t > frame) break
      if (b.slot === viewer) continue
      const jet = thrusterJetAt(b, frame, this.time.frameMs)
      const body = jet ? this.feetAt(b.slot, frame, BODY_ABOVE_FEET_U, this.scratch.b) : null
      if (!jet || !body) continue
      const push = this.scratch.c.set(...toThree(b.dx, b.dy, 0))
      const team = this.ctx.ink.of(inputs.colorOfSlot(b.slot, b.t) ?? inputs.inks.fx.core)
      this.thruster.jet(body, push, jet, { team, core })
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
      const phase = g.anchor ? grapplePhaseAt(g.l, frame, this.time.frameMs) : null
      if (!g.anchor || !phase) continue
      const hand = this.cableStart(g.l.slot, frame)
      if (hand) this.grapple.pull(hand, g.anchor, phase, color, inputs.aids.grappleLines)
    }
  }

  /**
   * cableStart — where the cable leaves: the viewer's own left hand in first person
   * (`ctx.firstPersonLeftHand`), otherwise the carrier's hand height over his feet.
   */
  private cableStart(slot: number, frame: number): THREE.Vector3 | null {
    if (slot === this.ctx.firstPersonSlot(frame)) {
      const fp = this.ctx.firstPersonLeftHand?.(this.scratch.a) ?? null
      if (fp) return fp
    }
    return this.feetAt(slot, frame, HAND_ABOVE_FEET_U, this.scratch.a)
  }

  private paintKnockbacks(frame: number, inputs: Action3dInputs): void {
    for (const k of this.knockbacks) {
      if (!knockbackShownAt(k, frame, this.time)) continue
      const arrow = knockbackArrow(k)
      const from = this.feetAt(k.slot, frame, BODY_ABOVE_FEET_U, this.scratch.b)
      if (!arrow || !from) continue
      // The AUTHOR's color at the frame of the knockback, else the pushed player's (2D rule).
      const css = (k.by != null ? inputs.colorOfSlot(k.by, k.t) : null) ?? inputs.colorOfSlot(k.slot, k.t)
      this.shapes.arrow(from, arrow.dir, arrow.length, this.ctx.ink.of(css ?? inputs.inks.fx.core))
    }
  }
}
