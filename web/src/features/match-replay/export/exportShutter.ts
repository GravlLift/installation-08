// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * exportShutter.ts — WHERE THE SUBFRAMES OF A MOTION-BLURRED FILE FRAME SIT IN TIME.
 *
 * A film camera's shutter stays open for part of each frame interval, and what moves during that
 * time streaks. The offline export renders the same thing by accumulation: each file frame is the
 * average of N subframes spread across the shutter interval, centered on the frame's own time
 * (`ReplayExportScene3d.exportFrame` draws and averages them on the GPU). This module only says
 * WHEN each subframe is: a pure function of the plan, testable without a scene.
 *
 * Subframe k of N sits at `((k + 0.5) / N - 0.5) * (shutter / 360)` of a file frame interval from
 * the frame's time: centered, evenly spaced, and spanning the open share of the interval. N = 1 is
 * the frame itself (offset 0), which the export treats as "no blur" and never routes here.
 *
 * THE CENTER POSE. The camera track, the name tags and the HUD are the file frame's, not a
 * subframe's: they are read at the frame's exact time. With N odd the middle subframe is there;
 * with N even no subframe is, so a POSE-ONLY step (posed, never drawn) is inserted at the exact
 * center between the two middle subframes. Steps stay in time order either way, so the stateful
 * parts of the scene (the third-person spring arm eases by the time since the previous pose)
 * never run backward within a frame, nor from one frame to the next (the last subframe of frame
 * i is earlier than the first of frame i+1 for any shutter up to 360 degrees).
 */

/** The motion blur of an export: `subframes` per file frame over a shutter of `shutterDeg`. */
export interface MotionBlur {
  /** Subframes averaged per file frame (1 = off). */
  subframes: number
  /** The shutter angle in degrees: 360 is open the whole frame interval, 180 half of it. */
  shutterDeg: number
}

/** The most subframes a file frame may average (the URL's own bound, `autoExport.ts`). */
export const MOTION_BLUR_MAX_SUBFRAMES = 32
/** The default shutter angle: a film camera's classic half-open shutter. */
export const SHUTTER_DEFAULT_DEG = 180

/** One pose of a blurred file frame, in time order. */
export interface ShutterStep {
  /** The film frame posed (fractional). */
  frame: number
  /** The script time posed (camera-script export), null otherwise. */
  scriptMs: number | null
  /** Drawn and added to the frame's average; false for the pose-only center of an even count. */
  render: boolean
  /** The file frame's exact time: its camera and tags are the frame's (track, name tags, HUD). */
  center: boolean
}

/**
 * normalizeMotionBlur gives the blur an export runs with, or null when it is off: fewer than two
 * subframes or a closed shutter. Subframes are whole and at most `MOTION_BLUR_MAX_SUBFRAMES`; the
 * shutter is at most 360 degrees.
 */
export function normalizeMotionBlur(blur: MotionBlur | null | undefined): MotionBlur | null {
  if (!blur || !Number.isFinite(blur.subframes) || !Number.isFinite(blur.shutterDeg)) return null
  const subframes = Math.min(Math.floor(blur.subframes), MOTION_BLUR_MAX_SUBFRAMES)
  const shutterDeg = Math.min(blur.shutterDeg, 360)
  if (subframes < 2 || shutterDeg <= 0) return null
  return { subframes, shutterDeg }
}

/**
 * subframeOffsets: where each subframe sits, in FILE FRAME INTERVALS from the frame's time
 * (negative before it). Centered on 0, evenly spaced, spanning `shutterDeg / 360` of an interval.
 */
export function subframeOffsets(subframes: number, shutterDeg: number): number[] {
  const n = Math.max(1, Math.floor(subframes))
  const open = Math.min(Math.max(shutterDeg, 0), 360) / 360
  const out: number[] = []
  for (let k = 0; k < n; k++) out.push(((k + 0.5) / n - 0.5) * open)
  return out
}

/** stepsOf lays the subframes in time order, the center pose at its place (see the header). */
function stepsOf(
  offsets: readonly number[],
  at: (offset: number) => { frame: number; scriptMs: number | null },
  center: { frame: number; scriptMs: number | null },
): ShutterStep[] {
  const n = offsets.length
  const even = n % 2 === 0
  const steps: ShutterStep[] = []
  for (let k = 0; k < n; k++) {
    if (even && k === n / 2) steps.push({ ...center, render: false, center: true })
    // The odd count's middle subframe IS the center (offset exactly 0): posed from the frame's
    // own values, bit for bit, rather than recomputed from a zero offset.
    if (!even && k === (n - 1) / 2) steps.push({ ...center, render: true, center: true })
    else steps.push({ ...at(offsets[k]), render: true, center: false })
  }
  return steps
}

/**
 * scriptShutterSteps: the steps of a camera-script file frame at script time `sMs` (film frame
 * `frame`). Each subframe's script time is `sMs + offset * (1000 / fps)`, kept inside the script
 * (0 to `lengthMs`: the clock has no time outside it), and its film frame is where the script's
 * clock maps that time (`frameAt`, the plan's own conversion), so a slowed or frozen film blurs
 * by the film's motion and the camera by its own.
 */
export function scriptShutterSteps(
  sMs: number,
  frame: number,
  blur: MotionBlur,
  fps: number,
  lengthMs: number,
  frameAt: (sMs: number) => number,
): ShutterStep[] {
  const stepMs = 1000 / fps
  const end = Math.max(lengthMs, 0)
  return stepsOf(
    subframeOffsets(blur.subframes, blur.shutterDeg),
    (o) => {
      const s = Math.min(Math.max(sMs + o * stepMs, 0), end)
      return { frame: frameAt(s), scriptMs: s }
    },
    { frame, scriptMs: sMs },
  )
}

/**
 * planShutterSteps: the steps of file frame `i` of a plain (non-script) plan. The film frame is
 * interpolated across the step to the NEXT plan frame (the last frame uses the step from the
 * previous one). A step of zero (the held last frame, a range of one frame) has no motion: every
 * subframe is the frame itself, and the frame comes out sharp.
 */
export function planShutterSteps(frames: readonly number[], i: number, blur: MotionBlur): ShutterStep[] {
  const cur = frames[i]
  const span = i + 1 < frames.length ? frames[i + 1] - cur : i > 0 ? cur - frames[i - 1] : 0
  return stepsOf(
    subframeOffsets(blur.subframes, blur.shutterDeg),
    (o) => ({ frame: cur + o * span, scriptMs: null }),
    { frame: cur, scriptMs: null },
  )
}
