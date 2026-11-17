// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import type { ShotFxEntry } from '../model/shotFx'
import {
  RECOIL_ATTACK,
  RECOIL_CAP,
  RECOIL_PROFILES,
  newRecoil,
  recoilAt,
  recoilKindOfKey,
  recoilShape,
  recoilWindow,
  type Recoil,
  type RecoilProfile,
} from './recoil3d'
import { ShooterRecoil, firstAbove, indexShotTimes } from './recoilShots3d'

const FPS = 60
const precision = RECOIL_PROFILES.precision

/** The deviation at frame `frame` for shots at frames `frames` (seeds = rank). */
function at(frames: number[], frame: number, profile: RecoilProfile = precision, seeds?: number[]): Recoil {
  const s = seeds ?? frames.map((_, i) => 1000 + i)
  return recoilAt({ frames, seeds: s, from: 0, to: frames.length }, frame, FPS, profile, newRecoil())
}

describe('recoilShape', () => {
  const r = precision.recovery

  it('zero before the shot, peaks in one frame at 60 Hz, spring that overshoots a bit then returns', () => {
    expect(recoilShape(-0.001, r)).toBe(0)
    expect(recoilShape(0, r)).toBe(0)
    expect(recoilShape(RECOIL_ATTACK / 2, r)).toBeGreaterThan(0.5)
    expect(recoilShape(RECOIL_ATTACK, r)).toBeCloseTo(1, 9)
    // Monotonically decreasing until it dips below rest, at the midpoint of the return.
    expect(recoilShape(RECOIL_ATTACK + 0.25 * r, r)).toBeLessThan(1)
    expect(recoilShape(RECOIL_ATTACK + 0.25 * r, r)).toBeGreaterThan(0)
    const samples = Array.from({ length: 200 }, (_, i) => recoilShape(RECOIL_ATTACK + (i / 200) * r, r))
    const low = Math.min(...samples)
    expect(low).toBeLessThan(-0.03)
    expect(low).toBeGreaterThan(-0.1)
  })

  it('exactly zero as soon as the window ends', () => {
    const end = RECOIL_ATTACK + r
    expect(recoilShape(end, r)).toBe(0)
    expect(recoilShape(end + 0.5, r)).toBe(0)
    expect(Math.abs(recoilShape(end - 1e-4, r))).toBeLessThan(1e-5)
    expect(recoilWindow(precision)).toBeCloseTo(end)
    expect(recoilWindow(RECOIL_PROFILES.none)).toBe(0)
  })

  it('a return of 80 to 150 ms per family', () => {
    for (const kind of ['precision', 'automatic', 'heavy', 'energy'] as const) {
      expect(RECOIL_PROFILES[kind].recovery).toBeGreaterThanOrEqual(0.08)
      expect(RECOIL_PROFILES[kind].recovery).toBeLessThanOrEqual(0.15)
    }
  })
})

describe('recoilAt', () => {
  it('zero without a shot or once the window has passed', () => {
    expect(at([], 100)).toEqual({ back: 0, pitch: 0, yaw: 0, roll: 0 })
    const after = at([100], 100 + Math.ceil(recoilWindow(precision) * FPS))
    expect(after).toEqual({ back: 0, pitch: 0, yaw: 0, roll: 0 })
    expect(at([100], 99)).toEqual({ back: 0, pitch: 0, yaw: 0, roll: 0 })
  })

  it('one shot: recoil along the barrel and muzzle lifted, peaking one frame later', () => {
    const peak = at([100], 101)
    expect(peak.back).toBeGreaterThan(0.8 * precision.kick)
    expect(peak.back).toBeLessThan(1.2 * precision.kick)
    expect(peak.pitch / peak.back).toBeCloseTo(precision.pitch / precision.kick, 9)
    expect(Math.abs(peak.yaw)).toBeLessThanOrEqual(precision.jitter)
    expect(Math.abs(peak.roll)).toBeLessThanOrEqual(precision.jitter)
    expect(at([100], 104).back).toBeLessThan(peak.back)
  })

  it('automatic fire holds a bounded shake, with no drift', () => {
    const auto = RECOIL_PROFILES.automatic
    // 30 rounds per second for 4 s (continuous fire): never past the cap.
    const frames = Array.from({ length: 120 }, (_, i) => 100 + 2 * i)
    let most = 0
    for (let f = 100; f < 340; f += 0.5) most = Math.max(most, at(frames, f, auto).back)
    expect(most).toBeLessThanOrEqual(RECOIL_CAP * auto.kick + 1e-12)
    expect(most).toBeGreaterThan(auto.kick)
    // A held deviation that still moves from frame to frame (a shake, not a frozen pose).
    const late = [300, 301, 302, 303].map((f) => at(frames, f, auto).back)
    expect(Math.max(...late) - Math.min(...late)).toBeGreaterThan(0)
  })

  it('the scale follows the family: heavy > precision > automatic > energy; melee has no recoil', () => {
    const peak = (p: RecoilProfile) => at([100], 101, p, [7]).back
    expect(peak(RECOIL_PROFILES.heavy)).toBeGreaterThan(peak(precision))
    expect(peak(precision)).toBeGreaterThan(peak(RECOIL_PROFILES.automatic))
    expect(peak(RECOIL_PROFILES.automatic)).toBeGreaterThan(peak(RECOIL_PROFILES.energy))
    expect(at([100], 101, RECOIL_PROFILES.none)).toEqual({ back: 0, pitch: 0, yaw: 0, roll: 0 })
  })

  it('deterministic on the seed: same seed same deviation, neighboring seeds different noise', () => {
    expect(at([100], 101, precision, [42])).toEqual(at([100], 101, precision, [42]))
    const a = at([100], 101, precision, [42])
    const b = at([100], 101, precision, [43])
    expect(a.yaw).not.toBe(b.yaw)
    expect(a.roll).not.toBe(b.roll)
  })

  it('symmetric played backward: the same frame returns the same deviation, whatever the path', () => {
    const frames = [100, 104, 108, 140]
    const forward = new Map<number, Recoil>()
    for (let f = 95; f <= 150; f += 0.5) forward.set(f, at(frames, f))
    for (let f = 150; f >= 95; f -= 0.5) expect(at(frames, f)).toEqual(forward.get(f))
  })
})

describe('recoilKindOfKey', () => {
  it('sorts the game\'s weapons by family; precision by default', () => {
    expect(recoilKindOfKey('hinf_br75')).toBe('precision')
    expect(recoilKindOfKey('hinf_sidekick')).toBe('precision')
    expect(recoilKindOfKey('hinf_ma40_ar')).toBe('automatic')
    expect(recoilKindOfKey('hinf_cqs48_bulldog')).toBe('heavy')
    expect(recoilKindOfKey('hinf_s7_sniper')).toBe('heavy')
    expect(recoilKindOfKey('hinf_m41_spnkr')).toBe('heavy')
    expect(recoilKindOfKey('hinf_plasma_pistol')).toBe('energy')
    expect(recoilKindOfKey('hinf_energy_sword')).toBe('none')
    expect(recoilKindOfKey('hinf_unknown')).toBe('precision')
    expect(recoilKindOfKey(undefined)).toBe('precision')
  })
})

describe('a shooter\'s recent shots', () => {
  const shot = (slot: number, frame: number, seed: number, arme?: 'vehicule' | 'joueur', o?: number): ShotFxEntry => ({
    frame, time: frame + (o ?? 0) / 100, slot, x: 0, y: 0, h: 0, fam: 'ballistic', tint: 'kinetic', seed,
    vehicleShot: arme ? { mount: null, arme, family: undefined, headingDeg: 0, shooterHeadingDeg: null } : null,
  }) as ShotFxEntry

  it('firstAbove: binary-search bounds', () => {
    const f = new Float64Array([1, 3, 3, 7])
    expect(firstAbove(f, 3, false)).toBe(1)
    expect(firstAbove(f, 3, true)).toBe(3)
    expect(firstAbove(f, 0, false)).toBe(0)
    expect(firstAbove(f, 9, true)).toBe(4)
  })

  it('sorts by slot, sorted; a vehicle weapon\'s shot does not count', () => {
    const index = indexShotTimes([shot(2, 50, 1), shot(1, 30, 2), shot(2, 10, 3), shot(2, 20, 4, 'vehicule'), shot(2, 40, 5, 'joueur')])
    expect([...(index.get(2)?.frames ?? [])]).toEqual([10, 40, 50])
    expect([...(index.get(2)?.seeds ?? [])]).toEqual([3, 5, 1])
    expect([...(index.get(1)?.frames ?? [])]).toEqual([30])
  })

  it('separates shots of the same frame by their intra-frame offset, in the film\'s order', () => {
    const index = indexShotTimes([shot(2, 10, 1, undefined, 60), shot(2, 10, 2, undefined, 0), shot(2, 10, 3, undefined, 30)])
    const frames = [...(index.get(2)?.frames ?? [])]
    expect(frames).toEqual([10, 10.3, 10.6])
    expect(frames[0] < frames[1] && frames[1] < frames[2]).toBe(true)
  })

  it('ShooterRecoil: the weapon in hand gives the family, the slot\'s shots give the deviation', () => {
    const shots = [shot(4, 100, 9), shot(5, 100, 9)]
    const doc = { weaponLabels: { br: { key: 'hinf_br75' }, sword: { key: 'hinf_energy_sword' } } }
    const recoil = new ShooterRecoil(doc as never, () => ({ shotFx: shots, framesPerSecond: FPS }))
    const out = newRecoil()
    expect(recoil.at(4, 101, 'br', out)).toEqual(at([100], 101, precision, [9]))
    expect(recoil.at(4, 101, 'sword', out).back).toBe(0)
    expect(recoil.at(6, 101, 'br', out).back).toBe(0)
    expect(recoil.at(4, 140, 'br', out).back).toBe(0)
  })
})
