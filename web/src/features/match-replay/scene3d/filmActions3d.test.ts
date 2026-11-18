// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { testReplayDoc } from '../test/testDoc'
import { jumpFromAction } from './filmActions3d'
import { buildTracks3d } from './tracks3d'

function film(z: number[], atFullRate = true) {
  const t = z.map((_, i) => atFullRate ? i / 6 : i)
  const doc = testReplayDoc({ frameIntervalMs: 100, tracks: [{ slot: 1, team: 0, xuid: 'A',
    startFrame: 0, endFrame: 20, points: [{ t: 0, x: 0, y: 0, z: z[0] }, { t: 20, x: 0, y: 0, z: z.at(-1) }] }] })
  const points = t.map((time, i) => ({ t: time, x: 0, y: 0, z: z[i] }))
  const fullRate = { t, x: t.map(() => 0), y: t.map(() => 0), z, gaps: [], aimT: [], h: [], p: [] }
  return { ...doc, tracks: [{ ...doc.tracks[0], points, ...(atFullRate ? { fullRate } : {}) }] }
}

function end(doc: ReturnType<typeof film>) {
  return jumpFromAction(doc, buildTracks3d(doc), 1, 0).t1 + 1
}

describe('film jump landing', () => {
  it('detects a flat jump at full rate', () => {
    expect(end(film([0, 0.1, 0.2, 0.1, 0, 0, 0]))).toBeCloseTo(4 / 6)
  })
  it('detects a higher landing after a rise', () => {
    expect(end(film([0, 0.1, 0.2, ...Array.from({ length: 16 }, () => 0.3)]))).toBeCloseTo(3 / 6)
  })
  it('does not mistake a ballistic jump\'s peak for a landing', () => {
    // 60 Hz: rise 1.6 u/s, gravity 4 u/s², ground found again around 0.8s.
    const z = Array.from({ length: 80 }, (_, i) => Math.max(0, 1.6 * (i / 60) - 2 * (i / 60) ** 2))
    const doc = film(z)
    const t = z.map((_, i) => i / 6)
    doc.tracks[0].points = t.map((time, i) => ({ t: time, x: 0, y: 0, z: z[i] }))
    doc.tracks[0].fullRate = { ...doc.tracks[0].fullRate!, t, x: t.map(() => 0), y: t.map(() => 0) }
    expect(end(doc)).toBeGreaterThan(7.5)
    expect(end(doc)).toBeLessThan(8.5)
  })
  it('keeps a long fall until the 1.5s ceiling', () => {
    expect(end(film(Array.from({ length: 100 }, (_, i) => -i * 0.1)))).toBe(15)
  })
  it('cuts at the start of a climb on the same slot', () => {
    const doc = film(Array.from({ length: 100 }, (_, i) => -i * 0.1))
    doc.stances = [{ slot: 2, kind: 'clamber', t0: 2, t1: 3 }, { slot: 1, kind: 'clamber', t0: 4, t1: 6 }]
    expect(end(doc)).toBe(4)
  })
  it('recognizes the same landing at 10 Hz', () => {
    expect(end(film([0, 0.2, 0.4, 0.2, 0, 0, 0], false))).toBe(4)
  })
  it('stops at the last position before a gap', () => {
    const doc = film([0, 0.1, 0.2, 0.1, 0])
    doc.tracks[0].fullRate!.gaps = [3]
    expect(end(doc)).toBeCloseTo(2 / 6)
  })
})
