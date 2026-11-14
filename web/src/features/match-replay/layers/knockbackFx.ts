/**
 * knockbackFx.ts — THE PUSH OF THE REPULSOR: a wave that starts from the author, and a trail
 * on the pushed player, oriented by the read impulse.
 *
 * THE SOURCE is the document (schema 94): `knockbacks`, one entry per pushed player — (t,
 * slot), the author `by` and the imposed velocity `vx/vy/vz`, read from the pair of messages
 * the film writes (`EquipmentObjectKnockedBack` then `EquipmentKnockbackPlayer`). No
 * threshold, no trajectory reading to decide: the push IS published.
 *
 * ## What draws
 *
 *  - THE WAVE, centered on the author at the frame of the push: a ring that extends and
 *    fades. It says WHO pushed. Without a published author (`by` absent), no wave: we do
 *    not place a source at random.
 *  - THE TRAIL on the pushed player, the tracing of the thruster (`drawDash` of
 *    `thrusterDashFx.ts`): the DIRECTION comes from the impulse (`vx`, `vy`), not from the
 *    displacement. Without a published impulse, no trail.
 *
 * THE COLOR is that of the team of the AUTHOR, resolved at the frame of the push (the slot
 * of a life is taken back at respawns); without an author, that of the pushed player.
 *
 * Everything is pure geometry on the context; the inks arrive already resolved from the
 * tokens.
 */
import type { ReplayPoint } from '@/lib/api/types'

import { positionAt, type XY } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { buildLivesBySlot, lifeOfSlotAt } from '../model/livesPosition'
import { type CanvasView, projectTo } from '../model/replayView'
import { dashProgress, drawDash } from './thrusterDashFx'

/** DURATION OF THE EFFECT, in real time of the match: a brief breath, like the dash of the
 * thruster. */
export const KNOCKBACK_FX_MS = 520

/** Final radius of the wave, in screen pixels (multiplied by the density). */
const WAVE_RADIUS = 26
const WAVE_WIDTH = 2.2
const WAVE_ALPHA = 0.85
/** Under reduced motion: the ring is placed, full radius, constant opacity. */
const WAVE_ALPHA_STATIC = 0.5

/** A push ready to draw. */
export interface KnockbackFx {
  frame: number
  /** Slot of the pushed player, and the points of THEIR life (the trail follows the pawn). */
  slot: number
  points: ReplayPoint[]
  /** Slot of the author and their position at the frame of the push; absent without a
   * published author. */
  by: number | null
  origin: XY | null
  /** Imposed velocity, horizontal plane, in world; absent without a published impulse. */
  push: XY | null
}

/**
 * buildKnockbackFx joins each push to THE LIFE of the pushed player that covers its instant
 * and, when the author is published, to the position of the life of the author at that
 * instant. A push whose pushed life has no points produces nothing.
 */
export function buildKnockbackFx(doc: ReplayDocumentReady): KnockbackFx[] {
  if (doc.knockbacks.length === 0) return []
  const bySlot = buildLivesBySlot(doc.tracks)
  const out: KnockbackFx[] = []
  for (const k of doc.knockbacks) {
    const pushed = lifeOfSlotAt(bySlot, k.slot, k.t)
    if (!pushed || pushed.points.length === 0) continue
    let origin: XY | null = null
    if (k.by != null) {
      const author = lifeOfSlotAt(bySlot, k.by, k.t)
      origin = author ? positionAt(author.points, k.t) : null
    }
    const push = k.vx != null && k.vy != null ? { x: k.vx, y: k.vy } : null
    out.push({
      frame: k.t,
      slot: k.slot,
      points: pushed.points,
      by: k.by ?? null,
      origin,
      push,
    })
  }
  return out
}

/** The clock of the layer: current frame, real duration of a frame, density, preference. */
interface KnockbackTime {
  frame: number
  frameMs: number
  k: number
  reducedMotion: boolean
}

/** The style: the team color of a life, at a given frame. */
export interface KnockbackStyle {
  colorOfSlot: (slot: number, frame: number) => string | null
}

/**
 * waveProgress: radius (part of the final radius) and presence of the wave at this age, or
 * `null` outside the window. easeOutCubic stretch, like the dash and the shockwave of the
 * explosion.
 */
export function waveProgress(
  ageMs: number,
  reducedMotion: boolean,
): { reach: number; alpha: number } | null {
  if (!(ageMs >= 0) || ageMs > KNOCKBACK_FX_MS) return null
  if (reducedMotion) return { reach: 1, alpha: WAVE_ALPHA_STATIC }
  const p = ageMs / KNOCKBACK_FX_MS
  return { reach: 1 - Math.pow(1 - p, 3), alpha: (1 - p) * WAVE_ALPHA }
}

/** drawKnockbackLayer paints the pushes active at the current frame. */
export function drawKnockbackLayer(
  ctx: CanvasRenderingContext2D,
  fx: readonly KnockbackFx[],
  view: CanvasView,
  time: KnockbackTime,
  style: KnockbackStyle,
): void {
  for (const f of fx) {
    const ageMs = (time.frame - f.frame) * time.frameMs
    const wave = waveProgress(ageMs, time.reducedMotion)
    if (!wave) continue
    const color =
      (f.by != null ? style.colorOfSlot(f.by, f.frame) : null) ?? style.colorOfSlot(f.slot, f.frame)
    if (!color) continue
    ctx.save()
    if (f.origin) drawWave(ctx, projectTo(view, f.origin), wave, { k: time.k, color })
    const dash = dashProgress(ageMs, time.reducedMotion)
    const head = positionAt(f.points, time.frame)
    const dir = f.push && head ? screenDirection(head, f.push, view) : null
    if (dash && head && dir) drawDash(ctx, projectTo(view, head), dir, dash, { k: time.k, color })
    ctx.restore()
  }
}

function drawWave(
  ctx: CanvasRenderingContext2D,
  c: XY,
  wave: { reach: number; alpha: number },
  paint: { k: number; color: string },
): void {
  const r = WAVE_RADIUS * paint.k * wave.reach
  if (!(r > 0)) return
  ctx.globalAlpha = wave.alpha
  ctx.strokeStyle = paint.color
  ctx.lineWidth = WAVE_WIDTH * paint.k
  ctx.beginPath()
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
  ctx.stroke()
}

/**
 * screenDirection projects the pawn and the pawn offset by the impulse, and normalizes IN
 * PIXELS (the projection can invert an axis and does not have the same scale in x and in y).
 */
function screenDirection(at: XY, push: XY, view: CanvasView): XY | null {
  const a = projectTo(view, at)
  const b = projectTo(view, { x: at.x + push.x, y: at.y + push.y })
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (!(len > 0)) return null
  return { x: dx / len, y: dy / len }
}
