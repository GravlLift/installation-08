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

/** L'écart à l'image `frame` des tirs aux images `frames` (germes = rang). */
function at(frames: number[], frame: number, profile: RecoilProfile = precision, seeds?: number[]): Recoil {
  const s = seeds ?? frames.map((_, i) => 1000 + i)
  return recoilAt({ frames, seeds: s, from: 0, to: frames.length }, frame, FPS, profile, newRecoil())
}

describe('recoilShape', () => {
  const r = precision.recovery

  it('zéro avant le tir, sommet en une image à 60 Hz, ressort qui dépasse un peu puis revient', () => {
    expect(recoilShape(-0.001, r)).toBe(0)
    expect(recoilShape(0, r)).toBe(0)
    expect(recoilShape(RECOIL_ATTACK / 2, r)).toBeGreaterThan(0.5)
    expect(recoilShape(RECOIL_ATTACK, r)).toBeCloseTo(1, 9)
    // Monotone descendant jusqu'au passage sous le repos, à mi-retour.
    expect(recoilShape(RECOIL_ATTACK + 0.25 * r, r)).toBeLessThan(1)
    expect(recoilShape(RECOIL_ATTACK + 0.25 * r, r)).toBeGreaterThan(0)
    const samples = Array.from({ length: 200 }, (_, i) => recoilShape(RECOIL_ATTACK + (i / 200) * r, r))
    const low = Math.min(...samples)
    expect(low).toBeLessThan(-0.03)
    expect(low).toBeGreaterThan(-0.1)
  })

  it('exactement zéro dès la fin de la fenêtre', () => {
    const end = RECOIL_ATTACK + r
    expect(recoilShape(end, r)).toBe(0)
    expect(recoilShape(end + 0.5, r)).toBe(0)
    expect(Math.abs(recoilShape(end - 1e-4, r))).toBeLessThan(1e-5)
    expect(recoilWindow(precision)).toBeCloseTo(end)
    expect(recoilWindow(RECOIL_PROFILES.none)).toBe(0)
  })

  it('un retour de 80 à 150 ms par famille', () => {
    for (const kind of ['precision', 'automatic', 'heavy', 'energy'] as const) {
      expect(RECOIL_PROFILES[kind].recovery).toBeGreaterThanOrEqual(0.08)
      expect(RECOIL_PROFILES[kind].recovery).toBeLessThanOrEqual(0.15)
    }
  })
})

describe('recoilAt', () => {
  it('zéro sans tir ou une fois la fenêtre passée', () => {
    expect(at([], 100)).toEqual({ back: 0, pitch: 0, yaw: 0, roll: 0 })
    const after = at([100], 100 + Math.ceil(recoilWindow(precision) * FPS))
    expect(after).toEqual({ back: 0, pitch: 0, yaw: 0, roll: 0 })
    expect(at([100], 99)).toEqual({ back: 0, pitch: 0, yaw: 0, roll: 0 })
  })

  it('un tir : recul le long du canon et bouche levée, au sommet une image après', () => {
    const peak = at([100], 101)
    expect(peak.back).toBeGreaterThan(0.8 * precision.kick)
    expect(peak.back).toBeLessThan(1.2 * precision.kick)
    expect(peak.pitch / peak.back).toBeCloseTo(precision.pitch / precision.kick, 9)
    expect(Math.abs(peak.yaw)).toBeLessThanOrEqual(precision.jitter)
    expect(Math.abs(peak.roll)).toBeLessThanOrEqual(precision.jitter)
    expect(at([100], 104).back).toBeLessThan(peak.back)
  })

  it('le feu automatique tient une secousse bornée, sans dérive', () => {
    const auto = RECOIL_PROFILES.automatic
    // 30 coups par seconde pendant 4 s (un tir continu) : jamais au-delà du plafond.
    const frames = Array.from({ length: 120 }, (_, i) => 100 + 2 * i)
    let most = 0
    for (let f = 100; f < 340; f += 0.5) most = Math.max(most, at(frames, f, auto).back)
    expect(most).toBeLessThanOrEqual(RECOIL_CAP * auto.kick + 1e-12)
    expect(most).toBeGreaterThan(auto.kick)
    // Un écart tenu, qui bouge d'une image à l'autre (une secousse, pas une pose figée).
    const late = [300, 301, 302, 303].map((f) => at(frames, f, auto).back)
    expect(Math.max(...late) - Math.min(...late)).toBeGreaterThan(0)
  })

  it('l’échelle suit la famille : lourde > précision > automatique > énergie ; mêlée sans recul', () => {
    const peak = (p: RecoilProfile) => at([100], 101, p, [7]).back
    expect(peak(RECOIL_PROFILES.heavy)).toBeGreaterThan(peak(precision))
    expect(peak(precision)).toBeGreaterThan(peak(RECOIL_PROFILES.automatic))
    expect(peak(RECOIL_PROFILES.automatic)).toBeGreaterThan(peak(RECOIL_PROFILES.energy))
    expect(at([100], 101, RECOIL_PROFILES.none)).toEqual({ back: 0, pitch: 0, yaw: 0, roll: 0 })
  })

  it('déterministe au germe : même germe même écart, germes voisins un autre bruit', () => {
    expect(at([100], 101, precision, [42])).toEqual(at([100], 101, precision, [42]))
    const a = at([100], 101, precision, [42])
    const b = at([100], 101, precision, [43])
    expect(a.yaw).not.toBe(b.yaw)
    expect(a.roll).not.toBe(b.roll)
  })

  it('symétrique en lecture arrière : la même image rend le même écart, quel que soit le chemin', () => {
    const frames = [100, 104, 108, 140]
    const forward = new Map<number, Recoil>()
    for (let f = 95; f <= 150; f += 0.5) forward.set(f, at(frames, f))
    for (let f = 150; f >= 95; f -= 0.5) expect(at(frames, f)).toEqual(forward.get(f))
  })
})

describe('recoilKindOfKey', () => {
  it('range les armes du jeu par famille ; précision par défaut', () => {
    expect(recoilKindOfKey('hinf_br75')).toBe('precision')
    expect(recoilKindOfKey('hinf_sidekick')).toBe('precision')
    expect(recoilKindOfKey('hinf_ma40_ar')).toBe('automatic')
    expect(recoilKindOfKey('hinf_cqs48_bulldog')).toBe('heavy')
    expect(recoilKindOfKey('hinf_s7_sniper')).toBe('heavy')
    expect(recoilKindOfKey('hinf_m41_spnkr')).toBe('heavy')
    expect(recoilKindOfKey('hinf_plasma_pistol')).toBe('energy')
    expect(recoilKindOfKey('hinf_energy_sword')).toBe('none')
    expect(recoilKindOfKey('hinf_inconnue')).toBe('precision')
    expect(recoilKindOfKey(undefined)).toBe('precision')
  })
})

describe('les tirs récents d’un tireur', () => {
  const shot = (slot: number, frame: number, seed: number, arme?: 'vehicule' | 'joueur', o?: number): ShotFxEntry => ({
    frame, time: frame + (o ?? 0) / 100, slot, x: 0, y: 0, h: 0, fam: 'ballistic', tint: 'kinetic', seed,
    vehicleShot: arme ? { mount: null, arme, family: undefined, headingDeg: 0, shooterHeadingDeg: null } : null,
  }) as ShotFxEntry

  it('firstAbove : bornes dichotomiques', () => {
    const f = new Float64Array([1, 3, 3, 7])
    expect(firstAbove(f, 3, false)).toBe(1)
    expect(firstAbove(f, 3, true)).toBe(3)
    expect(firstAbove(f, 0, false)).toBe(0)
    expect(firstAbove(f, 9, true)).toBe(4)
  })

  it('range par emplacement, trié ; un tir d’arme de véhicule ne compte pas', () => {
    const index = indexShotTimes([shot(2, 50, 1), shot(1, 30, 2), shot(2, 10, 3), shot(2, 20, 4, 'vehicule'), shot(2, 40, 5, 'joueur')])
    expect([...(index.get(2)?.frames ?? [])]).toEqual([10, 40, 50])
    expect([...(index.get(2)?.seeds ?? [])]).toEqual([3, 5, 1])
    expect([...(index.get(1)?.frames ?? [])]).toEqual([30])
  })

  it('sépare les tirs d’une même frame par leur offset intra-frame, à l’ordre du film', () => {
    const index = indexShotTimes([shot(2, 10, 1, undefined, 60), shot(2, 10, 2, undefined, 0), shot(2, 10, 3, undefined, 30)])
    const frames = [...(index.get(2)?.frames ?? [])]
    expect(frames).toEqual([10, 10.3, 10.6])
    expect(frames[0] < frames[1] && frames[1] < frames[2]).toBe(true)
  })

  it('ShooterRecoil : l’arme en main donne la famille, les tirs de l’emplacement donnent l’écart', () => {
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
