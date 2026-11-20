// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * cameraWeight3d.ts — the camera's weight (docs/design/camera-scripts.md, `weight`): the response of
 * a second-order spring, the lag, settle and slight overshoot of a camera on a heavy rig, applied
 * to a scripted path WITHOUT frame-to-frame state.
 *
 * The spring's output at time t is the convolution of its input (the scripted path) with its
 * impulse response over a finite window back from t, so it is a pure function of t: exports that
 * render frames out of order, motion-blur subframes, scrubbing and freezes all see the same pose.
 * The input is taken as piecewise LINEAR between knots (the pose at t itself, then the path's
 * samples on an absolute grid going back), and the convolution of a linear piece with the impulse
 * response has a closed form: with `C(τ) = 1 - S(τ)` the complement of the step response and
 * `Q(τ) = ∫₀^τ C`, the output is
 *
 *   y(t) = x₀ + Σᵢ (xᵢ₊₁ - xᵢ) · (Q(τᵢ₊₁) - Q(τᵢ)) / (τᵢ₊₁ - τᵢ)
 *
 * for knots at τ₀ = 0 < τ₁ < … (seconds back from t), the input held at its oldest knot beyond.
 * The kernel's total weight is exactly 1 by construction: a still input gives exactly that input
 * (every difference is zero), and a ramp of speed v lags by `v · Q(∞)` = `v · ζ² · T / K`.
 */

/** The spring's damping ratio: very slightly underdamped, a step overshoots by about 0.6%. */
export const CAMERA_WEIGHT_DAMPING = 0.85
/**
 * The settle constant: a weight of T seconds is a spring whose envelope decays as `exp(-K τ / T)`
 * (ζ ω_n = K / T, the textbook 2% settling time 4 / (ζ ω_n)). A step is within 2% of its target
 * by about 0.9 T and within 0.4% at T.
 */
export const CAMERA_WEIGHT_SETTLE_K = 4
/**
 * How far back the convolution looks, in settle times: beyond 3 T the kernel's remaining weight
 * is under 1e-5 (exp(-12) times a small factor), and the input is held at its oldest knot.
 */
export const CAMERA_WEIGHT_WINDOW = 3
/**
 * The path's finest sample grid (script ms, 120 Hz), absolute so neighboring frames share samples.
 * A long weight samples a coarser grid of power-of-two multiples of it (`gridLevel`, in
 * `cameraScript3d`), keeping at least CAMERA_WEIGHT_STEPS_PER_SETTLE steps in one settle time.
 */
export const CAMERA_WEIGHT_STEP_MS = 1000 / 120
export const CAMERA_WEIGHT_STEPS_PER_SETTLE = 8
/** A settle time below this (seconds) is no spring at all: the scripted path is used as is. */
export const CAMERA_WEIGHT_MIN_S = 1e-3

/** One spring's constants for a settle time T (seconds). */
export interface Spring {
  sigma: number
  omegaD: number
  omegaN2: number
}

export function springOf(settleS: number): Spring {
  const zeta = CAMERA_WEIGHT_DAMPING
  const sigma = CAMERA_WEIGHT_SETTLE_K / settleS
  const omegaN = sigma / zeta
  return { sigma, omegaD: omegaN * Math.sqrt(1 - zeta * zeta), omegaN2: omegaN * omegaN }
}

/** The spring's step response S(τ) (0 at τ = 0, 1 at rest) at τ seconds after a unit step. */
export function springStep(spring: Spring, tauS: number): number {
  if (tauS <= 0) return 0
  const { sigma, omegaD } = spring
  const e = Math.exp(-sigma * tauS)
  return 1 - e * (Math.cos(omegaD * tauS) + (sigma / omegaD) * Math.sin(omegaD * tauS))
}

/** Q(τ) = ∫₀^τ (1 - S): the lag accumulated over τ seconds (Q(∞) = 2 ζ / ω_n). */
export function springLag(spring: Spring, tauS: number): number {
  const { sigma, omegaD, omegaN2 } = spring
  const e = Math.exp(-sigma * tauS)
  const c = Math.cos(omegaD * tauS)
  const s = Math.sin(omegaD * tauS)
  return (2 * sigma - 2 * e * sigma * c + e * s * (omegaD - (sigma * sigma) / omegaD)) / omegaN2
}

/**
 * springApply: the spring's output for three components of a path given at `n` knots.
 * `taus[j]` is knot j's age in seconds (taus[0] = 0, strictly increasing); `values` holds `stride`
 * numbers per knot, the three components at `offset`. Writes the output into `out[0..2]`. A
 * still path returns exactly knot 0's values.
 */
export function springApply(
  spring: Spring,
  taus: ArrayLike<number>,
  values: ArrayLike<number>,
  n: number,
  stride: number,
  offset: number,
  out: number[],
): void {
  let x = values[offset]
  let y = values[offset + 1]
  let z = values[offset + 2]
  let qPrev = 0
  for (let j = 0; j + 1 < n; j++) {
    const q = springLag(spring, taus[j + 1])
    const g = (q - qPrev) / (taus[j + 1] - taus[j])
    qPrev = q
    const i0 = j * stride + offset
    const i1 = i0 + stride
    x += (values[i1] - values[i0]) * g
    y += (values[i1 + 1] - values[i0 + 1]) * g
    z += (values[i1 + 2] - values[i0 + 2]) * g
  }
  out[0] = x
  out[1] = y
  out[2] = z
}
