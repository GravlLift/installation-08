/**
 * Tests of the ENGINE SEGMENTS of the export (vehicleEngineMix.ts): the chain
 * enter -> loop x N -> exit laid on the clip axis, the 150 ms junctions, the direct
 * resume on loop when the range cuts an episode, and the tail of an engraved exit.
 */
import { describe, expect, it } from 'vitest'

import {
  engineStemsOf,
  engineTailSeconds,
  planEngineSegments,
} from './vehicleEngineMix'
import {
  ENGINE_CROSSFADE_S,
  ENGINE_RESTART_FADE_S,
  ENGINE_STOP_FADE_S,
  type EnginePlan,
} from './vehicleEngineSound'

/** Plausible bank durations (seconds), per stem. */
const DUREES: Record<string, number> = {
  vehicle_warthog_enter: 2.1,
  vehicle_warthog_loop: 3.25,
  vehicle_warthog_exit: 2.25,
  vehicle_scorpion_enter: 3.6,
  vehicle_scorpion_loop: 3.26,
  vehicle_scorpion_exit: 5.6,
}
const durOf = (stem: string) => DUREES[stem] ?? null

const plan = (family: string, episodes: EnginePlan['episodes']): EnginePlan => ({ family, episodes })

describe('planEngineSegments — the complete chain of one episode within the range', () => {
  const p = plan('warthog', [{ t0Ms: 2_000, t1Ms: 10_000, arrets: [] }])
  const segs = planEngineSegments(p, { startMs: 0, endMs: 20_000 }, durOf)

  it('enter at T0, loop at the junction, exit at T1 — three segments', () => {
    expect(segs.map((s) => s.stem)).toEqual([
      'vehicle_warthog_enter',
      'vehicle_warthog_loop',
      'vehicle_warthog_exit',
    ])
  })

  it('the enter->loop junction is a 150 ms crossfade that ends at the end of the enter', () => {
    const [enter, loop] = segs
    expect(enter.atS).toBe(2)
    expect(enter.loop).toBe(false)
    expect(enter.stopS).toBeCloseTo(2 + 2.1, 6)
    expect(enter.fadeOutS).toBe(ENGINE_CROSSFADE_S)
    expect(loop.loop).toBe(true)
    expect(loop.atS).toBeCloseTo(2 + 2.1 - ENGINE_CROSSFADE_S, 6)
    expect(loop.fadeInS).toBe(ENGINE_CROSSFADE_S)
  })

  it('the exit goes out at T1, without a forced end: its ends are ENGRAVED (bank contract)', () => {
    const exit = segs[2]
    expect(exit.atS).toBe(10)
    expect(exit.stopS).toBeUndefined()
    const loop = segs[1]
    expect(loop.stopS).toBeCloseTo(10 + ENGINE_CROSSFADE_S, 6)
  })
})

describe('planEngineSegments — a range that CUTS an episode', () => {
  const p = plan('warthog', [{ t0Ms: 2_000, t1Ms: 30_000, arrets: [] }])

  it('cut start: DIRECT resume on loop, never a re-enter (seek rule)', () => {
    const segs = planEngineSegments(p, { startMs: 5_000, endMs: 12_000 }, durOf)
    expect(segs.map((s) => s.stem)).toEqual(['vehicle_warthog_loop'])
    expect(segs[0].atS).toBe(0)
    expect(segs[0].fadeInS).toBe(0)
  })

  it('cut end: no exit, the loop is turned off by the fade EXACTLY on the bound', () => {
    const segs = planEngineSegments(p, { startMs: 0, endMs: 12_000 }, durOf)
    const loop = segs[segs.length - 1]
    expect(loop.stem).toBe('vehicle_warthog_loop')
    expect(loop.stopS).toBe(12)
    expect(loop.fadeOutS).toBe(ENGINE_CROSSFADE_S)
    expect(segs.some((s) => s.stem === 'vehicle_warthog_exit')).toBe(false)
  })

  it('episode entirely out of range: nothing', () => {
    expect(planEngineSegments(p, { startMs: 31_000, endMs: 40_000 }, durOf)).toEqual([])
  })
})

describe('planEngineSegments — a long stop turns the loop off by fade', () => {
  const p = plan('warthog', [
    { t0Ms: 0, t1Ms: 12_000, arrets: [{ t0Ms: 4_000, t1Ms: 7_000 }] },
  ])

  it('two runs, no source during the stop, no extra enter or exit', () => {
    const segs = planEngineSegments(p, { startMs: 0, endMs: 20_000 }, durOf)
    expect(segs.map((s) => s.stem)).toEqual([
      'vehicle_warthog_enter',
      'vehicle_warthog_loop',
      'vehicle_warthog_loop',
      'vehicle_warthog_exit',
    ])
    const [, avant, apres] = segs
    // The run is turned off AT the stop, by the extinction fade.
    expect(avant.fadeOutS).toBe(ENGINE_STOP_FADE_S)
    expect(avant.stopS).toBeCloseTo(4 + ENGINE_STOP_FADE_S, 6)
    // It resumes at the end of the stop, by the restart fade.
    expect(apres.atS).toBe(7)
    expect(apres.fadeInS).toBe(ENGINE_RESTART_FADE_S)
    expect(apres.fadeOutS).toBe(ENGINE_CROSSFADE_S)
  })

  it('a range that starts during the stop: the loop resumes in fade at the restart', () => {
    const segs = planEngineSegments(p, { startMs: 5_000, endMs: 20_000 }, durOf)
    expect(segs.map((s) => s.stem)).toEqual(['vehicle_warthog_loop', 'vehicle_warthog_exit'])
    expect(segs[0].atS).toBe(2)
    expect(segs[0].fadeInS).toBe(ENGINE_RESTART_FADE_S)
  })
})

describe('absences stay clean silences', () => {
  it('a missing file skips its segment without breaking the chain', () => {
    const p = plan('ghost', [{ t0Ms: 0, t1Ms: 5_000, arrets: [] }]) // no duration declared
    expect(planEngineSegments(p, { startMs: 0, endMs: 10_000 }, durOf)).toEqual([])
  })

  it('a family out of the table produces nothing', () => {
    expect(planEngineSegments(plan('shade_turret', [{ t0Ms: 0, t1Ms: 5_000, arrets: [] }]), { startMs: 0, endMs: 10_000 }, durOf)).toEqual([])
  })
})

describe('engineTailSeconds — the tail of an engraved exit', () => {
  it('an exit that goes out near the bound overflows its duration', () => {
    const p = plan('scorpion', [{ t0Ms: 0, t1Ms: 9_000, arrets: [] }])
    const segs = planEngineSegments(p, { startMs: 0, endMs: 10_000 }, durOf)
    // Exit at 9 s, duration 5.6 s: end at 14.6 s on a 10 s clip -> tail of 4.6 s.
    expect(engineTailSeconds(segs, durOf, 10)).toBeCloseTo(4.6, 6)
  })

  it('no tail when everything ends within the clip', () => {
    const p = plan('warthog', [{ t0Ms: 1_000, t1Ms: 4_000, arrets: [] }])
    const segs = planEngineSegments(p, { startMs: 0, endMs: 60_000 }, durOf)
    expect(engineTailSeconds(segs, durOf, 60)).toBe(0)
  })
})

describe('engineStemsOf — the stems to decode, deduplicated', () => {
  it('two plans of the same family decode only once', () => {
    const plans = [plan('warthog', []), plan('warthog', []), plan('scorpion', [])]
    expect(engineStemsOf(plans).sort()).toEqual([
      'vehicle_scorpion_enter', 'vehicle_scorpion_exit', 'vehicle_scorpion_loop', 'vehicle_warthog_enter', 'vehicle_warthog_exit',
      'vehicle_warthog_loop',
    ])
  })
})
