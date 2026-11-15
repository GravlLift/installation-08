/**
 * shieldMix.test.ts — THE SHIELD ALARMS OF THE EXPORT: the same pure logic as the page
 * (`shieldSound.ts`), placed in advance on the clip axis. A break life gives the break, the
 * low and depleted loops, the picked rise and the full tone; a low interval gives a looped
 * source covering EXACTLY that interval, entered at the page's beat; a death cuts the
 * in-flight rise on the page's ramp.
 */
import { describe, expect, it } from 'vitest'

import { shieldHudTrackOf, type ShieldHudTrack } from '../model/shieldHud'
import { FakeContext, type FakeSource } from '../test/fakeAudio'
import { VOLUME_RAMP_S } from './replayAudio'
import { planShieldSegments, shieldSegmentPlacements, shieldTailSeconds } from './shieldMix'
import { SHIELD_BUS_GAIN, SHIELD_RISE_CUT_S } from './shieldSoundPlayer'
import { SHIELD_SOUND } from './shieldSound'
import type { ShieldSoundReading } from './shieldSound'

const MS = 33
const STEP = 1 / 64

// Full until 10; hit at 12 (-> 0.5), hit at 20 (-> 0.2, low), broken at 24, flat at 0 until
// 174, then recharged one sample per frame (1/64 per frame, as the film records it), full at 238.
function brokenLife(): ShieldHudTrack {
  const points: { t: number; sh?: number }[] = [
    { t: 0 }, { t: 10, sh: 1 }, { t: 12, sh: 0.5 }, { t: 20, sh: 0.2 }, { t: 24, sh: 0 }, { t: 100, sh: 0 },
  ]
  for (let i = 0; i <= 64; i++) points.push({ t: 174 + i, sh: Math.min(1, i * STEP) })
  points.push({ t: 400, sh: 1 })
  return shieldHudTrackOf(points, MS, 0)
}

// Full until 10, broken at 12, recharged from 40 one sample per frame (full would be at 104).
function dyingLife(): ShieldHudTrack {
  const points: { t: number; sh?: number }[] = [
    { t: 0, sh: 1 }, { t: 12, sh: 0 }, { t: 40, sh: 0 },
  ]
  for (let i = 0; i <= 64; i++) points.push({ t: 40 + i, sh: Math.min(1, i * STEP) })
  points.push({ t: 200, sh: 1 })
  return shieldHudTrackOf(points, MS, 0)
}

/** The rises' file lengths measured on the installed game (rise_0 .. rise_9). */
const RISES_MS = [557, 836, 1574, 1727, 686, 2308, 1108, 1372, 1697, 450]

/** Plausible durations (seconds), per stem — the rises measured on the game. */
const DUR: Record<string, number> = {
  [SHIELD_SOUND.lowLoop]: 0.8,
  [SHIELD_SOUND.brokenLoop]: 0.5,
  [SHIELD_SOUND.break]: 0.6,
  [SHIELD_SOUND.rechargeStart]: 0.3,
  [SHIELD_SOUND.rechargeLayer]: 0.3,
  [SHIELD_SOUND.full]: 0.7,
  [SHIELD_SOUND.fullLayer]: 0.7,
  ...Object.fromEntries(SHIELD_SOUND.rises.map((s, i) => [s, RISES_MS[i] / 1000])),
}
const durOf = (stem: string) => DUR[stem] ?? null

const LIFE = {} as never // a stand-in life: only its identity matters to the planner
const source = (track: ShieldHudTrack, aliveUntil = Number.POSITIVE_INFINITY) => ({
  reader: (frame: number): ShieldSoundReading | null => (frame < aliveUntil ? { life: LIFE, track } : null),
  frameMs: MS,
})

const find = (segs: ReturnType<typeof planShieldSegments>, stem: string) => {
  const s = segs.find((x) => x.stem === stem)
  expect(s).toBeDefined()
  return s!
}

describe('planShieldSegments — a break life, the whole page logic in placements', () => {
  const track = brokenLife()
  const segs = planShieldSegments(source(track), { startMs: 0, endMs: 400 * MS }, durOf)

  it('places the break at its transition and the full tone at its own', () => {
    expect(find(segs, SHIELD_SOUND.break).atS).toBeCloseTo(24 * MS / 1000, 6)
    expect(find(segs, SHIELD_SOUND.full).atS).toBeCloseTo(238 * MS / 1000, 6)
    expect(find(segs, SHIELD_SOUND.fullLayer).atS).toBeCloseTo(238 * MS / 1000, 6)
  })

  it('loops the low state over EXACTLY its interval, entered at the beat', () => {
    const low = find(segs, SHIELD_SOUND.lowLoop)
    expect(low.loop).toBe(true)
    expect(low.atS).toBeCloseTo(20 * MS / 1000, 6)
    expect(low.stopS).toBeCloseTo(24 * MS / 1000, 6)
    expect(low.offsetS).toBe(0) // the state began at 20
    expect(low.fadeOutS).toBe(VOLUME_RAMP_S)
  })

  it('loops the depleted state over its interval, until the recharge begins', () => {
    const broken = find(segs, SHIELD_SOUND.brokenLoop)
    expect(broken.atS).toBeCloseTo(24 * MS / 1000, 6)
    expect(broken.stopS).toBeGreaterThan(174 * MS / 1000 - 1e-9)
    expect(broken.stopS).toBeLessThanOrEqual(175 * MS / 1000)
  })

  it('plays the recharge as start, layer and the rise whose length matches the refill', () => {
    const start = find(segs, SHIELD_SOUND.rechargeStart)
    const layer = find(segs, SHIELD_SOUND.rechargeLayer)
    const rise = find(segs, SHIELD_SOUND.rises[5]) // fill of about 2 s -> rise 5, as on the page
    expect(start.atS).toBe(layer.atS)
    expect(rise.atS).toBe(start.atS)
    expect(rise.atS).toBeGreaterThanOrEqual(174 * MS / 1000 - 1e-9)
    expect(rise.atS).toBeLessThan(175 * MS / 1000)
    // The start and the layer are one-shots; only the span's end bounds them.
    expect(start.stopS).toBeCloseTo(400 * MS / 1000, 6)
    expect(start.fadeOutS).toBe(VOLUME_RAMP_S)
    // The rise is cut by the full tone with the page's stop action.
    const full = find(segs, SHIELD_SOUND.full).atS
    expect(rise.stopS).toBeCloseTo(full + SHIELD_RISE_CUT_S, 6)
    expect(rise.fadeOutS).toBe(SHIELD_RISE_CUT_S)
  })

  it('places no other rise', () => {
    for (let i = 0; i < SHIELD_SOUND.rises.length; i++) {
      if (i === 5) continue
      expect(segs.some((s) => s.stem === SHIELD_SOUND.rises[i])).toBe(false)
    }
  })
})

describe('planShieldSegments — a bound that cuts a state keeps the page loop offset', () => {
  const track = brokenLife()

  it('the depleted loop starts where a playback begun at the bound would stand', () => {
    const segs = planShieldSegments(source(track), { startMs: 100 * MS, endMs: 400 * MS }, durOf)
    const broken = find(segs, SHIELD_SOUND.brokenLoop)
    expect(broken.atS).toBe(0)
    // 76 frames into a state begun at 24, modulo the 0.5 s file.
    expect(broken.offsetS).toBeCloseTo(((100 - 24) * MS / 1000) % 0.5, 6)
    expect(broken.stopS).toBeGreaterThan(174 * MS / 1000 - 100 * MS / 1000 - 1e-9)
    // Nothing of the life before the bound: no low loop, no break.
    expect(segs.some((s) => s.stem === SHIELD_SOUND.lowLoop)).toBe(false)
    expect(segs.some((s) => s.stem === SHIELD_SOUND.break)).toBe(false)
  })
})

describe('planShieldSegments — a death cuts the in-flight rise on the stop ramp', () => {
  it('the rise and the loop stop when the life does, on the page ramp', () => {
    const segs = planShieldSegments(source(dyingLife(), 60), { startMs: 0, endMs: 200 * MS }, durOf)
    const rise = find(segs, SHIELD_SOUND.rises[5]) // full refill -> rise 5
    expect(rise.stopS).toBeCloseTo(60 * MS / 1000, 6)
    expect(rise.fadeOutS).toBe(VOLUME_RAMP_S)
    const broken = find(segs, SHIELD_SOUND.brokenLoop)
    // The broken state ends at the ramp's start, a fraction of a frame after sample 40.
    expect(broken.stopS).toBeGreaterThan(40 * MS / 1000 - 1e-9)
    expect(broken.stopS).toBeLessThanOrEqual(41 * MS / 1000)
    // The full tone, whose transition is after the death, is never placed.
    expect(segs.some((s) => s.stem === SHIELD_SOUND.full)).toBe(false)
  })

  it('a reader without a single reading plans nothing', () => {
    const segs = planShieldSegments({ reader: () => null, frameMs: MS }, { startMs: 0, endMs: 200 * MS }, durOf)
    expect(segs).toEqual([])
  })

  it('a missing file skips its segment without breaking the rest', () => {
    const segs = planShieldSegments(
      source(brokenLife()),
      { startMs: 0, endMs: 400 * MS },
      (stem) => (stem === SHIELD_SOUND.brokenLoop ? null : durOf(stem)),
    )
    expect(segs.some((s) => s.stem === SHIELD_SOUND.brokenLoop)).toBe(false)
    expect(find(segs, SHIELD_SOUND.break).atS).toBeCloseTo(24 * MS / 1000, 6)
    expect(find(segs, SHIELD_SOUND.full).atS).toBeCloseTo(238 * MS / 1000, 6)
  })
})

describe('shieldSegmentPlacements — the same wiring as the page bus', () => {
  const BUFFERS = new Map<string, AudioBuffer | null>([
    [SHIELD_SOUND.brokenLoop, { duration: 0.5 } as AudioBuffer],
    [SHIELD_SOUND.break, { duration: 0.6 } as AudioBuffer],
  ])
  const SEGMENTS = [
    { stem: SHIELD_SOUND.brokenLoop, atS: 0, loop: true, offsetS: 0.25, stopS: 1.2, fadeOutS: VOLUME_RAMP_S },
    { stem: SHIELD_SOUND.break, atS: 0.792, loop: false },
  ]

  it('one bus at the page gain, sources entered at their beat and bounded by the plan', () => {
    const ctx = new FakeContext()
    const placements = shieldSegmentPlacements(ctx as unknown as BaseAudioContext, ctx.destination as AudioNode, SEGMENTS, BUFFERS)
    expect(placements).toHaveLength(2)
    for (const p of placements) p.place()
    // The bus: the first gain, at SHIELD_BUS_GAIN, wired to the destination.
    expect(ctx.gains[0].gain.value).toBe(SHIELD_BUS_GAIN)
    expect(ctx.gains[0].connections).toEqual([ctx.destination])
    const loop = ctx.sources[0] as FakeSource & { loop: boolean }
    expect(loop.loop).toBe(true)
    expect(loop.started).toBe(0)
    expect(loop.offset).toBeCloseTo(0.25, 6)
    expect(loop.stopped).toBe(1.2)
    // The one-shot: no loop, no forced stop, placed on the bus.
    const shot = ctx.sources[1] as FakeSource & { loop: boolean }
    expect(shot.loop).toBe(false)
    expect(shot.started).toBe(0.792)
    expect(shot.stopped).toBeNull()
    // The loop's gain fades to zero on the stop.
    expect(ctx.gains[1].gain.calls).toContainEqual(['ramp', 0, 1.2])
    expect(ctx.gains[1].connections).toEqual([ctx.gains[0]])
    expect(placements[1].endS).toBeCloseTo(0.792 + 0.6, 6)
  })

  it('an absent asset is a silence, and an empty plan places no bus', () => {
    // A plan with one segment but no decoded file places no source (the bus alone is
    // harmless, as at the engines); an empty plan places nothing at all.
    const absent = new FakeContext()
    expect(shieldSegmentPlacements(absent as unknown as BaseAudioContext, {} as AudioNode, [SEGMENTS[1]], new Map())).toEqual([])
    const empty = new FakeContext()
    expect(shieldSegmentPlacements(empty as unknown as BaseAudioContext, empty.destination as AudioNode, [], BUFFERS)).toEqual([])
    expect(empty.gains).toHaveLength(0)
  })
})

describe('shieldTailSeconds — what overflows the bound', () => {
  it('a one-shot that goes out near the bound overflows its file', () => {
    // A break at 9.5 s of a 10 s clip, file of 0.6 s: the tail is 0.1 s.
    const segs = [{ stem: SHIELD_SOUND.break, atS: 9.5, loop: false }]
    expect(shieldTailSeconds(segs, durOf, 10)).toBeCloseTo(0.1, 6)
  })

  it('a looped source bounded by the plan overflows nothing', () => {
    const segs = [{ stem: SHIELD_SOUND.brokenLoop, atS: 0, loop: true, stopS: 5, fadeOutS: VOLUME_RAMP_S }]
    expect(shieldTailSeconds(segs, durOf, 10)).toBe(0)
  })
})
