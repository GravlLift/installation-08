// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** cameraWeight3d.test.ts — the camera weight's spring: its step response, lag and the convolution. */
import { describe, expect, it } from 'vitest'
import { CAMERA_WEIGHT_DAMPING, CAMERA_WEIGHT_WINDOW, springApply, springLag, springOf, springStep } from './cameraWeight3d'

/** springApply over one component: `x(age)` sampled at ages 0, dt, 2 dt, … back to the window. */
function apply(settleS: number, x: (ageS: number) => number, dt = 1 / 120): number {
  const n = Math.ceil((CAMERA_WEIGHT_WINDOW * settleS) / dt) + 1
  const taus: number[] = []
  const values: number[] = []
  for (let j = 0; j < n; j++) {
    taus.push(j * dt)
    values.push(x(j * dt), 0, 0)
  }
  const out = [0, 0, 0]
  springApply(springOf(settleS), taus, values, n, 3, 0, out)
  return out[0]
}

describe('the spring', () => {
  it('overshoots a step by under 3% (about 0.6% at damping 0.85) and settles by the weight', () => {
    for (const T of [0.15, 0.5, 2]) {
      const spring = springOf(T)
      let peak = 0
      for (let i = 0; i <= 3000; i++) peak = Math.max(peak, springStep(spring, (i / 1000) * T * 3))
      expect(peak).toBeGreaterThan(1) // slightly underdamped: it does overshoot
      expect(peak - 1).toBeLessThan(0.03)
      expect(peak - 1).toBeCloseTo(Math.exp((-CAMERA_WEIGHT_DAMPING * Math.PI) / Math.sqrt(1 - CAMERA_WEIGHT_DAMPING ** 2)), 4)
      // Within 2% from 0.9 T on, within 0.5% at T.
      for (let i = 0; i <= 100; i++) expect(Math.abs(1 - springStep(spring, T * (0.9 + (i / 100) * 2.1)))).toBeLessThan(0.02)
      expect(Math.abs(1 - springStep(spring, T))).toBeLessThan(0.005)
      // Still moving at half the weight: a heavy rig, not a snap.
      expect(springStep(spring, T / 4)).toBeLessThan(0.8)
    }
  })

  it('lags a ramp by zeta^2 T / 2 (its lag integral)', () => {
    for (const T of [0.2, 1, 3]) {
      expect(springLag(springOf(T), 1e6)).toBeCloseTo((CAMERA_WEIGHT_DAMPING ** 2 * T) / 2, 12)
      // A path moving at 10 u/s: the spring's output sits 10 * lag behind the present.
      expect(apply(T, (age) => 100 - 10 * age)).toBeCloseTo(100 - (10 * CAMERA_WEIGHT_DAMPING ** 2 * T) / 2, 3) // the window's tail: under 1e-4 u
    }
  })

  it('gives exactly a still path', () => {
    expect(apply(0.7, () => 12.345)).toBe(12.345)
    expect(apply(0.01, () => -3.5)).toBe(-3.5)
  })

  it('follows a step the way the step response does', () => {
    const T = 0.5
    const spring = springOf(T)
    // The path jumped from 0 to 1 at an age of `since` seconds (one grid interval of ramp).
    let prev = -Infinity
    for (let ms = 0; ms <= 1500; ms += 5) {
      const since = ms / 1000
      const y = apply(T, (age) => (age <= since ? 1 : 0))
      expect(Math.abs(y - springStep(spring, since))).toBeLessThan(0.02)
      expect(y).toBeLessThan(1.03)
      // Monotone on the way up; past the target only the small overshoot's return.
      if (prev < 0.999) expect(y).toBeGreaterThanOrEqual(prev)
      else expect(y).toBeGreaterThan(0.99)
      prev = y
    }
    expect(Math.abs(prev - 1)).toBeLessThan(1e-3)
  })
})
