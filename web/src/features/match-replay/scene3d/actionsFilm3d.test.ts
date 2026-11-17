// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { testReplayDoc } from '../test/testDoc'
import { sautDepuisAction } from './actionsFilm3d'
import { buildTracks3d } from './tracks3d'

function film(z: number[], pleinDebit = true) {
  const t = z.map((_, i) => pleinDebit ? i / 6 : i)
  const doc = testReplayDoc({ frameIntervalMs: 100, tracks: [{ slot: 1, team: 0, xuid: 'A',
    startFrame: 0, endFrame: 20, points: [{ t: 0, x: 0, y: 0, z: z[0] }, { t: 20, x: 0, y: 0, z: z.at(-1) }] }] })
  const points = t.map((temps, i) => ({ t: temps, x: 0, y: 0, z: z[i] }))
  const fullRate = { t, x: t.map(() => 0), y: t.map(() => 0), z, gaps: [], aimT: [], h: [], p: [] }
  return { ...doc, tracks: [{ ...doc.tracks[0], points, ...(pleinDebit ? { fullRate } : {}) }] }
}

function fin(doc: ReturnType<typeof film>) {
  return sautDepuisAction(doc, buildTracks3d(doc), 1, 0).t1 + 1
}

describe('réception du saut du film', () => {
  it('détecte un saut à plat au plein débit', () => {
    expect(fin(film([0, 0.1, 0.2, 0.1, 0, 0, 0]))).toBeCloseTo(4 / 6)
  })
  it('détecte une réception plus haute après la montée', () => {
    expect(fin(film([0, 0.1, 0.2, ...Array.from({ length: 16 }, () => 0.3)]))).toBeCloseTo(3 / 6)
  })
  it('ne prend pas le sommet d’un saut balistique pour une réception', () => {
    // 60 Hz : montée 1,6 u/s, pesanteur 4 u/s², sol retrouvé vers 0,8 s.
    const z = Array.from({ length: 80 }, (_, i) => Math.max(0, 1.6 * (i / 60) - 2 * (i / 60) ** 2))
    const doc = film(z)
    const t = z.map((_, i) => i / 6)
    doc.tracks[0].points = t.map((temps, i) => ({ t: temps, x: 0, y: 0, z: z[i] }))
    doc.tracks[0].fullRate = { ...doc.tracks[0].fullRate!, t, x: t.map(() => 0), y: t.map(() => 0) }
    expect(fin(doc)).toBeGreaterThan(7.5)
    expect(fin(doc)).toBeLessThan(8.5)
  })
  it('garde une chute longue jusqu’au plafond de 1,5 s', () => {
    expect(fin(film(Array.from({ length: 100 }, (_, i) => -i * 0.1)))).toBe(15)
  })
  it('coupe au début de l’escalade du même emplacement', () => {
    const doc = film(Array.from({ length: 100 }, (_, i) => -i * 0.1))
    doc.stances = [{ slot: 2, kind: 'clamber', t0: 2, t1: 3 }, { slot: 1, kind: 'clamber', t0: 4, t1: 6 }]
    expect(fin(doc)).toBe(4)
  })
  it('reconnaît la même réception à 10 Hz', () => {
    expect(fin(film([0, 0.2, 0.4, 0.2, 0, 0, 0], false))).toBe(4)
  })
  it('arrête à la dernière position avant une lacune', () => {
    const doc = film([0, 0.1, 0.2, 0.1, 0])
    doc.tracks[0].fullRate!.gaps = [3]
    expect(fin(doc)).toBeCloseTo(2 / 6)
  })
})
