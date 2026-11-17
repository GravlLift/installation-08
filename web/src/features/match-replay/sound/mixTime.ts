// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * mixTime.ts — moving a time of the clip into a context that starts later, WITHOUT moving it by a
 * rounding error.
 *
 * An offline context turns every time it is given (a start, a stop, an automation event) into a
 * frame position, `time * sampleRate`, in doubles. The whole-track render gives it the clip time
 * `t`; a context that starts at the clip's second `originS` must be given a time whose frame
 * position is exactly the same one minus the origin's frames. Plain `t - originS` is not enough:
 * `3.2 - 3` is `0.20000000000000018`, and `0.20000000000000018 * 48000` is past frame 9600 where
 * `3.2 * 48000` is exactly frame 153600. A start or a gain step then lands one frame late, and a
 * source's first sample, or the frame where its fade-in begins, differs from the whole-track
 * render.
 *
 * `shiftedTime` therefore returns, among the doubles next to `t - originS`, the one whose frame
 * position is the reference's minus the origin's frames, or, when no double lands exactly there,
 * the one just before it (a few trillionths of a frame early, never late). A start or an
 * automation event takes effect at the first frame at or after its position, so "never late by
 * a whole frame, never past it" keeps it on the reference's frame.
 */

/** The double right after `x` (toward +Infinity), or right before it (`dir = -1`). */
function nextDouble(x: number, dir: 1 | -1): number {
  if (x === 0) return dir * Number.MIN_VALUE
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, x)
  const bits = view.getBigInt64(0)
  view.setBigInt64(0, bits + BigInt((x > 0) === (dir > 0) ? 1 : -1))
  return view.getFloat64(0)
}

/**
 * shiftedTime gives the time to hand a context whose time 0 is the clip's `originS` (a whole
 * second), for the clip time `t`, so that `result * sampleRate` is exactly
 * `t * sampleRate - originS * sampleRate`. With `originS = 0` it is `t` itself, untouched.
 */
export function shiftedTime(t: number, originS: number, sampleRate: number): number {
  if (originS === 0 || !Number.isFinite(t)) return t - originS
  // The reference's frame position, minus a whole number of frames: exact in doubles.
  const target = t * sampleRate - originS * sampleRate
  const plain = t - originS
  if (plain * sampleRate === target) return plain
  // The closest candidate at or before the target: the doubles around `target / sampleRate`.
  let best = Number.NaN
  let bestAt = -Infinity
  const consider = (x: number) => {
    const at = x * sampleRate
    if (at <= target && at > bestAt) {
      best = x
      bestAt = at
    }
  }
  consider(plain)
  const mid = target / sampleRate
  consider(mid)
  for (const dir of [1, -1] as const) {
    let x = mid
    for (let step = 0; step < 4; step++) {
      x = nextDouble(x, dir)
      consider(x)
    }
  }
  return Number.isNaN(best) ? plain : best
}
