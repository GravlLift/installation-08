// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { testReplayDoc } from '../test/testDoc'
import { bracketAt, gaitAt, GAIT_WINDOW, lifeDistances, type GaitPoint } from './gait3d'
import { buildTracks3d } from './tracks3d'

const FPS = 10

/** A life along +X Halo at `speed` u/s, one point per frame (10 frames/s). */
function straight(speed: number, frames: number): GaitPoint[] {
  return Array.from({ length: frames + 1 }, (_, t) => ({ t, x: (speed * t) / FPS, y: 0, g: 0 }))
}

describe('lifeDistances', () => {
  it('accumulates the ground path, without counting a replication gap\'s jump', () => {
    const pts: GaitPoint[] = [
      { t: 0, x: 0, y: 0, g: 0 },
      { t: 1, x: 3, y: 4, g: 0 },
      { t: 5, x: 100, y: 4, g: 3 },
      { t: 6, x: 101, y: 4, g: 0 },
    ]
    expect(lifeDistances(pts)).toEqual([0, 5, 5, 6])
  })
})

describe('bracketAt', () => {
  it('brackets the frame and holds the position after a gap', () => {
    const pts: GaitPoint[] = [
      { t: 0, x: 0, y: 0, g: 0 },
      { t: 4, x: 4, y: 0, g: 0 },
      { t: 8, x: 9, y: 0, g: 2 },
    ]
    expect(bracketAt(pts, 2)).toEqual({ lo: 0, hi: 1, u: 0.5 })
    expect(bracketAt(pts, 6)).toEqual({ lo: 1, hi: 2, u: 0 })
    expect(bracketAt(pts, -3)).toEqual({ lo: 0, hi: 0, u: 0 })
    expect(bracketAt(pts, 99)).toEqual({ lo: 2, hi: 2, u: 0 })
  })
})

describe('gaitAt', () => {
  it('measures speed and direction of travel', () => {
    const pts: GaitPoint[] = Array.from({ length: 11 }, (_, t) => ({ t, x: 0, y: (-2.5 * t) / FPS, g: 0 }))
    const g = gaitAt(pts, lifeDistances(pts), 6, FPS)
    expect(g.speed).toBeCloseTo(2.5)
    expect(g.heading).toBeCloseTo(-90)
    expect(g.distance).toBeCloseTo(1.5)
  })

  it('motionless: zero speed', () => {
    const pts = straight(0, 10)
    expect(gaitAt(pts, lifeDistances(pts), 5, FPS).speed).toBe(0)
  })

  it('at the start of life, the window shortens; at the first frame, zero speed', () => {
    const pts = straight(2, 10)
    const dist = lifeDistances(pts)
    expect(gaitAt(pts, dist, 0, FPS).speed).toBe(0)
    expect(gaitAt(pts, dist, 1, FPS).speed).toBeCloseTo(2)
  })

  it('a replication gap\'s jump does not count as running', () => {
    const pts: GaitPoint[] = [
      { t: 0, x: 0, y: 0, g: 0 },
      { t: 1, x: 0, y: 0, g: 0 },
      { t: 2, x: 50, y: 0, g: 9 },
      { t: 3, x: 50, y: 0, g: 0 },
    ]
    expect(gaitAt(pts, lifeDistances(pts), 2.5, FPS).speed).toBe(0)
  })

  it('smooths jitter over the window', () => {
    // Motionless to within 1 cm, every other frame.
    const pts: GaitPoint[] = Array.from({ length: 21 }, (_, t) => ({ t, x: (t % 2) * 0.01, y: 0, g: 0 }))
    const g = gaitAt(pts, lifeDistances(pts), 10, FPS)
    expect(GAIT_WINDOW * FPS).toBe(2)
    expect(g.speed).toBe(0)
  })

  it('the same frame yields the same gait, forward or backward', () => {
    const pts = straight(2.3, 40)
    const dist = lifeDistances(pts)
    const first = gaitAt(pts, dist, 12.4, FPS)
    gaitAt(pts, dist, 30, FPS)
    expect(gaitAt(pts, dist, 12.4, FPS)).toEqual(first)
  })
})

describe('Tracks3d.gait', () => {
  const doc = testReplayDoc({
    frameIntervalMs: 100,
    tracks: [
      { slot: 1, team: 0, xuid: 'A', startFrame: 0, endFrame: 20, points: [{ t: 0, x: 0, y: 0, z: 0 }, { t: 20, x: 4, y: 0, z: 0 }] },
    ],
  })
  const tracks = buildTracks3d(doc)

  it('reads the player\'s gait at the document\'s rate, null outside their life', () => {
    const g = tracks.gait('A', 10)
    expect(g?.speed).toBeCloseTo(2)
    expect(g?.distance).toBeCloseTo(2)
    expect(tracks.gait('A', 30)).toBeNull()
    expect(tracks.gait('B', 10)).toBeNull()
  })
})
