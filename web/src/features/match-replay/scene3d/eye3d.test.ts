// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** eye3d.test.ts — the eye's drop: fade in on entry, fade out on exit, posture merging. */
import { describe, expect, it } from 'vitest'

import { CROUCH_DROP } from './body3d'
import { EYE_IN_DURATION, EYE_OUT_DURATION, eyeDrop, mergeIntervals, NO_INTERVALS } from './eye3d'

const FPS = 10
const E = EYE_IN_DURATION * FPS // 2 frames
const X = EYE_OUT_DURATION * FPS // 2.5 frames

describe('mergeIntervals', () => {
  it('merges spans that touch or overlap, without changing the union\'s bounds', () => {
    expect(mergeIntervals([{ t0: 15, end: 20 }, { t0: 10, end: 15 }])).toEqual([{ t0: 10, end: 20 }])
    expect(mergeIntervals([{ t0: 10, end: 15 }, { t0: 14, end: 20 }])).toEqual([{ t0: 10, end: 20 }])
    expect(mergeIntervals([{ t0: 10, end: 15 }, { t0: 20, end: 25 }])).toEqual([{ t0: 10, end: 15 }, { t0: 20, end: 25 }])
    expect(mergeIntervals([])).toEqual([])
  })
})

describe('eyeDrop', () => {
  const crouched = [{ t0: 10, end: 20 }]
  const standing = (f: number) => eyeDrop(NO_INTERVALS, f, E, X)
  const d = (f: number) => eyeDrop(crouched, f, E, X)

  it('standing: 0, before and after the span as without a span', () => {
    expect(d(9.9)).toBe(0)
    expect(d(20 + X)).toBe(0)
    expect(d(20 + X + 100)).toBe(0)
    expect(standing(15)).toBe(0)
  })

  it('crouched: the full drop, crouching as in a slide', () => {
    expect(d(15)).toBe(CROUCH_DROP)
    expect(d(20)).toBe(CROUCH_DROP) // the end of the span: the fade-out starts after
  })

  it('midway through the fade-in: half (the smoothstep\'s midpoint)', () => {
    expect(d(10 + E / 2)).toBeCloseTo(CROUCH_DROP / 2, 12)
  })

  it('after the end: back to 0 over the exit time', () => {
    expect(d(20 + X / 2)).toBeCloseTo(CROUCH_DROP / 2, 12)
    expect(d(20 + X)).toBe(0)
    expect(d(20 + X - 0.01)).toBeGreaterThan(0)
  })

  it('a slide that starts when the crouch ends holds the full drop at the junction', () => {
    const junction = mergeIntervals([{ t0: 10, end: 15 }, { t0: 15, end: 25 }])
    expect(eyeDrop(junction, 15, E, X)).toBe(CROUCH_DROP)
    expect(eyeDrop(junction, 14.99, E, X)).toBe(CROUCH_DROP)
    expect(eyeDrop(junction, 24.99, E, X)).toBe(CROUCH_DROP)
  })

  it('a 50 ms span never exceeds what its fade-in reached, with no jump', () => {
    const short = [{ t0: 10, end: 10.5 }] // 50 ms at 10 frames/s: 0.5 frame
    for (let f = 10; f <= 10 + 0.5 + X; f += 0.01) {
      const v = eyeDrop(short, f, E, X)
      const entry = f < 10 ? 0 : f > 10 + E ? 1 : ((f - 10) / E) ** 2 * (3 - 2 * (f - 10) / E)
      expect(v).toBeLessThanOrEqual(CROUCH_DROP * entry + 1e-12)
      expect(v).toBeLessThan(CROUCH_DROP)
    }
    // Continuity: no jump larger than a fade step over a 0.01-frame step.
    let previous = eyeDrop(short, 10, E, X)
    for (let f = 10.01; f <= 10 + 0.5 + X; f += 0.01) {
      const v = eyeDrop(short, f, E, X)
      expect(Math.abs(v - previous)).toBeLessThan(0.01)
      previous = v
    }
  })

  it('the same frame gives the same drop forward as backward', () => {
    const frames = [0, 5, 10.2, 11, 14.99, 20, 22, 22.5, 40]
    const forward = frames.map((f) => d(f))
    const backward = [...frames].reverse().map((f) => d(f))
    expect(backward).toEqual([...forward].reverse())
  })

  it('several spans: the envelope is the highest of the tails and the entries', () => {
    const two = mergeIntervals([{ t0: 10, end: 12 }, { t0: 13, end: 23 }])
    // The first span (2 frames) equals the fade-in: at the midpoint, half.
    expect(eyeDrop(two, 11, E, X)).toBeCloseTo(CROUCH_DROP / 2, 12)
    // The first span's exit tail still covers the start of the second: it is the one that holds.
    expect(eyeDrop(two, 12.5, E, X)).toBeCloseTo(CROUCH_DROP * (1 - 0.104), 12)
    expect(eyeDrop(two, 13.5, E, X)).toBeCloseTo(CROUCH_DROP * (1 - 0.648), 12)
    expect(eyeDrop(two, 20, E, X)).toBe(CROUCH_DROP)
  })
})
