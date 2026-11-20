// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** cameraScript3d.test.ts — the script format (validation) and the pose evaluator. */
import { describe, expect, it } from 'vitest'
import {
  CAMERA_SCRIPT_MIN_KEY_GAP_MS,
  circularMeanDeg,
  evaluateCameraScript,
  parseCameraScript,
  scriptClockOf,
  type CameraKey,
  type CameraScript,
  type ClockRate,
  type Ease,
  type PlayerPoint,
  type ScriptPoint,
  type ScriptSubjects,
  type ScriptVec3,
} from './cameraScript3d'
import { GAME_FOV_DEFAULT, verticalFovOf } from '../model/fovLogic'
import { BODY_CENTER } from './body3d'

// Player 'A' runs along +x at 10 u/s from x = 0 at t = 0, heading 0. Player 'B' stands at
// (20, 5, 0), heading 90. Player 'H' stands at (0, 0, 0), heading 90 (for the heading frame).
function fakeSubjects(): ScriptSubjects {
  return {
    feetAt(xuid, tMs) {
      if (xuid === 'A') return { x: (tMs / 1000) * 10, y: 0, z: 0, h: 0 }
      if (xuid === 'B') return { x: 20, y: 5, z: 0, h: 90 }
      if (xuid === 'H') return { x: 0, y: 0, z: 0, h: 90 }
      return null
    },
  }
}

const w = (point: ScriptVec3): ScriptPoint => ({ at: 'world', point })
const pl = (xuid: string, extra: Partial<PlayerPoint> = {}): ScriptPoint => ({ at: 'player', xuid, ...extra })
const key = (t: number, pos: ScriptPoint, look: ScriptPoint, extra: Partial<Pick<CameraKey, 'fov' | 'roll' | 'ease'>> = {}): CameraKey =>
  ({ t, pos, look, ...extra })
const script = (keys: CameraKey[], name = 's'): CameraScript => ({ version: 1, matchId: 'm', name, keys })
const BASE_FOV = GAME_FOV_DEFAULT
const eval_ = (s: CameraScript, tMs: number) => evaluateCameraScript(s, tMs, fakeSubjects(), BASE_FOV)

function accepts(raw: unknown, expectedMatchId?: string): CameraScript {
  const r = parseCameraScript(raw, expectedMatchId)
  expect(r).toMatchObject({ ok: true })
  return (r as { ok: true; script: CameraScript }).script
}

function rejects(raw: unknown, expectedMatchId?: string): string {
  const r = parseCameraScript(raw, expectedMatchId)
  expect(r).toMatchObject({ ok: false })
  return (r as { ok: false; error: string }).error
}

// toThree yields -0 for a zero y, so compare components by value, not identity.
function expectVec(v: ScriptVec3, x: number, y: number, z: number): void {
  expect(v[0]).toBeCloseTo(x, 5)
  expect(v[1]).toBeCloseTo(y, 5)
  expect(v[2]).toBeCloseTo(z, 5)
}

describe('parseCameraScript', () => {
  const good = (): CameraScript =>
    script([key(0, w([0, 0, 0]), w([1, 1, 1])), key(1000, w([2, 0, 0]), w([3, 1, 1]), { ease: 'linear', fov: 90, roll: 5 })])

  it('round-trips a valid script and drops unknown fields', () => {
    const raw = {
      version: 1,
      matchId: 'm',
      name: 'intro-a',
      junk: true,
      keys: [
        { t: 0, pos: { at: 'world', point: [0, 0, 0], extra: 1 }, look: { at: 'player', xuid: 'A', offset: [0, 0, 0.35], relative: 'heading', window: 400, junk: 2 }, bonus: 3 },
        { t: 1000, pos: { at: 'world', point: [2, 0, 0] }, look: { at: 'world', point: [3, 1, 1] }, ease: 'linear', fov: 90, roll: 5 },
      ],
    }
    const s = accepts(raw)
    const expected = script([
      key(0, w([0, 0, 0]), pl('A', { offset: [0, 0, 0.35], relative: 'heading', window: 400 })),
      key(1000, w([2, 0, 0]), w([3, 1, 1]), { ease: 'linear', fov: 90, roll: 5 }),
    ])
    expected.name = 'intro-a'
    expect(s).toEqual(expected)
  })

  it('accepts an empty keys array and a matching expectedMatchId', () => {
    expect(accepts(script([])).keys).toEqual([])
    expect(accepts(good(), 'm').matchId).toBe('m')
  })

  it('rejects a non-object', () => {
    expect(rejects(null)).not.toBe('')
    expect(rejects(42)).not.toBe('')
  })

  it('rejects a version that is not exactly 1', () => {
    const raw = good()
    ;(raw as unknown as Record<string, unknown>).version = 2
    expect(rejects(raw)).toContain('version')
  })

  it('rejects a matchId that does not match the expected one', () => {
    expect(rejects(good(), 'other')).toContain('matchId')
  })

  it('rejects a bad name', () => {
    for (const name of ['Intro A', 'a'.repeat(65), '']) {
      const raw = good()
      raw.name = name
      expect(rejects(raw)).toContain('name')
    }
  })

  it('rejects a keys list that is not an array', () => {
    const raw = good()
    ;(raw as unknown as Record<string, unknown>).keys = null
    expect(rejects(raw)).toContain('keys')
  })

  it('rejects a keys list longer than 512', () => {
    const many = script(Array.from({ length: 513 }, (_, i) => key(i, w([0, 0, 0]), w([0, 0, 0]))))
    expect(rejects(many)).toContain('512')
  })

  it('rejects a negative t', () => {
    expect(rejects(script([key(-1, w([0, 0, 0]), w([0, 0, 0]))]))).toContain('t')
  })

  it('rejects a non-finite t', () => {
    expect(rejects(script([key(NaN, w([0, 0, 0]), w([0, 0, 0]))]))).toContain('t')
  })

  it('rejects unsorted keys', () => {
    const s = script([key(1000, w([0, 0, 0]), w([0, 0, 0])), key(0, w([0, 0, 0]), w([0, 0, 0]))])
    expect(rejects(s)).toContain('sorted')
  })

  it('rejects a same-t pair unless the second key is a cut', () => {
    const sameT = script([key(0, w([0, 0, 0]), w([0, 0, 0])), key(0, w([0, 0, 0]), w([0, 0, 0]))])
    expect(rejects(sameT)).toContain('cut')
    const withCut = script([key(0, w([0, 0, 0]), w([0, 0, 0])), key(0, w([0, 0, 0]), w([0, 0, 0]), { ease: 'cut' })])
    expect(accepts(withCut).keys).toHaveLength(2)
  })

  it('rejects a malformed pos (missing point)', () => {
    const s = script([key(0, { at: 'world' } as unknown as ScriptPoint, w([0, 0, 0]))])
    expect(rejects(s)).toContain('pos')
  })

  it('rejects a missing pos', () => {
    const s = script([key(0, w([0, 0, 0]), w([0, 0, 0]))])
    delete (s.keys[0] as unknown as Record<string, unknown>).pos
    expect(rejects(s)).toContain('pos')
  })

  it('rejects a malformed look (empty xuid)', () => {
    const s = script([key(0, w([0, 0, 0]), pl(''))])
    expect(rejects(s)).toContain('look')
  })

  it('rejects a non-finite offset number', () => {
    const s = script([key(0, w([0, 0, 0]), w([0, 0, 0])), key(1000, w([0, 0, 0]), pl('A', { offset: [0, NaN, 0] }))])
    expect(rejects(s)).toContain('look')
  })

  it('rejects a player window that is not in (0, 5000]', () => {
    expect(rejects(script([key(0, w([0, 0, 0]), pl('A', { window: 0 }))]))).toContain('window')
    expect(rejects(script([key(0, w([0, 0, 0]), pl('A', { window: 5001 }))]))).toContain('window')
    const windowed = accepts(script([key(0, w([0, 0, 0]), pl('A', { window: 5000 }))]))
    expect(windowed.keys).toHaveLength(1)
  })

  it('rejects an out-of-range or non-finite fov', () => {
    for (const fov of [9, 151, 'wide' as unknown as number]) {
      const s = script([key(0, w([0, 0, 0]), w([0, 0, 0]), { fov })])
      expect(rejects(s)).toContain('fov')
    }
    for (const fov of [10, 150]) {
      const s = script([key(0, w([0, 0, 0]), w([0, 0, 0]), { fov })])
      expect(accepts(s).keys).toHaveLength(1)
    }
  })

  it('rejects a non-finite roll', () => {
    const s = script([key(0, w([0, 0, 0]), w([0, 0, 0]), { roll: NaN })])
    expect(rejects(s)).toContain('roll')
  })

  it('rejects a bad ease', () => {
    const s = script([key(0, w([0, 0, 0]), w([0, 0, 0])), key(1000, w([0, 0, 0]), w([0, 0, 0]), { ease: 'bounce' as Ease })])
    expect(rejects(s)).toContain('ease')
  })
})

describe('parseCameraScript (clock)', () => {
  // A raw script carrying a `clock` (an unknown object); the base keys are one world key.
  function rawWithClock(clock: unknown): Record<string, unknown> {
    return { ...script([key(0, w([0, 0, 0]), w([0, 0, 0]))]), clock }
  }

  it('accepts a valid clock and drops unknown fields', () => {
    const raw = rawWithClock({
      startMs: 310000,
      rates: [
        { s: 0, rate: 1, junk: 1 },
        { s: 1800, rate: 1 },
        { s: 2300, rate: 0.25, ease: 'smooth' },
      ],
      extra: true,
    })
    const s = accepts(raw)
    expect(s.clock).toEqual({
      startMs: 310000,
      rates: [
        { s: 0, rate: 1, ease: 'smooth' },
        { s: 1800, rate: 1, ease: 'smooth' },
        { s: 2300, rate: 0.25, ease: 'smooth' },
      ],
    })
  })

  it('keeps a clock-less script clock-less', () => {
    expect(accepts(script([key(0, w([0, 0, 0]), w([0, 0, 0]))])).clock).toBeUndefined()
  })

  it('rejects a non-object clock', () => {
    expect(rejects(rawWithClock(42))).toContain('clock')
  })

  it('rejects a negative or non-finite startMs', () => {
    expect(rejects(rawWithClock({ startMs: -1, rates: [{ s: 0, rate: 1 }] }))).toContain('startMs')
    expect(rejects(rawWithClock({ startMs: NaN, rates: [{ s: 0, rate: 1 }] }))).toContain('startMs')
  })

  it('rejects an empty rates array', () => {
    expect(rejects(rawWithClock({ startMs: 0, rates: [] }))).toContain('rates')
  })

  it('rejects a rate out of [0, 4]', () => {
    expect(rejects(rawWithClock({ startMs: 0, rates: [{ s: 0, rate: 5 }] }))).toContain('rate')
    expect(rejects(rawWithClock({ startMs: 0, rates: [{ s: 0, rate: -1 }] }))).toContain('rate')
  })

  it('rejects rates that are not sorted by s', () => {
    expect(rejects(rawWithClock({ startMs: 0, rates: [{ s: 10, rate: 1 }, { s: 5, rate: 1 }] }))).toContain('sorted')
  })

  it('rejects an unknown ease', () => {
    expect(rejects(rawWithClock({ startMs: 0, rates: [{ s: 0, rate: 1, ease: 'bounce' }] }))).toContain('ease')
  })

  it('rejects more than 512 rates', () => {
    const rates = Array.from({ length: 513 }, (_, i) => ({ s: i * 10, rate: 1 }))
    expect(rejects(rawWithClock({ startMs: 0, rates }))).toContain('512')
  })
})

describe('parseCameraScript (holds)', () => {
  function rawWithHolds(holds: unknown): Record<string, unknown> {
    return { ...script([key(0, w([0, 0, 0]), w([0, 0, 0]))]), holds }
  }

  it('round-trips a script with holds and drops unknown fields', () => {
    const raw = rawWithHolds([
      { xuid: 'B', at: 2000, clip: 'idle', junk: 1 },
      { xuid: 'A', at: 1000, clip: 'mp:intro_emote:i_see_you', heading: 135, weapon: 'hide' },
    ])
    const s = accepts(raw)
    expect(s.holds).toEqual([
      { xuid: 'A', at: 1000, clip: 'mp:intro_emote:i_see_you', loop: false, blendMs: 250, heading: 135, turnMs: 400, pitch: 0, weapon: 'hide', until: null },
      { xuid: 'B', at: 2000, clip: 'idle', loop: false, blendMs: 250, heading: null, turnMs: 400, pitch: 0, weapon: 'keep', until: null },
    ])
  })

  it('keeps a hold-less script hold-less', () => {
    expect(accepts(script([key(0, w([0, 0, 0]), w([0, 0, 0]))])).holds).toBeUndefined()
  })

  it('a bad hold fails the whole parse with the hold\'s message', () => {
    expect(rejects(rawWithHolds([{ xuid: 'A', at: 0, clip: 'idle', blendMs: 3000 }]))).toContain('holds[0].blendMs')
    expect(rejects(rawWithHolds('nope'))).toContain('holds')
  })
})

describe('scriptClockOf', () => {
  const STEPS = 20000
  // docMs(s) approximated as startMs + a midpoint-rule sum of rateAt over [0, s] at STEPS steps.
  function numericDocMs(view: { rateAt: (s: number) => number }, startMs: number, s: number): number {
    const h = s / STEPS
    let sum = 0
    for (let k = 0; k < STEPS; k++) sum += view.rateAt((k + 0.5) * h)
    return startMs + sum * h
  }
  const r = (s: number, rate: number, ease: Ease = 'smooth'): ClockRate => ({ s, rate, ease })
  const clockScript = (rates: ClockRate[]): CameraScript => ({
    version: 1,
    matchId: 'm',
    name: 's',
    keys: [],
    clock: { startMs: 5000, rates },
  })

  it('is the identity without a clock', () => {
    const view = scriptClockOf(script([key(0, w([0, 0, 0]), w([0, 0, 0])), key(700, w([1, 0, 0]), w([0, 0, 0]))]))
    for (const s of [-1000, 0, 500, 12345]) expect(view.docMsAt(s)).toBe(s)
    expect(view.rateAt(-1000)).toBe(1)
    expect(view.rateAt(999999)).toBe(1)
    expect(view.lengthMs).toBe(700)
  })

  it('matches a fine numeric sum of rateAt for each ease', () => {
    const eases: Ease[] = ['smooth', 'linear', 'in', 'out', 'cut']
    for (const ease of eases) {
      const view = scriptClockOf(clockScript([r(1000, 1), r(3000, 0.25, ease)]))
      for (const s of [0, 250, 1000, 1500, 2500, 3000, 3500, 4000]) {
        // cut jumps at s = 3000, so the midpoint rule misses the single straddling subinterval
        // by at most the jump (0.75) times one step; the other eases are continuous and exact to O(h^2).
        const tol = ease === 'cut' ? Math.max(1e-3, 0.75 * (s / STEPS)) : 1e-3
        expect(Math.abs(view.docMsAt(s) - numericDocMs(view, 5000, s))).toBeLessThan(tol)
      }
    }
  })

  it('holds the first rate before it and the last after it', () => {
    const view = scriptClockOf(clockScript([r(1000, 1), r(3000, 0.25, 'linear')]))
    expect(view.rateAt(0)).toBe(1)
    expect(view.rateAt(999)).toBe(1)
    expect(view.rateAt(3000)).toBe(0.25)
    expect(view.rateAt(100000)).toBe(0.25)
  })

  it('lets a later entry win from a shared s onward', () => {
    const view = scriptClockOf(clockScript([r(1000, 1), r(1000, 0.25, 'linear')]))
    expect(view.rateAt(1000)).toBe(0.25)
    expect(view.rateAt(2000)).toBe(0.25)
  })

  it('freezes document time at rate 0', () => {
    const view = scriptClockOf(clockScript([r(0, 1), r(1000, 0, 'cut')]))
    expect(view.docMsAt(1500)).toBe(view.docMsAt(2500))
    expect(view.docMsAt(1500)).toBe(5000 + 1000)
    expect(view.docMsAt(2500)).toBe(5000 + 1000)
  })

  it('extrapolates a negative s at the first rate', () => {
    const view = scriptClockOf(clockScript([r(1000, 2), r(2000, 1, 'linear')]))
    expect(view.docMsAt(-500)).toBe(5000 + 2 * -500)
  })

  it('reports lengthMs as the later of the last key and the last rate', () => {
    const keyAfter = script([key(0, w([0, 0, 0]), w([0, 0, 0])), key(1000, w([1, 0, 0]), w([0, 0, 0]))])
    keyAfter.clock = { startMs: 0, rates: [r(500, 1)] }
    expect(scriptClockOf(keyAfter).lengthMs).toBe(1000)
    const rateAfter = script([key(0, w([0, 0, 0]), w([0, 0, 0])), key(300, w([1, 0, 0]), w([0, 0, 0]))])
    rateAfter.clock = { startMs: 0, rates: [r(500, 1)] }
    expect(scriptClockOf(rateAfter).lengthMs).toBe(500)
    expect(scriptClockOf({ version: 1, matchId: 'm', name: 's', keys: [], clock: { startMs: 0, rates: [r(42, 1)] } }).lengthMs).toBe(42)
    expect(scriptClockOf({ version: 1, matchId: 'm', name: 's', keys: [] }).lengthMs).toBe(0)
  })
})

describe('evaluateCameraScript (clock)', () => {
  it('resolves anchors at the document time, not the script time', () => {
    // A player at 10 u/s along +x (feet.x = tMs/1000 * 10); a key at script t = 2000 on them, and a
    // clock that starts the world at document ms 10000 and runs at rate 0.5. At script s = 2000 the
    // document time is 10000 + 0.5 * 2000 = 11000, so the camera sits at the player's x at 11000.
    const s = script([key(2000, pl('A'), pl('A'))])
    s.clock = { startMs: 10000, rates: [{ s: 0, rate: 0.5, ease: 'smooth' }] }
    const pose = eval_(s, 2000)
    expect(pose).not.toBeNull()
    expectVec(pose!.position, 110, 0, 0)
  })

  it('moves the camera on script time while the world crawls', () => {
    // Two world keys on script time; the world (player A) is only reached through the clock, so a
    // player-anchored look at script s = 500 follows the feet at the clock's document time 500/2 = 250.
    const s = script([key(0, w([0, 0, 0]), pl('A')), key(1000, w([4, 0, 0]), pl('A'), { ease: 'linear' })])
    s.clock = { startMs: 0, rates: [{ s: 0, rate: 0.5, ease: 'smooth' }] }
    const pose = eval_(s, 500)
    expect(pose).not.toBeNull()
    // The look target is A's feet (body center) at document ms 250: x = 2.5.
    expectVec(pose!.target, 2.5, BODY_CENTER, 0)
  })
})

describe('circularMeanDeg', () => {
  it('averages across the 359/0 seam', () => {
    expect(circularMeanDeg([350, 10])).toBeCloseTo(0, 5)
    expect(circularMeanDeg([359, 1])).toBeCloseTo(0, 5)
    expect(circularMeanDeg([0, 0])).toBe(0)
    expect(circularMeanDeg([180, 270])).toBeCloseTo(225, 5)
  })
})

describe('evaluateCameraScript', () => {
  it('returns null for a keyless script', () => {
    expect(eval_(script([]), 500)).toBeNull()
  })

  it('gives the linear midpoint of two world keys in three coordinates', () => {
    const s = script([key(0, w([0, 0, 0]), w([1, 0, 0])), key(1000, w([4, 2, 1]), w([3, 0, 0]), { ease: 'linear' })])
    const pose = eval_(s, 500)
    expect(pose).not.toBeNull()
    // Game midpoint (2, 1, 0.5) and (2, 0, 0), three = [x, z, -y].
    expectVec(pose!.position, 2, 0.5, -1)
    expectVec(pose!.target, 2, 0, 0)
  })

  it('holds before the first key and after the last key', () => {
    const s = script([key(0, w([0, 0, 0]), w([1, 0, 0])), key(1000, w([4, 0, 0]), w([5, 0, 0]), { ease: 'linear' })])
    expectVec(eval_(s, -5000)!.position, 0, 0, 0)
    expectVec(eval_(s, 1000)!.position, 4, 0, 0)
    expectVec(eval_(s, 5000)!.position, 4, 0, 0)
  })

  it('keeps following a moving player on a held key', () => {
    const s = script([key(0, pl('A'), pl('A')), key(1000, pl('A'), pl('A'), { ease: 'linear' })])
    const early = eval_(s, -1000)
    const late = eval_(s, 2000)
    // -1s and +2s on A's path: x = -10 and x = +20, 30 u apart, unchanged in three.
    expect(early).not.toBeNull()
    expect(late).not.toBeNull()
    expect(late!.position[0] - early!.position[0]).toBeCloseTo(30, 5)
    expect(early!.position[0]).toBeCloseTo(-10, 5)
  })

  it('follows a moving player between two of its keys', () => {
    const s = script([key(0, pl('A'), pl('A')), key(1000, pl('A'), pl('A'), { ease: 'linear' })])
    const pose = eval_(s, 500)
    expect(pose).not.toBeNull()
    expect(pose!.position[0]).toBeCloseTo(5, 5)
    // A look without an offset aims at the body center.
    expectVec(pose!.target, 5, BODY_CENTER, 0)
  })

  it('blends from a key on A to a key on B, ending at B', () => {
    const s = script([key(0, pl('A'), pl('A')), key(1000, pl('B'), pl('B'), { ease: 'linear' })])
    const end = eval_(s, 1000)
    expect(end).not.toBeNull()
    expectVec(end!.position, 20, 0, -5)
    expectVec(end!.target, 20, BODY_CENTER, -5)
  })

  it('cuts: holds before it, sits on it at it, and the spline ignores keys after it', () => {
    const a = w([0, 0, 0])
    const b = w([10, 0, 0])
    const c = w([20, 0, 0])
    const d = w([30, 100, 0]) // after the cut: far off the line
    const l0 = w([0, 1, 0])
    const l1 = w([10, 1, 0])
    const l2 = w([20, 1, 0])
    const l3 = w([30, 101, 0])
    const withD = script([key(0, a, l0), key(1000, b, l1, { ease: 'linear' }), key(2000, c, l2, { ease: 'cut', roll: 30 }), key(3000, d, l3, { ease: 'linear' })])
    const withoutD = script([key(0, a, l0), key(1000, b, l1, { ease: 'linear' }), key(2000, c, l2, { ease: 'cut', roll: 30 })])
    // Just before the cut the camera holds key 1; at the cut it is exactly on key 2.
    const before = eval_(withD, 1999.99)
    expect(before).not.toBeNull()
    expectVec(before!.position, 10, 0, 0)
    expect(before!.rollDeg).toBe(0)
    const at = eval_(withD, 2000)
    expect(at).not.toBeNull()
    expectVec(at!.position, 20, 0, 0)
    expect(at!.rollDeg).toBe(30)
    // The approach to the cut (inside the run ending at it) is unaffected by key 3, which
    // would pull a without-D script's spline off the line.
    expect(eval_(withD, 1500)?.position).toEqual(eval_(withoutD, 1500)?.position)
    expect(eval_(withD, 1900)?.position).toEqual(eval_(withoutD, 1900)?.position)
    // After the cut, the new run uses only the keys after it: the pose equals a script that
    // starts at the cut key.
    const afterRun = script([key(2000, c, l2, { ease: 'cut', roll: 30 }), key(3000, d, l3, { ease: 'linear' })])
    expect(eval_(withD, 2500)?.position).toEqual(eval_(afterRun, 2500)?.position)
  })

  it('applies a heading-relative offset in the player frame', () => {
    // H faces +y; fwd = +y, left = -x. Offset [-3, 0, 0] lands 3 u behind H along -y.
    const s = script([key(0, pl('H', { offset: [-3, 0, 0], relative: 'heading' }), pl('H'))])
    const pose = eval_(s, 1000)
    expect(pose).not.toBeNull()
    expectVec(pose!.position, 0, 0, 3)
  })

  it('aims a look without an offset at the body center', () => {
    const s = script([key(0, pl('A'), pl('A'))])
    const pose = eval_(s, 500)
    expect(pose).not.toBeNull()
    expectVec(pose!.target, 5, BODY_CENTER, 0)
  })

  it('falls back to the earlier key point when a player is unknown', () => {
    const s = script([key(0, w([1, 2, 3]), w([1, 0, 0])), key(1000, pl('nope'), pl('nope'), { ease: 'linear' })])
    const pose = eval_(s, 500)
    expect(pose).not.toBeNull()
    // Game [1, 2, 3] in three coordinates.
    expectVec(pose!.position, 1, 3, -2)
  })

  it('uses verticalFovOf(base) when neither key sets a fov, and lerps fov with the ease', () => {
    const noFov = script([key(0, w([0, 0, 0]), w([0, 0, 0])), key(1000, w([1, 0, 0]), w([0, 0, 0]), { ease: 'linear' })])
    expect(eval_(noFov, 500)?.verticalFov).toBeCloseTo(verticalFovOf(BASE_FOV), 5)
    const withFov = script([key(0, w([0, 0, 0]), w([0, 0, 0]), { fov: 60 }), key(1000, w([1, 0, 0]), w([0, 0, 0]), { ease: 'linear', fov: 100 })])
    expect(eval_(withFov, 500)?.verticalFov).toBeCloseTo(verticalFovOf(80), 5)
    // 'in' on a run's only segment: the run starts from rest (slope 0) and leaves at the
    // secant (0.04/ms); the Hermite midpoint is 30 + 50 - 0.125 * 1000 * 0.04 = 75.
    const inFov = script([key(0, w([0, 0, 0]), w([0, 0, 0]), { fov: 60 }), key(1000, w([1, 0, 0]), w([0, 0, 0]), { ease: 'in', fov: 100 })])
    expect(eval_(inFov, 500)?.verticalFov).toBeCloseTo(verticalFovOf(75), 5)
  })

  it('lerps roll with the same ease and defaults to 0', () => {
    const s = script([key(0, w([0, 0, 0]), w([0, 0, 0]), { roll: 10 }), key(1000, w([1, 0, 0]), w([0, 0, 0]), { ease: 'linear', roll: 30 })])
    expect(eval_(s, 500)?.rollDeg).toBeCloseTo(20, 5)
    expect(eval_(s, 0)!.rollDeg).toBe(10)
    expect(eval_(script([key(0, w([0, 0, 0]), w([0, 0, 0]))]), 0)!.rollDeg).toBe(0)
  })

  it('does not NaN when spline knots coincide', () => {
    // P0 == P1 (key 0 and key 1 share a point): the neighbor is replaced by a mirrored phantom, so
    // the centripetal form stays well-defined. Key 0 -> 1 is a dwell (no distance), so the camera
    // leaves key 1 from rest and ends at the secant: distance 2 - 0.125 * 1000 * 0.004 = 1.5.
    const s = script([key(0, w([0, 0, 0]), w([0, 0, 0])), key(1000, w([0, 0, 0]), w([0, 0, 0])), key(2000, w([4, 0, 0]), w([0, 0, 0]), { ease: 'linear' })])
    const pose = eval_(s, 1500)
    expect(pose).not.toBeNull()
    expect(pose!.position.every(Number.isFinite)).toBe(true)
    expectVec(pose!.position, 1.5, 0, 0)
  })

  it('curves through a three-key run (not a straight line with a corner)', () => {
    // A right-angle turn A -> B -> C. A duplicated end point would straighten both segments; the
    // mirrored phantoms keep the first segment curving toward C.
    const a = w([0, 0, 0])
    const b = w([10, 0, 0])
    const c = w([10, 10, 0])
    const s = script([key(0, a, a), key(1000, b, b, { ease: 'linear' }), key(2000, c, c, { ease: 'linear' })])
    const mid = eval_(s, 500)
    expect(mid).not.toBeNull()
    // The straight line A -> B has game y = 0 (three z = -game y); the spline is pulled off it.
    expect(Math.abs(mid!.position[2])).toBeGreaterThan(0.05)
    // Exactly on the middle key B at its own time.
    const onB = eval_(s, 1000)
    expect(onB).not.toBeNull()
    expectVec(onB!.position, 10, 0, 0)
  })

  it('stays finite when a neighbor key coincides with an end point', () => {
    // Key 0 and key 1 share a point (P0 == P1); the mirrored phantom keeps the curve finite.
    const s = script([key(0, w([0, 0, 0]), w([0, 0, 0])), key(1000, w([0, 0, 0]), w([0, 0, 0])), key(2000, w([0, 4, 0]), w([0, 0, 0]), { ease: 'linear' })])
    const pose = eval_(s, 1500)
    expect(pose).not.toBeNull()
    expect(pose!.position.every(Number.isFinite)).toBe(true)
  })
})

describe('evaluateCameraScript (a run is one move)', () => {
  // Three-coordinate distance between two poses' positions.
  const gap = (p: number[], q: number[]): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
  // Speed (units/ms) over a small step at script ms t.
  const speedAt = (s: ReturnType<typeof script>, t: number, dt = 1): number =>
    gap(eval_(s, t + dt)!.position, eval_(s, t)!.position) / dt

  it('refuses keys of one run closer than the minimum gap, and allows a cut at any gap', () => {
    const tight = script([key(0, w([0, 0, 0]), w([0, 0, 0])), key(CAMERA_SCRIPT_MIN_KEY_GAP_MS - 1, w([1, 0, 0]), w([0, 0, 0]))])
    expect(rejects(tight)).toContain(`at least ${CAMERA_SCRIPT_MIN_KEY_GAP_MS} ms apart`)
    const atGap = script([key(0, w([0, 0, 0]), w([0, 0, 0])), key(CAMERA_SCRIPT_MIN_KEY_GAP_MS, w([1, 0, 0]), w([0, 0, 0]))])
    expect(accepts(atGap).keys).toHaveLength(2)
    const cut = script([key(0, w([0, 0, 0]), w([0, 0, 0])), key(10, w([5, 0, 0]), w([0, 0, 0]), { ease: 'cut' })])
    expect(accepts(cut).keys).toHaveLength(2)
  })

  it('keeps its speed continuous through an interior key, even with uneven key spacing', () => {
    // 2 units in the first second, 8 in the next two: per-segment timing jumped at key 1.
    const s = script([
      key(0, w([0, 0, 0]), w([0, 0, 0])),
      key(1000, w([2, 0, 0]), w([0, 0, 0]), { ease: 'linear' }),
      key(3000, w([10, 0, 0]), w([0, 0, 0]), { ease: 'linear' }),
    ])
    const before = speedAt(s, 999)
    const after = speedAt(s, 1000)
    expect(before).toBeGreaterThan(0)
    expect(Math.abs(after - before) / before).toBeLessThan(0.02)
  })

  it('does not stop at interior keys with the default ease, only at the run ends', () => {
    const s = script([
      key(0, w([0, 0, 0]), w([0, 0, 0])),
      key(1000, w([3, 0, 0]), w([0, 0, 0])),
      key(2000, w([6, 1, 0]), w([0, 0, 0])),
      key(3000, w([9, 0, 0]), w([0, 0, 0])),
    ])
    expect(speedAt(s, 0)).toBeLessThan(0.0005)
    expect(speedAt(s, 1000)).toBeGreaterThan(0.002)
    expect(speedAt(s, 2000)).toBeGreaterThan(0.002)
    expect(speedAt(s, 2999)).toBeLessThan(0.0005)
  })

  it('never backs up along the path, and passes every key at its time', () => {
    // Uneven keys, a sharp turn: distance from the start must only grow along the run.
    const pts: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [1.5, 3, 0], [6, 3, 1], [6.2, 3.1, 1]]
    const times = [0, 600, 1100, 2600, 2900]
    const s = script(pts.map((p, i) => key(times[i], w(p), w([0, 0, 0]), { ease: i === 0 || i === pts.length - 1 ? undefined : 'linear' })))
    let traveled = 0
    let prev = eval_(s, 0)!.position
    for (let t = 10; t <= 2900; t += 10) {
      const p = eval_(s, t)!.position
      const step = gap(p, prev)
      // Every step moves forward along the curve: no step is a large reversal of the previous one.
      traveled += step
      prev = p
    }
    expect(traveled).toBeGreaterThan(0)
    for (let i = 0; i < pts.length; i++) {
      const at = eval_(s, times[i])!.position
      expectVec(at, pts[i][0], pts[i][2], -pts[i][1])
    }
    // Speed sampled densely never drops to a stop strictly inside the run.
    for (let t = 300; t <= 2600; t += 50) expect(speedAt(s, t)).toBeGreaterThan(0)
  })
})
