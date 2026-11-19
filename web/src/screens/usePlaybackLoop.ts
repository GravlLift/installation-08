// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * usePlaybackLoop — advances the playback frame once per animation frame while `playing`, at
 * `speed` of `fps`, until the document's last frame. A playing camera script (unit 3b) takes
 * over the frame: wall time (times the page speed) advances the script's clock, the film frame
 * follows the clock's document time, and the sound ticks only where the film runs at full rate.
 *
 * SCHEDULES EXACTLY ONE `requestAnimationFrame` PER TICK. Each tick must schedule at most one
 * more tick: scheduling twice (once unconditionally, once conditionally) doubles the number of
 * pending callbacks every real animation frame, a multiplicative explosion that looks like smooth
 * playback for several seconds — while the queue is still small, one tick's extra work is
 * imperceptible — and then freezes the tab solid once a tick's queue grows past what the browser
 * can drain in one frame budget (observed: a real playback session hung after ~12s of otherwise
 * normal third-person play, root-caused to this duplicate schedule, not to the camera mode or any
 * per-frame death/corpse/ragdoll code it was first suspected to be).
 */
import { useEffect } from 'react'

import { scriptDocFrame, scriptPlayback, setScriptPlaybackTime } from '../features/match-replay/scene3d/cameraScriptStore'
import type { CameraScript } from '../features/match-replay/scene3d/cameraScript3d'
import type { ReplayDocumentReady } from '../lib/replay/replayNormalize'

export interface PlaybackLoopDeps {
  doc: ReplayDocumentReady
  playing: boolean
  speed: number
  fps: number
  frameRef: { current: number }
  setFrame: (f: number) => void
  setPlaying: (p: boolean) => void
  tick?: (ms: number, frameMs: number) => void
  /** A sound JUMP (not a playback): used to re-place the cursor when full rate resumes after a silent stretch. */
  seek?: (ms: number) => void
  onEnded?: () => void
}

export function usePlaybackLoop({ doc, playing, speed, fps, frameRef, setFrame, setPlaying, tick, seek, onEnded }: PlaybackLoopDeps): void {
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    // The script's sound cursor: while the film runs at full rate it is in sync (ticks); after a
    // silent stretch or a new script it must be PLACED (seek), so the crossed time is not burst.
    let soundInSync = false
    let lastSeenScript: CameraScript | null = null
    const step = (now: number) => {
      const dt = now - last
      last = now
      const script = scriptPlayback()
      if (script !== null) {
        // A new script takes over: its first full-rate frame re-places the cursor, not a burst.
        if (script.script !== lastSeenScript) {
          soundInSync = false
          lastSeenScript = script.script
        }
        // The script drives the film: wall ms times the page speed (a preview multiplier) advance
        // the SCRIPT clock, clamped to the script's length; the film frame follows the clock's
        // document time.
        const sMs = Math.min(script.clock.lengthMs, Math.max(0, script.sMs + dt * speed))
        setScriptPlaybackTime(sMs)
        const frame = Math.min(doc.frameCount - 1, Math.max(0, scriptDocFrame(script, doc)))
        frameRef.current = frame
        // Sound is not time-stretched: it stays silent where the film runs at another rate (known
        // gap: sounds already scheduled ahead may still finish). Back to full rate, the cursor is
        // PLACED via seek on the first such frame (a jump, not a burst of the silent stretch); it
        // only ticks from the next full-rate frame on.
        const rate = script.clock.rateAt(sMs)
        if (rate === 1) {
          const docMs = script.clock.docMsAt(sMs)
          if (!soundInSync) {
            seek?.(docMs)
            soundInSync = true
          } else {
            tick?.(docMs, now)
          }
        } else {
          soundInSync = false
        }
        setFrame(Math.round(frame))
        if (sMs < script.clock.lengthMs) {
          raf = requestAnimationFrame(step)
        } else {
          // The script ends the playback, not the match: no onEnded (that plays the match-end
          // sound). The script stays loaded, holding its last pose.
          setPlaying(false)
        }
        return
      }
      const deltaFrames = (dt / 1000) * fps * speed
      const next = Math.min(doc.frameCount - 1, Math.max(0, (frameRef.current ?? 0) + deltaFrames))
      frameRef.current = next
      // The frame's timestamp travels with its moment: the sound schedules ahead from it.
      tick?.(next * 1000 / fps, now)
      setFrame(Math.round(next))
      // Exactly one of these two branches runs, and only the first one schedules another tick.
      if (next < doc.frameCount - 1) raf = requestAnimationFrame(step)
      else { setPlaying(false); onEnded?.() }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, fps, doc.frameCount, frameRef, setFrame, setPlaying, tick, seek, onEnded])
}
