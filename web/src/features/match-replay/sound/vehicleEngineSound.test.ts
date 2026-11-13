/**
 * Tests of the ENGINE PLAN of the vehicles (vehicleEngineSound.ts): merging of the
 * occupation episodes, engine that follows the movement, refusal of the decor, table of the stems, and the
 * constant-power crossfade — the rules of the framing of 2026-09-04 and of the contract of the bank.
 */
import { describe, expect, it } from 'vitest'

import type { ReplayVehicleTrackReady } from '../../../lib/replay/replayNormalize'
import {
  ENGINE_RIDE_GAP_MERGE_MS,
  enginePhaseAt,
  equalPowerCurves,
  ENGINE_MOVE_MIN_MS,
  ENGINE_STOP_MERGE_MS,
  episodeOfMoves,
  mergeRideSpans,
  movingSpansOf,
  planVehicleEngines,
  VEHICLE_ENGINE_BUS_GAIN,
  VEHICLE_MOVE_SPEED,
  VEHICLE_ENGINE_STEMS,
  allEngineStems,
} from './vehicleEngineSound'

/** A frame = 100 ms, the rate of the real artifacts (frameIntervalMs of the schema). */
const FRAME_MS = 100

const ride = (t0: number, t1: number) => ({ t0, t1, slot: 1, src: 'x' })

function track(family: string, rides: { t0: number; t1: number }[], samples: { t: number; x: number; y: number }[] = []): ReplayVehicleTrackReady {
  return { family, rides: rides.map((r) => ({ ...ride(r.t0, r.t1), aim: [] })), samples } as unknown as ReplayVehicleTrackReady
}

describe('mergeRideSpans — the union of the occupation episodes', () => {
  it('merges a hole shorter than the tolerance (the engine does not cut)', () => {
    // 19 frames of hole = 1.9 s < 2 s: a single episode.
    expect(mergeRideSpans([ride(0, 50), ride(69, 100)], FRAME_MS)).toEqual([
      { t0Ms: 0, t1Ms: 10_000 },
    ])
  })

  it('cuts on a hole at the tolerance or beyond', () => {
    // 20 frames = 2.0 s: two episodes.
    expect(mergeRideSpans([ride(0, 50), ride(70, 100)], FRAME_MS)).toEqual([
      { t0Ms: 0, t1Ms: 5_000 },
      { t0Ms: 7_000, t1Ms: 10_000 },
    ])
  })

  it('unites overlapping rides (several passengers) and sorts the inputs', () => {
    expect(mergeRideSpans([ride(30, 80), ride(0, 50), ride(40, 60)], FRAME_MS)).toEqual([
      { t0Ms: 0, t1Ms: 8_000 },
    ])
  })

  it('ignores an empty or reversed ride', () => {
    expect(mergeRideSpans([ride(10, 10), ride(20, 5)], FRAME_MS)).toEqual([])
  })

  it('the tolerance is indeed the constant of the framing (2 s)', () => {
    expect(ENGINE_RIDE_GAP_MERGE_MS).toBe(2_000)
  })
})

/**
 * A trajectory: in motion (5 units/s, that is 0.5 per frame) on the frame ranges
 * `roule`, stationary elsewhere.
 */
function trajectory(nFrames: number, roule: [number, number][]): { t: number; x: number; y: number }[] {
  const out = [{ t: 0, x: 0, y: 0 }]
  for (let t = 1; t <= nFrames; t++) {
    const moves = roule.some(([a, b]) => t > a && t <= b)
    out.push({ t, x: out[t - 1].x + (moves ? 0.5 : 0), y: 0 })
  }
  return out
}

describe('movingSpansOf and episodeOfMoves — the engine follows the movement', () => {
  const span = { t0Ms: 0, t1Ms: 10_000 }

  it('stationary from the beginning to the end: no movement, no episode', () => {
    expect(movingSpansOf(trajectory(100, []), span, FRAME_MS)).toEqual([])
    expect(episodeOfMoves([])).toBeNull()
  })

  it('starts, waits 2 s, rolls 3 s, stops: the episode holds the only movement', () => {
    const moves = movingSpansOf(trajectory(100, [[20, 50]]), span, FRAME_MS)
    expect(moves).toEqual([{ t0Ms: 2_000, t1Ms: 5_000 }])
    expect(episodeOfMoves(moves)).toEqual({ t0Ms: 2_000, t1Ms: 5_000, arrets: [] })
  })

  it('a short stop (1 s < 1.5 s) cuts nothing', () => {
    const moves = movingSpansOf(trajectory(100, [[0, 30], [40, 70]]), span, FRAME_MS)
    expect(moves).toEqual([{ t0Ms: 0, t1Ms: 7_000 }])
    expect(ENGINE_STOP_MERGE_MS).toBe(1_500)
  })

  it('a long stop (3 s) becomes an interior stop of the episode', () => {
    const moves = movingSpansOf(trajectory(100, [[0, 30], [60, 90]]), span, FRAME_MS)
    expect(episodeOfMoves(moves)).toEqual({
      t0Ms: 0,
      t1Ms: 9_000,
      arrets: [{ t0Ms: 3_000, t1Ms: 6_000 }],
    })
  })

  it('a shake (0.3 s of movement) lights nothing; the slow drift neither', () => {
    expect(movingSpansOf(trajectory(100, [[20, 23]]), span, FRAME_MS)).toEqual([])
    const derive = Array.from({ length: 101 }, (_, t) => ({ t, x: t * 0.05, y: 0 })) // 0.5 unit/s
    expect(movingSpansOf(derive, span, FRAME_MS)).toEqual([])
    expect(VEHICLE_MOVE_SPEED).toBe(1)
    expect(ENGINE_MOVE_MIN_MS).toBe(500)
  })

  it('bounds the movements to the occupation', () => {
    const moves = movingSpansOf(trajectory(100, [[0, 100]]), { t0Ms: 2_000, t1Ms: 4_000 }, FRAME_MS)
    expect(moves).toEqual([{ t0Ms: 2_000, t1Ms: 4_000 }])
  })
})

describe('planVehicleEngines — what sounds, what stays silent', () => {
  const roule = trajectory(60, [[0, 60]])

  it('refuses the decor (pelican), the unknown family, and the vehicle never occupied', () => {
    const plans = planVehicleEngines(
      [
        track('pelican', [{ t0: 0, t1: 100 }], roule), // decor: never a sound (framing n° 1)
        track('shade_turret', [{ t0: 0, t1: 100 }], roule), // without bank: clean silence (n° 2)
        track('warthog', [], roule), // never occupied: no engine
        track('ghost', [{ t0: 10, t1: 50 }], roule),
      ],
      FRAME_MS,
    )
    expect(plans).toEqual([
      { family: 'ghost', episodes: [{ t0Ms: 1_000, t1Ms: 5_000, arrets: [] }] },
    ])
  })

  it('an OCCUPIED Falcon sounds: it is no longer a decor family (decision of 2026-09-24)', () => {
    const plans = planVehicleEngines([track('falcon', [{ t0: 10, t1: 50 }], roule)], FRAME_MS)
    expect(plans).toEqual([
      { family: 'falcon', episodes: [{ t0Ms: 1_000, t1Ms: 5_000, arrets: [] }] },
    ])
  })

  it('an occupied vehicle that does not move stays silent (decision of 2026-11-02)', () => {
    const immobile = trajectory(60, [])
    const plans = planVehicleEngines(
      [track('warthog', [{ t0: 0, t1: 50 }], immobile), track('scorpion', [{ t0: 0, t1: 50 }], immobile)],
      FRAME_MS,
    )
    expect(plans).toEqual([])
  })
})

describe('enginePhaseAt — the nominal state of an episode', () => {
  const ep = { t0Ms: 1_000, t1Ms: 5_000, arrets: [{ t0Ms: 2_000, t1Ms: 3_000 }] }
  it('running in, stop on its periods, nothing out', () => {
    expect(enginePhaseAt(ep, 500)).toBeNull()
    expect(enginePhaseAt(ep, 1_000)).toBe('loop')
    expect(enginePhaseAt(ep, 2_500)).toBe('arret')
    expect(enginePhaseAt(ep, 3_000)).toBe('loop')
    expect(enginePhaseAt(ep, 5_000)).toBeNull()
  })
})

describe('the table of the stems and the bus', () => {
  it('the nine families of the bank, three clips each, NO boost referenced', () => {
    expect(Object.keys(VEHICLE_ENGINE_STEMS).sort()).toEqual([
      'banshee', 'chopper', 'falcon', 'ghost', 'mongoose', 'scorpion', 'warthog', 'wasp', 'wraith',
    ])
    for (const [family, stems] of Object.entries(VEHICLE_ENGINE_STEMS)) {
      expect(Object.keys(stems).sort(), family).toEqual(['enter', 'exit', 'loop'])
      // The boost is REFUTED at the witness (measurement of 2026-09-04): no key must lead to it.
      expect(JSON.stringify(stems), family).not.toContain('boost')
    }
    expect(allEngineStems()).toHaveLength(9 * 3)
  })

  it('the engine bus is at 0.85 x the master (user decision of 2026-09-04)', () => {
    expect(VEHICLE_ENGINE_BUS_GAIN).toBe(0.85)
  })
})

describe('equalPowerCurves — the constant-power fade (trap n° 5 of the bank)', () => {
  it('sin² + cos² = 1 over the whole junction, bounds included', () => {
    const { fadeIn, fadeOut } = equalPowerCurves(64)
    expect(fadeIn[0]).toBe(0)
    expect(fadeOut[0]).toBe(1)
    expect(fadeIn[63]).toBeCloseTo(1, 10)
    expect(fadeOut[63]).toBeCloseTo(0, 10)
    for (let i = 0; i < 64; i++) {
      // Float32 precision of the curves (setValueCurveAtTime demands it): ~1e-7, not 1e-10.
      expect(fadeIn[i] ** 2 + fadeOut[i] ** 2).toBeCloseTo(1, 6)
    }
  })
})
