// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** tracks3d.test.ts — the C1 interpolation of a life's points (`pointStateAt`, `gait3d.cubicAt`). */
import { describe, expect, it } from 'vitest'

import { testReplayDoc } from '../test/testDoc'
import { angleStep } from './gait3d'
import { buildTracks3d, pointStateAt, type LifePoint } from './tracks3d'

const pt = (t: number, x: number, extra: Partial<LifePoint> = {}): LifePoint =>
  ({ t, x, y: 0, z: 0, g: 0, h: 0, p: 0, aim: true, ...extra })

/** A smooth path (a curve in x, y and z, heading and pitch turning), sampled at uneven instants with replication-like noise. */
function smoothPath(): LifePoint[] {
  const ts = [0, 0.5, 1.1, 1.5, 2.2, 2.5, 3.1, 3.5, 4.0, 4.6, 5.0]
  return ts.map((t) => ({
    t, x: 4 * Math.sin(t * 0.4), y: 3 * Math.cos(t * 0.3), z: 0.2 * t, g: 0,
    h: 20 * t, p: 10 * Math.sin(t * 0.5), aim: true,
  }))
}

type Key = 'x' | 'y' | 'z' | 'h' | 'p'
const KEYS: Key[] = ['x', 'y', 'z', 'h', 'p']

describe('pointStateAt — the C1 curve through a life\'s points', () => {
  it('passes through every published sample exactly', () => {
    const pts = smoothPath().map((q, i) => ({ ...q, x: q.x + (i % 2 ? 0.013 : -0.007) }))
    for (const q of pts) {
      const s = pointStateAt(pts, q.t)
      for (const k of KEYS) expect(s[k]).toBe(q[k])
    }
  })

  it('keeps the velocity continuous across a point, where linear interpolation jumps', () => {
    const pts = smoothPath()
    const e = 1e-5
    for (let i = 1; i < pts.length - 1; i++) {
      const t = pts[i].t
      const at = pointStateAt(pts, t)
      const before = pointStateAt(pts, t - e)
      const after = pointStateAt(pts, t + e)
      for (const k of KEYS) {
        const left = (at[k] - before[k]) / e
        const right = (after[k] - at[k]) / e
        expect(Math.abs(right - left)).toBeLessThan(1e-3)
      }
    }
    // The chords on either side of point 4 (x): the linear velocity jump the curve removes.
    const chord = (a: LifePoint, b: LifePoint) => (b.x - a.x) / (b.t - a.t)
    expect(Math.abs(chord(pts[4], pts[5]) - chord(pts[3], pts[4]))).toBeGreaterThan(0.1)
  })

  it('stays between the two points of a segment: a sudden stop does not overshoot, a held silence stays still', () => {
    const pts = [pt(0, 0), pt(1, 1), pt(2, 2), pt(3, 3), pt(4, 3), pt(5, 3), pt(6, 4)]
    for (let f = 2; f <= 3; f += 0.05) {
      const x = pointStateAt(pts, f).x
      expect(x).toBeGreaterThanOrEqual(2 - 1e-12)
      expect(x).toBeLessThanOrEqual(3 + 1e-12)
    }
    for (let f = 3; f <= 5; f += 0.1) expect(pointStateAt(pts, f).x).toBe(3)
  })

  it('holds across a replication gap and does not reach through it for a neighbor', () => {
    const pts = [pt(0, 0), pt(1, 1), pt(2, 2), pt(3, 50, { g: 1 }), pt(4, 51), pt(5, 52)]
    for (let f = 2; f < 3; f += 0.1) expect(pointStateAt(pts, f).x).toBe(2)
    // After the gap the segment ignores the far side: 50 -> 51 -> 52 is a straight line.
    expect(pointStateAt(pts, 3.5).x).toBeCloseTo(50.5, 12)
    // Before the gap, likewise: 0 -> 1 -> 2 then a hold, so x(1.5) is on the straight line.
    expect(pointStateAt(pts, 1.5).x).toBeCloseTo(1.5, 12)
  })

  it('returns finite values at and beyond the life\'s ends, for short lives and repeated instants', () => {
    const lives: LifePoint[][] = [
      [pt(5, 1)],
      [pt(0, 0), pt(2, 4)],
      [pt(0, 0), pt(1, 1), pt(1, 2), pt(2, 3)],
      smoothPath(),
    ]
    for (const pts of lives) {
      const t0 = pts[0].t
      const t1 = pts[pts.length - 1].t
      for (const f of [t0 - 3, t0, t0 + 0.01, (t0 + t1) / 2, t1 - 0.01, t1, t1 + 3]) {
        const s = pointStateAt(pts, f)
        for (const k of KEYS) expect(Number.isFinite(s[k])).toBe(true)
      }
    }
    expect(pointStateAt([pt(0, 0), pt(2, 4)], 1).x).toBeCloseTo(2, 12)
  })

  it('turns across 359 -> 1 the short way, smoothly', () => {
    const pts = [355, 357, 359, 1, 3, 5].map((h, i) => pt(i, 0, { h }))
    for (let f = 0; f <= 5; f += 0.1) {
      const h = pointStateAt(pts, f).h
      // Unwrapped, the heading climbs 2 degrees per frame from 355: never the long way round.
      expect(angleStep(355 + 2 * f, h)).toBeCloseTo(0, 6)
    }
  })

  it('is a pure function of the frame', () => {
    const pts = smoothPath()
    const first = pointStateAt(pts, 2.37)
    pointStateAt(pts, 4.8)
    expect(pointStateAt(pts, 2.37)).toEqual(first)
  })
})

describe('Tracks3d.sample — on the C1 curve', () => {
  const doc = testReplayDoc({
    frameIntervalMs: 100,
    tracks: [
      {
        slot: 1, team: 0, xuid: 'A', startFrame: 0, endFrame: 4,
        points: [{ t: 0, x: 0, y: 0, z: 0 }, { t: 1, x: 1, y: 0, z: 0 }, { t: 2, x: 3, y: 1, z: 0 }, { t: 3, x: 6, y: 1, z: 0 }, { t: 4, x: 10, y: 3, z: 0 }],
      },
    ],
  })
  const tracks = buildTracks3d(doc)

  it('passes the published points and stays C1 between them', () => {
    expect(tracks.sample('A', 2)?.x).toBe(3)
    expect(tracks.sample('A', 2)?.y).toBe(1)
    const e = 1e-5
    const x = (f: number) => tracks.sample('A', f)!.x
    expect(Math.abs((x(2 + e) - x(2)) / e - (x(2) - x(2 - e)) / e)).toBeLessThan(1e-3)
  })
})
