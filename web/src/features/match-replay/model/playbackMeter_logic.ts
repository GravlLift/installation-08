// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * playbackMeter_logic.ts — the film's playback rate, measured on the 3D view's render loop.
 *
 * Pure module (neither React nor three.js). The loop records each drawn frame (wall-clock time and
 * the film frame it showed) into a fixed ring, without allocating; the corner meter reads it four
 * times a second over the last second:
 *  - displayed frames per second (what the screen actually shows of the film),
 *  - frame time, average and worst,
 *  - the real-time ratio: film seconds advanced per wall-clock second (the playback loop advances
 *    the film by wall-clock time, `usePlaybackLoop`, so a slow render skips film frames rather than
 *    slowing the film: the ratio stays at the playback speed and the displayed rate drops).
 */

/** The ring's size: more than one second of frames at 240 frames/s. */
const RING = 512
/** The window the reading covers (ms). */
export const METER_WINDOW_MS = 1000
/** A larger gap between two frames: the tab was hidden or the view stopped, the window restarts. */
const GAP_MS = 1000
/** The weight of a new measurement in the smoothed script time. */
const SCRIPT_SMOOTHING = 0.1

export interface PlaybackMeter {
  times: Float64Array
  frames: Float64Array
  /** The next slot written. */
  head: number
  /** How many slots hold a sample of the current run (at most `RING`). */
  count: number
  /** The script time of one frame (scene setup and draw submission), smoothed, in ms. */
  scriptMs: number
}

export function newPlaybackMeter(): PlaybackMeter {
  return { times: new Float64Array(RING), frames: new Float64Array(RING), head: 0, count: 0, scriptMs: 0 }
}

/** recordFrame notes a drawn frame at `nowMs` showing film frame `filmFrame` (fractional). */
export function recordFrame(m: PlaybackMeter, nowMs: number, filmFrame: number): void {
  if (m.count > 0) {
    const last = m.times[(m.head - 1 + RING) % RING]
    if (!(nowMs > last) || nowMs - last > GAP_MS) m.count = 0
  }
  m.times[m.head] = nowMs
  m.frames[m.head] = filmFrame
  m.head = (m.head + 1) % RING
  m.count = Math.min(m.count + 1, RING)
}

/** recordScript notes one frame's script time (ms) into the smoothed average. */
export function recordScript(m: PlaybackMeter, ms: number): void {
  if (!(ms >= 0)) return
  m.scriptMs += (ms - m.scriptMs) * SCRIPT_SMOOTHING
}

export interface PlaybackReading {
  /** Frames drawn per second over the window. */
  displayedFps: number
  /** Average and worst time between two drawn frames (ms). */
  frameMsAvg: number
  frameMsWorst: number
  /** Film seconds advanced per wall-clock second: 1 at normal speed in real time, 0 paused. */
  realtime: number
  /** Smoothed script time per frame (ms). */
  scriptMs: number
}

/**
 * readPlayback reads the last `METER_WINDOW_MS` of frames for a film of `filmFps` frames per
 * second; null with fewer than two intervals, or when the last frame is older than the gap at
 * `nowMs` (the loop stopped).
 */
export function readPlayback(m: PlaybackMeter, filmFps: number, nowMs: number): PlaybackReading | null {
  if (m.count < 3) return null
  const latest = (m.head - 1 + RING) % RING
  const tLatest = m.times[latest]
  if (nowMs - tLatest > GAP_MS) return null
  let oldest = latest
  let worst = 0
  let intervals = 0
  for (let k = 1; k < m.count; k++) {
    const i = (latest - k + RING) % RING
    if (tLatest - m.times[i] > METER_WINDOW_MS) break
    const dt = m.times[oldest] - m.times[i]
    if (dt > worst) worst = dt
    oldest = i
    intervals++
  }
  if (intervals < 2) return null
  const span = tLatest - m.times[oldest]
  const film = m.frames[latest] - m.frames[oldest]
  return {
    displayedFps: (intervals * 1000) / span,
    frameMsAvg: span / intervals,
    frameMsWorst: worst,
    realtime: filmFps > 0 ? film / filmFps / (span / 1000) : 0,
    scriptMs: m.scriptMs,
  }
}
