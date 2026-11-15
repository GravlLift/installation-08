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

/**
 * firstSpawnFrame returns the earliest life opening of any track, bounded to the film
 * ([0, frameCount - 1]); 0 when no track has a point.
 */
export function firstSpawnFrame(doc: { frameCount: number; tracks: readonly StartTrack[] }): number {
  let first = Infinity
  for (const tr of doc.tracks) {
    if (!tr.points || tr.points.length === 0) continue
    const t0 = tr.startFrame ?? tr.points[0].t
    if (Number.isFinite(t0) && t0 < first) first = t0
  }
  if (!Number.isFinite(first)) return 0
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
