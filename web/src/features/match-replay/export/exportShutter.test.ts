// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * exportShutter.test.ts — WHEN the subframes of a motion-blurred file frame are: centered on the
 * frame, spread over the shutter's share of the interval, in time order, with the frame's exact
 * center always among the poses (drawn for an odd count, pose-only for an even one).
 */
import { describe, expect, it } from 'vitest'

import {
  MOTION_BLUR_MAX_SUBFRAMES,
  normalizeMotionBlur,
  planShutterSteps,
  scriptShutterSteps,
  subframeOffsets,
  type ShutterStep,
} from './exportShutter'

const rendered = (steps: readonly ShutterStep[]) => steps.filter((s) => s.render)
const centers = (steps: readonly ShutterStep[]) => steps.filter((s) => s.center)

describe('subframeOffsets', () => {
  it('one subframe is the frame itself (the identity)', () => {
    expect(subframeOffsets(1, 180)).toEqual([0])
    expect(subframeOffsets(1, 360)).toEqual([0])
  })

  it('centered and evenly spaced over the shutter fraction: 4 at 180 degrees', () => {
    // Half an interval open, split in four: centers at -3/16, -1/16, 1/16, 3/16 of the interval.
    const o = subframeOffsets(4, 180)
    expect(o).toHaveLength(4)
    for (const [i, want] of [-3 / 16, -1 / 16, 1 / 16, 3 / 16].entries()) expect(o[i]).toBeCloseTo(want, 12)
    expect(o.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 12) // centered
  })

  it('the span scales with the shutter: 360 opens the whole interval, 90 a quarter', () => {
    const full = subframeOffsets(2, 360)
    expect(full[0]).toBeCloseTo(-0.25, 12)
    expect(full[1]).toBeCloseTo(0.25, 12)
    const quarter = subframeOffsets(2, 90)
    expect(quarter[0]).toBeCloseTo(-1 / 16, 12)
    expect(quarter[1]).toBeCloseTo(1 / 16, 12)
  })

  it('an odd count puts its middle subframe exactly on the frame', () => {
    expect(subframeOffsets(5, 180)[2]).toBe(0)
  })
})

describe('normalizeMotionBlur', () => {
  it('off below two subframes or with a closed shutter, or absent', () => {
    expect(normalizeMotionBlur(undefined)).toBeNull()
    expect(normalizeMotionBlur(null)).toBeNull()
    expect(normalizeMotionBlur({ subframes: 1, shutterDeg: 180 })).toBeNull()
    expect(normalizeMotionBlur({ subframes: 8, shutterDeg: 0 })).toBeNull()
    expect(normalizeMotionBlur({ subframes: Number.NaN, shutterDeg: 180 })).toBeNull()
  })

  it('whole subframes up to the bound, shutter up to 360', () => {
    expect(normalizeMotionBlur({ subframes: 8.7, shutterDeg: 180 })).toEqual({ subframes: 8, shutterDeg: 180 })
    expect(normalizeMotionBlur({ subframes: 500, shutterDeg: 720 })).toEqual({ subframes: MOTION_BLUR_MAX_SUBFRAMES, shutterDeg: 360 })
  })
})

describe('scriptShutterSteps', () => {
  // 60 fps: a file frame interval is 1000/60 ms. A script clock that maps script ms to film
  // frames at 30 frames per second (frameAt), the plan's own conversion in the export.
  const fps = 60
  const frameAt = (s: number) => s * 0.03
  const step = 1000 / fps

  it('N subframes centered on the frame\'s script time, spread over the shutter fraction', () => {
    const steps = scriptShutterSteps(500, frameAt(500), { subframes: 4, shutterDeg: 180 }, fps, 10_000, frameAt)
    const drawn = rendered(steps)
    expect(drawn.map((s) => s.scriptMs! - 500).map((d) => d / step)).toEqual(
      subframeOffsets(4, 180).map((o) => expect.closeTo(o, 9) as unknown as number),
    )
    // Each subframe's film frame is the clock's, at its own script time.
    for (const s of drawn) expect(s.frame).toBeCloseTo(frameAt(s.scriptMs!), 12)
  })

  it('an even count adds a pose-only center at the frame\'s exact time, in time order', () => {
    const steps = scriptShutterSteps(500, 15, { subframes: 4, shutterDeg: 180 }, fps, 10_000, frameAt)
    expect(steps).toHaveLength(5)
    expect(rendered(steps)).toHaveLength(4)
    expect(centers(steps)).toEqual([{ frame: 15, scriptMs: 500, render: false, center: true }])
    expect(steps.indexOf(centers(steps)[0])).toBe(2)
    const times = steps.map((s) => s.scriptMs!)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it('an odd count draws its center, which is the frame\'s own pose bit for bit', () => {
    const steps = scriptShutterSteps(500, 15, { subframes: 3, shutterDeg: 180 }, fps, 10_000, frameAt)
    expect(steps).toHaveLength(3)
    expect(steps[1]).toEqual({ frame: 15, scriptMs: 500, render: true, center: true })
    expect(centers(steps)).toHaveLength(1)
  })

  it('stays inside the script: no time before 0 or past its length', () => {
    const first = scriptShutterSteps(0, 0, { subframes: 4, shutterDeg: 360 }, fps, 1000, frameAt)
    expect(Math.min(...first.map((s) => s.scriptMs!))).toBe(0)
    const last = scriptShutterSteps(1000, 30, { subframes: 4, shutterDeg: 360 }, fps, 1000, frameAt)
    expect(Math.max(...last.map((s) => s.scriptMs!))).toBe(1000)
  })

  it('consecutive frames never overlap, even at a 360 degree shutter: time runs forward across frames', () => {
    const blur = { subframes: 8, shutterDeg: 360 }
    const a = scriptShutterSteps(100 * step, 0, blur, fps, 10_000, frameAt)
    const b = scriptShutterSteps(101 * step, 0, blur, fps, 10_000, frameAt)
    expect(a[a.length - 1].scriptMs!).toBeLessThan(b[0].scriptMs!)
  })
})

describe('planShutterSteps', () => {
  const frames = [10, 10.5, 11, 11.5, 12, 12]

  it('interpolates across the step to the next plan frame', () => {
    const steps = planShutterSteps(frames, 1, { subframes: 2, shutterDeg: 360 })
    // Offsets -1/4 and +1/4 of the 0.5-frame step to the next frame, the center between them.
    expect(steps.map((s) => s.frame)).toEqual([10.375, 10.5, 10.625])
    expect(steps.map((s) => s.render)).toEqual([true, false, true])
    expect(steps.every((s) => s.scriptMs === null)).toBe(true)
  })

  it('a zero step (the held last frame) has no motion: every subframe is the frame', () => {
    const steps = planShutterSteps(frames, 4, { subframes: 4, shutterDeg: 180 })
    expect(new Set(steps.map((s) => s.frame))).toEqual(new Set([12]))
    expect(rendered(steps)).toHaveLength(4)
  })

  it('the last frame uses the step from the previous one; a lone frame is still', () => {
    const steps = planShutterSteps([10, 11], 1, { subframes: 3, shutterDeg: 360 })
    for (const [i, want] of [11 - 1 / 3, 11, 11 + 1 / 3].entries()) expect(steps[i].frame).toBeCloseTo(want, 12)
    expect(planShutterSteps([7], 0, { subframes: 3, shutterDeg: 180 }).map((s) => s.frame)).toEqual([7, 7, 7])
  })
})
