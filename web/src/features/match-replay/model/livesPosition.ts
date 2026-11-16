/**
 * livesPosition.ts — THE SINGLE writing of the block « position of a player at a frame ».
 *
 * WHAT THIS MODULE CENTRALIZES. Re-reading the position of a player at a given frame requires
 * four pieces, all here: the POST-DEATH WINDOW (`KILLPOS_WINDOW_MS`, then
 * `deathWindowFrames` which converts it to frames), the INDEX of lives per player
 * (`buildLivesByXuid`), the RE-READING itself (`posOfPlayerAt`) and its assembly on a
 * document (`buildPlayerPosAt`). This block was copied in four hooks and two pure builders;
 * rule no. 6 of the repo: at the third copy one centralizes, and the guard-rail
 * (`livesPosition.guard.test.ts`) forbids the re-divergence.
 *
 * THE PRIMITIVE WAS REPATRIATED FROM `killFx.ts` ON 2026-09-05, AND THE « ALLOWED TWIN
 * COPY » NO LONGER EXISTS. `posOfPlayerAt` and `KILLPOS_WINDOW_MS` lived in killFx.ts,
 * which forced this module to import it — and therefore forbade killFx.ts from importing
 * this one (cycle). killFx.ts accordingly maintained there its own copy of the index and
 * of the window, duly allowlisted. By moving the primitive to its canonical module, the
 * cycle disappears, the copy with it, and the allowlist of the guard-rail falls back to TWO entries.
 *
 * THE POST-DEATH WINDOW is part of the block, not an option: a bomb planter often dies
 * IN his explosion, a carrier drops on his death — without it, the best-dated event of the
 * match would lose its position.
 *
 * IT IS THE BIPED'S POSITION, AND IT IS NO LONGER THE FINAL WORD. An embarked player no
 * longer replicates his world position: the re-reading below then interpolates in a straight line through
 * the scenery. The production readers therefore go through `carrierPosition.ts`
 * (`useCarrierPosAt` / `buildCarrierPosAt`), which places the vehicle on top of this fallback. This
 * module stays the re-reading OF THE BIPED, written once — it knows no vehicle.
 */

import { isAliveAt, msToFrames, positionAt, trackWindow, type XY } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady, ReplayTrackReady } from '../../../lib/replay/replayNormalize'

/**
 * Acceptance window of a LAST position after the end of a life, in ms. The victim,
 * by construction, has just died — his track is closed, his last position stays true.
 *
 * IT IS WORTH THE ORIGINAL DEATH WINDOW (1.5 s) BUT NO LONGER DEPENDS ON IT: the death cross
 * went to 2.5 s on 2026-08-18, this one did not. These are two different questions — how long a
 * marker stays READABLE on one side, up to where a position stays TRUE on the other — and
 * linking them would move the second with every screen setting of the first.
 */
export const KILLPOS_WINDOW_MS = 1_500

/** The position re-read, as `posOfPlayerAt` renders it. */
export type PlayerPosAt = (xuid: string, frame: number) => XY | null

/**
 * posOfPlayerAt — position of a player at a frame, re-read in his trajectories.
 *
 * POC's `posOfNameAt` pattern: a LIVING life at this frame renders its position; otherwise one
 * accepts the LAST position of a life closed for less than `deathFrames` — that is the case
 * of the victim, by construction. Beyond: null, no position invented.
 */
export function posOfPlayerAt(
  lives: ReplayTrackReady[] | undefined,
  frame: number,
  deathFrames: number,
): XY | null {
  if (!lives || lives.length === 0) return null
  for (const l of lives) {
    if (isAliveAt(l, frame)) {
      const p = positionAt(l.points, frame)
      if (p) return p
    }
  }
  let best: ReplayTrackReady | null = null
  let bestD = Number.POSITIVE_INFINITY
  for (const l of lives) {
    const d = frame - trackWindow(l).end
    if (d >= 0 && d <= deathFrames && d < bestD) {
      bestD = d
      best = l
    }
  }
  if (!best) return null
  const last = best.points[best.points.length - 1]
  return last ? { x: last.x, y: last.y } : null
}

/** buildLivesByXuid — the index of lives per player, built ONCE per document. */
export function buildLivesByXuid(tracks: readonly ReplayTrackReady[]): Map<string, ReplayTrackReady[]> {
  const map = new Map<string, ReplayTrackReady[]>()
  for (const t of tracks) {
    if (!t.xuid) continue
    const list = map.get(t.xuid)
    if (list) list.push(t)
    else map.set(t.xuid, [t])
  }
  return map
}

/**
 * buildLivesBySlot — the index of lives per SLOT, built ONCE per document.
 *
 * WHY BY SLOT AND NOT BY XUID (register 2026-09-05, K1). The EFFECTS attached to a gesture
 * — muzzle flash, shooter's « ! », grapple cable, thruster dash — are dated by
 * the film with a SLOT number, not an xuid: it is the biped's life that shoots, and the same
 * player has several of them. This index was rewritten byte for byte in the four layers
 * concerned; it now has only one writing.
 */
export function buildLivesBySlot(
  tracks: readonly ReplayTrackReady[],
): Map<number, ReplayTrackReady[]> {
  const map = new Map<number, ReplayTrackReady[]>()
  for (const t of tracks) {
    const lives = map.get(t.slot)
    if (lives) lives.push(t)
    else map.set(t.slot, [t])
  }
  return map
}

/**
 * lifeOfSlotAt — THE LIFE of a slot that covers a given frame, or `undefined`.
 *
 * TAKING THE FIRST THAT COMES WOULD BE A FAULT, and that is the whole point of this function: a
 * player has several lives in the film, and reading the gaze or the position of the WRONG life
 * places the gesture elsewhere on the map. A slot without a life at that instant renders nothing — never
 * a neighboring life.
 */
export function lifeOfSlotAt(
  bySlot: ReadonlyMap<number, ReplayTrackReady[]>,
  slot: number,
  frame: number,
): ReplayTrackReady | undefined {
  return (bySlot.get(slot) ?? []).find((l) => isAliveAt(l, frame))
}

/**
 * soundPositionOfSlot — the place of a SLOT's gesture at a frame, for a sound event, WITH THE
 * FOLLOWED PLAYER'S OWN EXEMPTION BUILT IN: `undefined` when the slot has no life at that frame
 * (nothing invented), AND `undefined` when the life belongs to `followed` — the followed
 * player's own gestures stay WITHOUT A PLACE, full and centered (`placeOf`), whatever the
 * camera (first person, third person, free): the audio perspective follows the FOLLOWED LIFE,
 * never the rendered camera transform. Every OTHER life gets its map position, for the
 * spatial fall-off (`soundSpatial.ts`).
 *
 * `followed === null` (no followed player, e.g. a 2D export) places EVERY life — there is then no
 * "own" to exempt.
 */
export function soundPositionOfSlot(
  bySlot: ReadonlyMap<number, ReplayTrackReady[]>,
  slot: number,
  frame: number,
  followed: string | null,
): { x: number; y: number } | undefined {
  const life = lifeOfSlotAt(bySlot, slot, frame)
  if (!life) return undefined
  if (followed !== null && life.xuid === followed) return undefined
  const p = positionAt(life.points, frame)
  return p ? { x: p.x, y: p.y } : undefined
}

/** deathWindowFrames — the post-death window in frames (at least one). */
export function deathWindowFrames(doc: ReplayDocumentReady): number {
  return Math.max(1, Math.round(msToFrames(KILLPOS_WINDOW_MS, doc)))
}

/** buildPlayerPosAt — the pure re-reading, for the builders outside React. */
export function buildPlayerPosAt(doc: ReplayDocumentReady): PlayerPosAt {
  const lives = buildLivesByXuid(doc.tracks)
  const window = deathWindowFrames(doc)
  return (xuid, frame) => posOfPlayerAt(lives.get(xuid), frame, window)
}
