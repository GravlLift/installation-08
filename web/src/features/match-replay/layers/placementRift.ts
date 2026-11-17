// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * placementRift — THE SPACETIME RIFT of the quantum translocator, and its PASSAGE.
 *
 * WHY A FILE APART. `placementShapes.ts` carries the shapes of the placed objects; the rift
 * is one of them, but it ended up carrying more than the others (two inks, a halo, and the
 * teleportation arc that links two positions). Extracting it keeps `placementShapes.ts`
 * under the 500-line threshold, and follows the precedent of `placementWall.ts`.
 *
 * Like the rest of the folder: no React, no written color — pure geometry. The ink comes
 * from the calling layer, which holds it from the theme tokens.
 */
import type { XY } from '../../../lib/replay/replayLogic'
import { type PlacementView, project, type ShapeStyle } from './placementShapes'
import type { TeleportLink } from '../model/placementTeleport'
import { TRANSLOCATION_FLASH_S } from '../model/playerCardFx'
import { riftStationsAt, type RiftStation } from '../model/riftStations'

/**
 * Half-height of the rift, in screen pixels.
 *
 * TALLER THAN WIDE, and that is the only thing that makes it read as a TEAR rather than as
 * a marker: the diamond of the beacon was isotropic, the rift is not.
 */
export const RIFT_HALF_HEIGHT_PX = 9

/** Half-width at the most open point. The 1:3.5 ratio is what gives the lens (9 px of half-height since aj14-b: at 7 px the rift was lost under a pawn or a trail). */
const RIFT_HALF_WIDTH_PX = 2.6

const RIFT_LINE_WIDTH = 1.4
/** The core: a full vertical stroke, shorter than the tear that surrounds it. */
const RIFT_CORE_RATIO = 0.55
/** Radius of the halo, in multiples of the half-height: what overhangs the tear. */
const RIFT_GLOW_RATIO = 1.9
const RIFT_GLOW_ALPHA = 0.34
const RIFT_LIP_ALPHA = 0.95

/**
 * RiftInk — the TWO inks of the rift.
 *
 * WHY NOT THE COLOR OF THE PLANTER, and why two. The precedent is the WALL (verdict R2-5,
 * 2026-08-18): a field object whose color says what it IS rather than who placed it is
 * recognized at a glance in the middle of eight colored trajectories. The rift is the
 * clearest case — the user asks (2026-08-27) that it "resemble an interdimensional portal",
 * and a team tint would make it read as a side marker. What is LOST is therefore the same as
 * for the wall: the side of the planter, readable in the tooltip.
 *
 * TWO inks because a portal is not a stroke: it has an EDGE and a LIGHT coming out of it,
 * exactly like the muzzle flash has its halo and its core.
 */
export interface RiftInk {
  /** The lips of the tear — the most saturated tint. */
  rim: string
  /** The core and the halo — lighter: it is the light passing through. */
  core: string
}

/**
 * drawRift — THE SPACETIME RIFT opened by the quantum translocator.
 *
 * WHY THIS SHAPE REPLACES THE DIAMOND. The layer drew a "beacon" because that was how the
 * lot of 2026-08-18 had read the object. The user corrected the reading on 2026-08-27:
 * "y a pas vraiment de balise dans le jeu, c'est un équipement que le joueur porte au
 * poignet ; là ça crée une genre de faille spatio-temporelle sur sa position exacte" (there
 * is not really a beacon in the game, it is equipment the player wears on the wrist; there
 * it creates a kind of spacetime rift on their exact position). A diamond with a full core
 * said "point placed"; two opposite arcs closing on a stroke of light say "opening".
 *
 * NO ANIMATION, and that is the same rule as for the diamond it replaces: nothing in the
 * film beats to the rhythm of this object. A rift that would twinkle would assert an
 * activity no one measured. What changes here is the SHAPE and the TINT — what the object
 * IS —, not a behavior we would lend it.
 */
export function drawRift(
  ctx: CanvasRenderingContext2D,
  c: XY,
  style: ShapeStyle,
  ink: RiftInk,
): void {
  const h = RIFT_HALF_HEIGHT_PX * style.k
  const w = RIFT_HALF_WIDTH_PX * style.k
  ctx.save()
  // THE HALO FIRST, under the lips: an ELLIPTICAL gradient, stretched along the axis of the
  // tear. A round halo would make a bubble; it is the stretch that says "it opens".
  ctx.save()
  ctx.translate(c.x, c.y)
  ctx.scale(0.5, 1)
  const r = h * RIFT_GLOW_RATIO
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
  g.addColorStop(0, ink.core)
  g.addColorStop(0.35, ink.core)
  g.addColorStop(1, 'transparent')
  ctx.globalAlpha = RIFT_GLOW_ALPHA
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  ctx.lineCap = 'round'
  ctx.lineWidth = RIFT_LINE_WIDTH * style.k
  // The two lips of the tear: two opposite quadratic arcs, peak to peak.
  ctx.globalAlpha = RIFT_LIP_ALPHA
  ctx.strokeStyle = ink.rim
  ctx.beginPath()
  ctx.moveTo(c.x, c.y - h)
  ctx.quadraticCurveTo(c.x + w, c.y, c.x, c.y + h)
  ctx.quadraticCurveTo(c.x - w, c.y, c.x, c.y - h)
  ctx.stroke()
  // The core, in the light ink: the light coming out of the opening.
  ctx.globalAlpha = 1
  ctx.strokeStyle = ink.core
  ctx.beginPath()
  ctx.moveTo(c.x, c.y - h * RIFT_CORE_RATIO)
  ctx.lineTo(c.x, c.y + h * RIFT_CORE_RATIO)
  ctx.stroke()
  ctx.restore()
}

/**
 * Duration of the TELEPORTATION FLASH, in milliseconds: that of the flash of the card
 * (`TRANSLOCATION_FLASH_S`), so that the card and the map date the same jump of the same
 * gesture.
 *
 * The link remains dotted and of low alpha: it is not confused with a trajectory, which is
 * a full stroke.
 */
export const RIFT_LINK_MS = TRANSLOCATION_FLASH_S * 1000
/** Amplitude of the arc, as a fraction of the distance: what sets it aside from the straight path. */
const RIFT_LINK_BOW = 0.18
const RIFT_LINK_WIDTH = 2.2
const RIFT_LINK_ALPHA = 0.55
/** The ends OPEN: from 1.6 times the scale at the instant of the jump to 1.0 at the fade. */
const RIFT_END_POP = 0.6
/** The wave: radius from 0.8 to 2.6 rift half-heights, initial alpha. */
const RIFT_RING_MIN = 0.8
const RIFT_RING_MAX = 2.6
const RIFT_RING_ALPHA = 0.85
const RIFT_RING_WIDTH = 1.6

/**
 * A link to trace: its two ends ALREADY PROJECTED, its fade progress (0 at the instant of
 * the jump, 1 at the disappearance), and the question of whether the point LEFT belongs to
 * it.
 *
 * `paintFrom` IS FALSE WHEN A STATION IS ALREADY THERE, and that is the correction of
 * 2026-09-03 (review round 1, finding K3): `drawRiftLayer` paints the rift at the point
 * left — that is exactly where the beacon ends up after the exchange — and the link was
 * painting ITS there on top. The halo then composed twice: that point shone brighter than at
 * any other frame, without anything to justify it. It is the STATION that remains (stable,
 * at full size); that end receives only the WAVE, which has no halo.
 */
interface RiftLinkDraw {
  from: XY
  to: XY
  progress: number
  paintFrom: boolean
}

/**
 * drawRiftWave — THE WAVE of a teleportation end: a ring that opens and fades.
 *
 * A DATED EVENT, THEREFORE A PERMITTED MOVEMENT (the "nothing beats" rule of `drawRift`
 * targets objects without event). REDUCED MOTION: the ring keeps a fixed radius and only
 * fades.
 */
function drawRiftWave(
  ctx: CanvasRenderingContext2D,
  c: XY,
  progress: number,
  style: ShapeStyle,
  ink: RiftInk,
): void {
  const reste = 1 - Math.min(1, Math.max(0, progress))
  const h = RIFT_HALF_HEIGHT_PX * style.k
  const r = h * (style.reducedMotion ? (RIFT_RING_MIN + RIFT_RING_MAX) / 2 : RIFT_RING_MIN + (RIFT_RING_MAX - RIFT_RING_MIN) * progress)
  ctx.save()
  ctx.globalAlpha = RIFT_RING_ALPHA * reste
  ctx.lineWidth = RIFT_RING_WIDTH * style.k
  ctx.strokeStyle = ink.rim
  ctx.beginPath()
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/**
 * drawRiftLink — THE PASSAGE: the brief arc that links the old position to the new one when
 * a player teleports, and the FLASH of its two ends.
 *
 * WHAT IT ASSERTS, AND WHAT IT DOES NOT ASSERT. It says that a player was THERE and is now
 * HERE, at a dated instant — two measured positions and a measured instant. It does NOT
 * claim that the player followed this curve: between the two ends of a teleportation there
 * is no trajectory, there is a LINK (the track, for its part, is cut: `translocationCuts`).
 * Hence the DOTTED line, which is the convention of the layer for "read, but not traveled",
 * and the ARC, which sets it aside from the straight stroke of a shot.
 */
function drawRiftLink(
  ctx: CanvasRenderingContext2D,
  link: RiftLinkDraw,
  style: ShapeStyle,
  ink: RiftInk,
): void {
  const { from, to } = link
  const reste = 1 - Math.min(1, Math.max(0, link.progress))
  if (reste <= 0) return
  const dx = to.x - from.x
  const dy = to.y - from.y
  // The curvature is carried by the NORMAL to the segment: the arc always sets aside the
  // same side, which makes two successive links comparable instead of each departing at
  // random.
  const cx = (from.x + to.x) / 2 - dy * RIFT_LINK_BOW
  const cy = (from.y + to.y) / 2 + dx * RIFT_LINK_BOW
  ctx.save()
  ctx.lineCap = 'round'
  ctx.setLineDash([3 * style.k, 3 * style.k])
  ctx.lineWidth = RIFT_LINK_WIDTH * style.k
  ctx.globalAlpha = RIFT_LINK_ALPHA * reste
  ctx.strokeStyle = ink.core
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.quadraticCurveTo(cx, cy, to.x, to.y)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
  // The two ends: a rift that OPENS (1.6 times its size, falling back) and its wave, at the
  // start as at the arrival. REDUCED MOTION: the ends keep their size.
  const facteur = style.reducedMotion ? 1 : 1 + RIFT_END_POP * reste * reste
  const bout: ShapeStyle = { ...style, k: style.k * facteur }
  ctx.save()
  ctx.globalAlpha = reste
  if (link.paintFrom) drawRift(ctx, from, bout, ink)
  drawRift(ctx, to, bout, ink)
  ctx.restore()
  drawRiftWave(ctx, from, link.progress, style, ink)
  drawRiftWave(ctx, to, link.progress, style, ink)
}

/** A link STILL VISIBLE at this frame, and its fade progress. */
interface LienActif {
  t: TeleportLink
  progress: number
}

/**
 * activeLinks — the passages STILL VISIBLE at this frame.
 *
 * The window is counted in MATCH TIME (`frameMs`), not in number of frames: at 60 frames
 * per second as at 10, the effect lasts the same duration. It is the rule already held by
 * the ping of the sensor and the end of flight of the grenades.
 *
 * NO dedicated INTERFACE TOGGLE: the link is not one placed object more that we would show
 * or not, it is what an already-shown rift DOES. It therefore follows the same gate as it.
 */
function activeLinks(
  teleports: readonly TeleportLink[],
  time: { frame: number; frameMs: number },
): LienActif[] {
  const out: LienActif[] = []
  for (const t of teleports) {
    const ageMs = (time.frame - t.frame) * time.frameMs
    if (ageMs < 0 || ageMs > RIFT_LINK_MS) continue
    out.push({ t, progress: ageMs / RIFT_LINK_MS })
  }
  return out
}

/**
 * RiftScene — EVERYTHING THE TRANSLOCATOR GIVES TO DRAW, and it is ONE single reading.
 *
 * The two come out of the same published layer (`translocations[]`, event 117 of the film)
 * and are computed in the same place, once per document: separating them into two arguments
 * would make the same glue twice in the caller, whereas they are not conceived one without
 * the other.
 */
export interface RiftScene {
  /** THE COMINGS AND GOINGS: from where to where, at which frame. */
  teleports: readonly TeleportLink[]
  /** WHERE THE RIFT IS and until when — one station per exchange (cf. `riftStations`). */
  rifts: readonly RiftStation[]
}

/**
 * drawRiftLayer — THE RIFT WHERE IT IS AT THIS FRAME, and the LINK of the jump that put it
 * there.
 *
 * THE RIFT IS NO LONGER DRAWN FROM A PLACEMENT, and that is the change of 2026-09-03: the
 * placement of the translocator is UNREADABLE (negative measured on three channels), while
 * each EXCHANGE says exactly where the beacon ends up — at the point the player just left.
 * `riftStations` carries this reading and its bounds; this tracing only does its shape, the
 * same as that of a deployed placement (`drawRift`), in the same fixed inks. NOTHING before
 * the first exchange, NOTHING after the measured end: the intervals already come bounded.
 *
 * A POINT IS NEVER PAINTED TWICE (finding K3 of the review): a station and the `from` end of
 * the link that opens it are THE SAME OBJECT — same life, same exchange frame. The pairing
 * is therefore done on (slot, frame) and not on floating coordinates; the link then renounces
 * its start end, the station holds it.
 *
 * THE LINK PASSES AFTER: it is brief and dated, it must read on top of the object it leaves.
 */
export function drawRiftLayer(
  ctx: CanvasRenderingContext2D,
  scene: RiftScene | undefined,
  view: PlacementView,
  time: ShapeStyle & { frame: number; frameMs: number },
  ink: RiftInk,
): void {
  if (!scene) return
  const liens = activeLinks(scene.teleports, time)
  const stations = riftStationsAt(scene.rifts, time.frame)
  for (const s of stations) {
    drawRift(ctx, project({ x: s.x, y: s.y }, view), time, ink)
  }
  for (const { t, progress } of liens) {
    const tenuParUneStation = stations.some((s) => s.slot === t.slot && s.t0 === t.frame)
    drawRiftLink(
      ctx,
      {
        from: project({ x: t.from.x, y: t.from.y }, view),
        to: project({ x: t.to.x, y: t.to.y }, view),
        progress,
        paintFrom: !tenuParUneStation,
      },
      time,
      ink,
    )
  }
}
