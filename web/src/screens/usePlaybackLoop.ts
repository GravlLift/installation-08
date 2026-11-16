/**
 * usePlaybackLoop — advances the playback frame once per animation frame while `playing`, at
 * `speed` of `fps`, until the document's last frame.
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
  onEnded?: () => void
}

export function usePlaybackLoop({ doc, playing, speed, fps, frameRef, setFrame, setPlaying, tick, onEnded }: PlaybackLoopDeps): void {
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const step = (now: number) => {
      const deltaFrames = ((now - last) / 1000) * fps * speed
      last = now
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
  }, [playing, speed, fps, doc.frameCount, frameRef, setFrame, setPlaying, tick, onEnded])
}
