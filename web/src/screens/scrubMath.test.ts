import { expect, it } from 'vitest'
import { clampUnit, fractionAtFrame, frameAt } from './scrubMath'

it('clamps a bar fraction into [0, 1]', () => {
  expect(clampUnit(0)).toBe(0)
  expect(clampUnit(0.5)).toBe(0.5)
  expect(clampUnit(1)).toBe(1)
  expect(clampUnit(-0.2)).toBe(0)
  expect(clampUnit(1.7)).toBe(1)
  expect(clampUnit(Number.NaN)).toBe(0)
})

it('maps a bar position to the frame under it, clamped', () => {
  expect(frameAt(0, 1201)).toBe(0)
  expect(frameAt(1, 1201)).toBe(1200)
  expect(frameAt(0.5, 1201)).toBe(600)
  expect(frameAt(0.37, 1201)).toBe(Math.round(0.37 * 1200))
  expect(frameAt(-1, 1201)).toBe(0)
  expect(frameAt(2, 1201)).toBe(1200)
  expect(frameAt(0.5, 1)).toBe(0)
  expect(frameAt(0.5, 0)).toBe(0)
})

it('maps a frame back to its bar position', () => {
  expect(fractionAtFrame(0, 1201)).toBe(0)
  expect(fractionAtFrame(1200, 1201)).toBe(1)
  expect(fractionAtFrame(600, 1201)).toBeCloseTo(0.5, 10)
  expect(fractionAtFrame(-5, 1201)).toBe(0)
  expect(fractionAtFrame(9999, 1201)).toBe(1)
  expect(fractionAtFrame(0, 1)).toBe(0)
})

it('round-trips position to frame and back without drift past a half step', () => {
  for (const frameCount of [1, 2, 60, 1201, 76000]) {
    const last = Math.max(0, frameCount - 1)
    for (let i = 0; i <= 20; i++) {
      const frame = frameAt(i / 20, frameCount)
      // The frame is quantized to integer steps of 1/last; the round trip drifts by at
      // most half a step.
      expect(Math.abs(fractionAtFrame(frame, frameCount) - i / 20)).toBeLessThanOrEqual(0.5 / last + 1e-9)
    }
  }
})
