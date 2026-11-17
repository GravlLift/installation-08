// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * bombBlastFx.ts — the BLAST OF AN ASSAULT BOMB. Pure logic, no React.
 *
 * WHY THIS EFFECT EXISTS (user return of 2026-08-31: "faudrait un truc bien voyant quand même"
 * (there should still be something quite visible)). Assault has published its explosions since
 * that day (`bomb_detonations`, cf. `objectiveevents/named.go`), and they only had a CARD
 * WATERMARK — 22% opacity, behind the content, on the other end of the screen from the map.
 * But in Assault the explosion is not a detail of the score: it is the ONLY event that decides
 * the round, and there are only a handful per match. It needed the map.
 *
 * THREE LAYERS, AND THAT IS WHAT MAKES IT VISIBLE — a ring alone would read as a flag
 * capture, which an explosion is not:
 *
 *   1. the FLASH — a solid disk that is born wide and dies fast (the first quarter of the
 *      life);
 *   2. the WAVE — a thick ring that opens much further than that of a capture (44 px against
 *      24) and thins as it dilates;
 *   3. the SHARDS — eight radial strokes that leave the point and fade. They are the ones
 *      that say "it exploded" rather than "it was captured".
 *
 * IT IS NOT AN OBJECTIVE PULSE, and the difference is the same as for the capture wave
 * (`flagCaptureFx`): the pulse (`objectivesLayer.buildObjectivePulses`) places the action on
 * the closest SERVED ELEMENT. In Assault it places nothing at all — the objective catalog
 * carries NO form of site on the five Assault maps (phase A3 of lot A). This effect reads the
 * RE-READ position of the author, like the capture wave.
 *
 * THE CLOCK GUARD IS THE SAME AS THAT OF THE CAPTURE WAVE: `a.t` is a frame of the document
 * only if the origin of the film has been resolved (`filmClockTrusted`). Otherwise the gap is
 * UNKNOWN — measured from 3.6 s to 50.8 s depending on the match — and the blast would light
 * up on an explosion that has not happened yet. Silent is worth better than wrong: the list
 * comes out empty.
 *
 * NO GUESSED POSITION: an explosion whose author is not locatable at this frame is SET ASIDE.
 * Placing it at the center of the map, or on the closest pedestal, would designate a place
 * that the measurement does not say.
 *
 * NO TOKEN HERE (color-tokens rule): the ink arrives resolved by the caller. It is that of
 * the SIDE of the author, like the capture wave — on the map, the glyph says WHAT and the
 * color says WHO, and in Assault knowing which side blew the bomb is half of the
 * information.
 */
import { filmClockTrusted } from '@/lib/replay/scoreTimeline'

import { type CanvasView, projectTo } from '../model/replayView'
import { type XY } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'

/**
 * The stat of an explosion, as the server names it (`objectiveevents/named.go`). In Assault a
 * mode point is worth ONE explosion, and nothing else moves the score — it is the only stat
 * of the family that the film replicates.
 */
export const BOMB_DETONATION_STAT = 'bomb_detonations'

/** A blast ready to draw: its instant, the RE-READ place of its author, and its author. */
export interface BombBlastFx {
  /** Frame of the document (the axis of `Point.T` — no realignment here, cf. the header). */
  frame: number
  x: number
  y: number
  /** The author: it is they who give the ink of the side, resolved by the caller. */
  xuid: string
}

/**
 * buildBombBlastFx returns the bomb explosions of the film, placed at the place of their
 * author.
 *
 * `posOf` ALREADY CARRIES ITS AFTER-DEATH WINDOW (pattern `posOfPlayerAt`, the same indexed
 * lives as the carried flag and the crown) — and this window counts here more than elsewhere:
 * the planter of a bomb often dies IN their explosion.
 */
export function buildBombBlastFx(
  doc: ReplayDocumentReady,
  posOf: (xuid: string, frame: number) => XY | null,
): BombBlastFx[] {
  if (doc.objectives.length === 0) return []
  if (!filmClockTrusted(doc)) return []
  const out: BombBlastFx[] = []
  for (const a of doc.objectives) {
    if (a.stat !== BOMB_DETONATION_STAT) continue
    const pos = posOf(a.xuid, a.t)
    if (!pos) continue
    out.push({ frame: a.t, x: pos.x, y: pos.y, xuid: a.xuid })
  }
  return out
}

/**
 * Duration of the effect, IN FRAMES — 12 frames ≈ 1.2 s at the documented 100 ms step of the
 * replay.
 *
 * TWICE the capture wave (6 frames), and that is deliberate: a flag capture repeats several
 * times per round, an Assault explosion comes one to four times per MATCH (note A0.3: 28
 * explosions on 9 films). A rare event is allowed to hold the screen longer — the risk of
 * overlap, for its part, is nil at this density.
 */
export const BOMB_BLAST_HOLD_FRAMES = 12

/** Display window (same shape as that of the capture wave). */
export interface BombBlastWindow {
  frame: number
  hold: number
}

/** Style of the effect: the ink of the side of the author is RESOLVED by the caller. */
export interface BombBlastStyle {
  /** Ink of the side of the author seen from the page; the neutral of the theme when unknown. */
  inkOf: (xuid: string) => string
  /** Reduced motion: nothing opens, the footprint only fades. */
  reducedMotion: boolean
}

// Geometry, in screen pixels.
/** THE FLASH: solid disk, wide from the start, out at a quarter of the life. */
const FLASH_R = 13
const FLASH_LIFE = 0.25
const FLASH_ALPHA = 0.55
/** THE WAVE: much broader than that of a capture (24 px) — that is what distinguishes it from far. */
const WAVE_START_R = 8
const WAVE_SPREAD = 36
const WAVE_START_W = 4
const WAVE_END_W = 0.8
const WAVE_ALPHA = 0.95
/** THE SHARDS: eight radial strokes, from the edge of the flash outward. */
const SHARD_COUNT = 8
const SHARD_INNER = 10
const SHARD_LEN = 16
const SHARD_W = 2
const SHARD_ALPHA = 0.8
/** Reduced motion: a FIXED footprint — solid disk and ring, no movement. */
const STATIC_R = 15
const STATIC_W = 3

/**
 * drawBombBlastFx draws the explosions of the current window.
 *
 * UNDER "REDUCED MOTION", A FIXED FOOTPRINT THAT FADES — a ringed solid disk, without
 * expansion nor shards. It is the rule of all the effects of the replay (`drawObjectivePulses`,
 * `drawFlagCaptureFx`): what disappears is the MOVEMENT, not the information. The explosion
 * stays marked, in its place, for the same duration — and stays visible, because the solid
 * disk is visible by itself.
 */
export function drawBombBlastFx(
  ctx: CanvasRenderingContext2D,
  fx: readonly BombBlastFx[],
  view: CanvasView,
  win: BombBlastWindow,
  style: BombBlastStyle,
): void {
  for (const f of fx) {
    const age = win.frame - f.frame
    if (age < 0 || age > win.hold) continue
    const k = age / Math.max(win.hold, 1)
    const c = projectTo(view, f)
    const ink = style.inkOf(f.xuid)
    ctx.fillStyle = ink
    ctx.strokeStyle = ink

    if (style.reducedMotion) {
      ctx.globalAlpha = FLASH_ALPHA * (1 - k)
      ctx.beginPath()
      ctx.arc(c.x, c.y, STATIC_R, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = WAVE_ALPHA * (1 - k)
      ctx.lineWidth = STATIC_W
      ctx.beginPath()
      ctx.arc(c.x, c.y, STATIC_R, 0, Math.PI * 2)
      ctx.stroke()
      continue
    }

    // 1. THE FLASH — it only lives the first quarter, and its alpha dies on THAT quarter,
    // not on the whole life: beyond it only a gray veil would remain that would blur the
    // wave.
    if (k < FLASH_LIFE) {
      ctx.globalAlpha = FLASH_ALPHA * (1 - k / FLASH_LIFE)
      ctx.beginPath()
      ctx.arc(c.x, c.y, FLASH_R, 0, Math.PI * 2)
      ctx.fill()
    }
    // 2. THE WAVE.
    ctx.globalAlpha = WAVE_ALPHA * (1 - k)
    ctx.lineWidth = WAVE_START_W + (WAVE_END_W - WAVE_START_W) * k
    ctx.beginPath()
    ctx.arc(c.x, c.y, WAVE_START_R + WAVE_SPREAD * k, 0, Math.PI * 2)
    ctx.stroke()
    // 3. THE SHARDS — they leave with the wave and fade earlier than it (the square of the
    // time), so that the end of the effect is a ring alone and not a sun that erases.
    ctx.globalAlpha = SHARD_ALPHA * (1 - k) * (1 - k)
    ctx.lineWidth = SHARD_W
    const r0 = SHARD_INNER + WAVE_SPREAD * k
    ctx.beginPath()
    for (let i = 0; i < SHARD_COUNT; i++) {
      const a = (i * 2 * Math.PI) / SHARD_COUNT
      const cos = Math.cos(a)
      const sin = Math.sin(a)
      ctx.moveTo(c.x + cos * r0, c.y + sin * r0)
      ctx.lineTo(c.x + cos * (r0 + SHARD_LEN), c.y + sin * (r0 + SHARD_LEN))
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}
