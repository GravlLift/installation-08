// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * playbackStart — WHERE PLAYBACK BEGINS: the frame where the first player spawns.
 *
 * The film opens before anyone is on the map (the players are still loading in), and playing
 * from frame zero showed an empty, silent scene for that stretch. Playback now begins at the
 * first spawn instead. Nothing else moves: the timeline, the match clock and the export bounds
 * still cover the whole film, and the user can scrub back to frame zero.
 *
 * A spawn is the opening of a life, read exactly as the 3D tracks read it (`tracks3d.ts`,
 * `prepareLife`): the track's `startFrame` when published, otherwise its first point. Every
 * track counts, bots included (they have no xuid, but they are on the map).
 */
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'

type StartTrack = Pick<ReplayDocumentReady['tracks'][number], 'startFrame' | 'points'>

/** How far a player must move from where their life opened to count as the match having begun (game units). */
const MOVE_THRESHOLD = 0.05

/** How long before the first movement playback begins, so the start is not cut on the first step. */
const LEAD_FRAMES = 30

/**
 * firstMoveFrame returns the earliest frame at which any player has moved from where their life
 * opened, or null when nobody ever moves. Players are on the map, frozen, for the whole pre-match
 * stretch (about 22 s on Live Fire abb84d42: every track opens at frame 0..2, the first steps are at
 * frame 679), so the first spawn alone does not cut that stretch.
 */
export function firstMoveFrame(doc: { tracks: readonly StartTrack[] }): number | null {
  let first = Infinity
  for (const tr of doc.tracks) {
    const pts = tr.points
    if (!pts || pts.length < 2) continue
    const { x: x0, y: y0 } = pts[0]
    for (const p of pts) {
      if (p.t >= first) break
      if (Math.abs(p.x - x0) + Math.abs(p.y - y0) > MOVE_THRESHOLD) { first = p.t; break }
    }
  }
  return Number.isFinite(first) ? first : null
}

/**
 * firstSpawnFrame returns where playback begins: a second before the first player moves, never
 * before the earliest life opening of any track; bounded to the film ([0, frameCount - 1]); 0 when
 * no track has a point.
 */
export function firstSpawnFrame(doc: { frameCount: number; tracks: readonly StartTrack[] }): number {
  let first = Infinity
  for (const tr of doc.tracks) {
    if (!tr.points || tr.points.length === 0) continue
    const t0 = tr.startFrame ?? tr.points[0].t
    if (Number.isFinite(t0) && t0 < first) first = t0
  }
  if (!Number.isFinite(first)) return 0
  const moved = firstMoveFrame(doc)
  if (moved !== null) first = Math.max(first, moved - LEAD_FRAMES)
  return Math.min(Math.max(Math.round(first), 0), Math.max(doc.frameCount - 1, 0))
}

/**
 * atPlaybackStart says whether the cursor sits at (or before) the start of playback: the
 * departure the intro music belongs to. A cursor scrubbed back into the pre-spawn stretch
 * counts as the start too.
 */
export function atPlaybackStart(frame: number, startFrame: number): boolean {
  return frame <= startFrame
}
