/**
 * bombCountdown.ts — THE COUNTDOWN OF THE ASSAULT BOMB. Pure logic, no React.
 *
 * WHERE THE DATA COMES FROM. `doc.bombArmings` (schema 29): the ring of the `ti=12 i14` marker is
 * the arming gauge — protocol of 2026-09-01 with zero draw (13/13 Neutral Bomb CV 0.016,
 * 4/4 Husky Raid, 0/1000 zero draws as well). Each entry carries the ARMED instant (`t`) and
 * the FUSE (`fuseMs`, 4,930 ms on the Go side): the countdown window is [t, t + fuseMs],
 * nothing else is guessed.
 *
 * NO MODE GUARD HERE, and that is deliberate (same doctrine as `useReplayBombBlast`): the
 * guard IS the data. `bombArmings` is only published by a covered Assault match (never
 * One Bomb — the channel is refuted there, CV 0.725), and a film of another mode returns an empty list.
 *
 * THE CLOCK GUARD IS THE ONE OF THE BLAST (`filmClockTrusted`): `t` is a frame
 * of the document only if the film's origin is resolved. Otherwise the offset is UNKNOWN (3.6 to 50.8 s
 * depending on the match) and the countdown would start before the bomb is armed. Silent is
 * better than wrong.
 *
 * NO POSITION, AND THAT IS A PROPERTY OF THE MEASUREMENT: the navpoint is a screen marker,
 * not an actor — the channel says neither who arms nor where. The countdown is therefore a BANNER
 * (non-spatial overlay), never a point on the map: to place a location the measurement does not
 * give would be the error the blast already avoids.
 */
import { filmClockTrusted } from '@/lib/replay/scoreTimeline'

import { frameToMs, msToFrames } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { soundEvent, type ReplaySoundEvent } from '../sound/replaySoundVariants'
import { ZONE_SOUND_STEMS } from '../sound/zoneSound'

/** The state of the countdown at a given frame: what is left of the fuse, and the run. */
export interface BombCountdownState {
  /** Milliseconds remaining before the expected explosion (bounded at zero). */
  remainingMs: number
  /** Elapsed run of the fuse, 0 (armed) -> 1 (explosion) — for the bar. */
  progress: number
}

/**
 * activeBombCountdown — the countdown active at the read frame, or null.
 *
 * DERIVED FROM THE PLAYBACK POSITION, NOT FROM A STATE (doctrine of `ReplayRoundBreakOverlay`):
 * visible as long as the frame falls in [t, t + fuseMs], it plays again if one passes over it and
 * closes as soon as one leaves it. Two armings cannot overlap (the hold then the
 * fuse separates them by at least ~6 s) — the last one started wins by construction.
 */
export function activeBombCountdown(
  doc: ReplayDocumentReady,
  frame: number,
): BombCountdownState | null {
  if (doc.bombArmings.length === 0) return null
  if (!filmClockTrusted(doc)) return null
  for (const a of doc.bombArmings) {
    const fuseFrames = Math.max(1, Math.round(msToFrames(a.fuseMs, doc)))
    if (frame < a.t || frame > a.t + fuseFrames) continue
    const elapsedMs = frameToMs(frame, doc) - frameToMs(a.t, doc)
    return {
      remainingMs: Math.max(0, a.fuseMs - elapsedMs),
      progress: Math.min(1, elapsedMs / a.fuseMs),
    }
  }
  return null
}

/**
 * bombArmingSoundEvents — the sound of `bomb_armed`, one event per arming.
 *
 * THE STEM IS THE ONE OF THE NEW HILL (`ZONE_SOUND_STEMS.newZone`, designated by ear
 * by the user on 2026-08-27): user decision of the port — a sound accompanies the
 * start of the countdown, and the extracted Assault bank has no « armed bomb » gesture
 * of its own designated. Borrowed by REFERENCE, never copied: if the designation changes, it
 * changes for both at once. No camp — the channel does not say who arms, and this
 * sound asserts nothing (same property as the new hill).
 *
 * THE CLOCK ASKS FOR NO RESYNC: `t` is already the frame index of the document (the
 * origin subtraction is done on the Go side), the same `frameToMs` conversion as everywhere. The
 * clock guard lives on the caller side (`replaySound.ts` builds its events only on a
 * document from which it reads the frames) — and an empty `bombArmings` returns an empty list.
 */
export function bombArmingSoundEvents(doc: ReplayDocumentReady): ReplaySoundEvent[] {
  if (!filmClockTrusted(doc)) return []
  return doc.bombArmings.map((a) => soundEvent(frameToMs(a.t, doc), ZONE_SOUND_STEMS.newZone))
}
