// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayExportPlan.test.ts — the export's sampling, without a browser or an encoder.
 *
 * What's at stake here is the clip's DURATION and the number of frames it will need to paint:
 * two numbers that cannot be checked by eye on a video file, and which nonetheless drive the
 * progress bar, the memory used, and the clip's end.
 */
import { describe, expect, it } from 'vitest'

import {
  buildExportPlan,
  clampExportBounds,
  defaultExportBounds,
  etaLabel,
  exportProgressPct,
} from './replayExportPlan'
import { testReplayDoc } from '../test/testDoc'
import { frameToMs } from '../../../lib/replay/replayLogic'

/** A film at 20 frames per second: 50 ms per frame, 200 frames, i.e. 10 s of match. */
const DOC = testReplayDoc({ frameIntervalMs: 50, frameCount: 200 })

describe('defaultExportBounds — the offered range', () => {
  it('is the GAMEPLAY window when it is known', () => {
    // `leadInFrame` (the PLAYBACK preamble, D3) is here for the type: the export offers the
    // gameplay window, never the second that precedes it.
    const w = { startFrame: 20, leadInFrame: 0, endFrame: 180, startMs: 1000, endMs: 9000 }
    expect(defaultExportBounds(DOC, w)).toEqual({ startFrame: 20, endFrame: 180 })
  })

  it('falls back to the whole film without framing', () => {
    // Less accurate (the countdown is in it), but everything the document allows us to claim.
    expect(defaultExportBounds(DOC, null)).toEqual({ startFrame: 0, endFrame: 199 })
  })
})

describe('clampExportBounds — two fields filled in by a human', () => {
  const domain = { startFrame: 20, endFrame: 180 }

  it('leaves a valid range untouched', () => {
    expect(clampExportBounds({ startFrame: 50, endFrame: 100 }, domain)).toEqual({
      startFrame: 50,
      endFrame: 100,
    })
  })

  it('restores the order of crossed bounds', () => {
    expect(clampExportBounds({ startFrame: 120, endFrame: 60 }, domain)).toEqual({
      startFrame: 60,
      endFrame: 120,
    })
  })

  it('brings back inside the match what falls outside it', () => {
    expect(clampExportBounds({ startFrame: -500, endFrame: 9999 }, domain)).toEqual({
      startFrame: 20,
      endFrame: 180,
    })
  })
})

describe('buildExportPlan — the sequence of frames', () => {
  it('samples at the FILE rate, not the film’s', () => {
    // 2 s of match (frames 0 to 40 of a film at 20 fps) exported at 30 fps: 60 steps + the bound.
    const plan = buildExportPlan({ startFrame: 0, endFrame: 40 }, DOC, 30)
    expect(plan.durationMs).toBe(2000)
    expect(plan.frames).toHaveLength(61)
    expect(plan.fps).toBe(30)
  })

  it('advances by a FRACTIONAL step when the two rates don’t line up', () => {
    const plan = buildExportPlan({ startFrame: 0, endFrame: 40 }, DOC, 30)
    // 1/30 s = 33.33 ms = 0.667 frame of a 50 ms film. Rounding would make the motion jerky.
    expect(plan.frames[1]).toBeCloseTo(0.6667, 3)
    expect(plan.frames[3]).toBeCloseTo(2, 3)
  })

  it('ends EXACTLY on the end bound', () => {
    // The match-end screen is painted ONLY on this bound: missing it means delivering a
    // match-end clip without its end screen.
    const plan = buildExportPlan({ startFrame: 10, endFrame: 47 }, DOC, 30)
    expect(plan.frames[plan.frames.length - 1]).toBe(47)
  })

  it('starts from the start bound', () => {
    expect(buildExportPlan({ startFrame: 10, endFrame: 47 }, DOC, 30).frames[0]).toBe(10)
  })

  it('renders ONE frame on an empty range', () => {
    // A freeze-frame is still a result; an empty file would still get downloaded.
    const plan = buildExportPlan({ startFrame: 30, endFrame: 30 }, DOC, 30)
    expect(plan.frames).toEqual([30])
    expect(plan.durationMs).toBe(0)
  })

  it('a document WITHOUT a time scale keeps the fallback axis, and still exports', () => {
    // Without `frameIntervalMs`, `frameToMs` falls back to the historical rate (60 fps): the
    // axis is no longer the match's real time, but it remains an axis — the export does not
    // need to refuse it.
    const noScale = testReplayDoc({ frameCount: 200 })
    const plan = buildExportPlan({ startFrame: 0, endFrame: 199 }, noScale, 30)
    expect(plan.frames[0]).toBe(0)
    // A 1/30 s step equals 2 frames of a 60 fps axis.
    expect(plan.frames[1]).toBeCloseTo(2, 6)
    expect(plan.frames[plan.frames.length - 1]).toBe(199)
  })

  it('the announced duration is the RANGE’s, never the computation’s', () => {
    const plan = buildExportPlan({ startFrame: 20, endFrame: 180 }, DOC, 30)
    expect(plan.durationMs).toBe(8000)
  })
})

describe('exportProgressPct — the bar does not lie', () => {
  it('renders the share covered so far', () => {
    expect(exportProgressPct(25, 100)).toBe(25)
  })

  it('never exceeds 100%, nor drops below 0', () => {
    expect(exportProgressPct(200, 100)).toBe(100)
    expect(exportProgressPct(-5, 100)).toBe(0)
  })

  it('renders 0 rather than a division by zero', () => {
    expect(exportProgressPct(0, 0)).toBe(0)
  })
})

describe('buildExportPlan — the HOLD on the last frame', () => {
  it('adds nothing when not asked for', () => {
    const without = buildExportPlan({ startFrame: 0, endFrame: 40 }, DOC, 30)
    expect(without.holdMs).toBe(0)
    expect(without.frames[without.frames.length - 1]).toBe(40)
  })

  it('repeats the last frame for the requested duration', () => {
    // Without this hold, the match-end screen — painted ONLY on the bound — used to last a
    // single frame, i.e. 1/30 s: an imperceptible flash.
    const without = buildExportPlan({ startFrame: 0, endFrame: 40 }, DOC, 30)
    const withHold = buildExportPlan({ startFrame: 0, endFrame: 40 }, DOC, 30, 3000)
    expect(withHold.frames).toHaveLength(without.frames.length + 90)
    expect(withHold.holdMs).toBe(3000)
  })

  it('the held frames are ALL the end bound', () => {
    const withHold = buildExportPlan({ startFrame: 0, endFrame: 40 }, DOC, 30, 1000)
    expect(withHold.frames.slice(-30)).toEqual(Array.from({ length: 30 }, () => 40))
  })

  it('the announced duration stays the RANGE’s, hold excluded', () => {
    // The dialog announces "Plage exportée": the hold is extra, not part of the range.
    expect(buildExportPlan({ startFrame: 0, endFrame: 40 }, DOC, 30, 3000).durationMs).toBe(2000)
  })
})

describe('etaLabel — an estimate that says nothing does not show', () => {
  it('stays silent as long as there is no estimate', () => {
    expect(etaLabel(undefined)).toBeNull()
  })

  it('stays silent under three seconds', () => {
    // Seen in acceptance testing: on a fast export, "environ 0:00 restantes" used to show the
    // whole time and read as "it's done" while the computation was still running.
    expect(etaLabel(900)).toBeNull()
    expect(etaLabel(2999)).toBeNull()
  })

  it('counts in SECONDS under a minute — "7 s" reads better than "0:07"', () => {
    expect(etaLabel(7000)).toBe('7 s')
    expect(etaLabel(59_400)).toBe('59 s')
  })

  it('switches to m:ss past a minute', () => {
    expect(etaLabel(80_000)).toBe('1:20')
    expect(etaLabel(605_000)).toBe('10:05')
  })
})

describe('buildExportPlan at 60 fps (the 3D export)', () => {
  // Halo's film grid: 33.3 ms per frame, so one 60 fps step is half a film frame.
  const FILM = testReplayDoc({ frameIntervalMs: 100 / 3, frameCount: 3000 })

  it('one minute of match is 3600 steps plus the exact end bound: 3601 frames', () => {
    const plan = buildExportPlan({ startFrame: 0, endFrame: 1800 }, FILM, 60)
    expect(plan.fps).toBe(60)
    expect(plan.durationMs).toBeCloseTo(60_000, 6)
    expect(plan.frames).toHaveLength(3601)
    expect(plan.frames[3600]).toBe(1800)
  })

  it('posts frames at exact 1/60 s steps of match time: half film frames, from the start bound', () => {
    const plan = buildExportPlan({ startFrame: 120, endFrame: 1920 }, FILM, 60)
    for (const i of [0, 1, 2, 3, 59, 60, 1799, 3599]) {
      expect(plan.frames[i]).toBeCloseTo(120 + i / 2, 9)
      expect(frameToMs(plan.frames[i], FILM) - frameToMs(120, FILM)).toBeCloseTo((i * 1000) / 60, 6)
    }
  })

  it('every step is strictly forward: no frame posed twice, none skipped', () => {
    const plan = buildExportPlan({ startFrame: 0, endFrame: 1800 }, FILM, 60)
    for (let i = 1; i < plan.frames.length; i++) {
      const step = plan.frames[i] - plan.frames[i - 1]
      expect(step).toBeGreaterThan(0)
      expect(step).toBeLessThanOrEqual(0.5 + 1e-9)
    }
  })

  it('twice the frames of the 30 fps plan for the same range, same duration', () => {
    const at30 = buildExportPlan({ startFrame: 0, endFrame: 900 }, FILM, 30)
    const at60 = buildExportPlan({ startFrame: 0, endFrame: 900 }, FILM, 60)
    expect(at60.durationMs).toBe(at30.durationMs)
    expect(at60.frames.length - 1).toBe(2 * (at30.frames.length - 1))
  })

  it('the end hold lasts the same time at 60: twice the held frames', () => {
    const plan = buildExportPlan({ startFrame: 0, endFrame: 300 }, FILM, 60, 3000)
    const held = plan.frames.slice(601)
    expect(held).toHaveLength(180)
    expect(held.every((f) => f === 300)).toBe(true)
  })

  it('the last frame sits within the range: the clip never outlasts its sound', () => {
    // A range not a multiple of 1/60 s (10.01 s): frame i's file time i/60 stays <= the range.
    const plan = buildExportPlan({ startFrame: 0, endFrame: 300.3 }, FILM, 60)
    expect((plan.frames.length - 1) / 60).toBeLessThanOrEqual(plan.durationMs / 1000)
  })
})
