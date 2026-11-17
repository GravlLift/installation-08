// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { testReplayDoc } from '../test/testDoc'
import { bracketAt, gaitAt, GAIT_WINDOW, lifeDistances, type GaitPoint } from './gait3d'
import { buildTracks3d } from './tracks3d'

const FPS = 10

/** Une vie le long de +X Halo à `speed` u/s, un point par image (10 images/s). */
function straight(speed: number, frames: number): GaitPoint[] {
  return Array.from({ length: frames + 1 }, (_, t) => ({ t, x: (speed * t) / FPS, y: 0, g: 0 }))
}

describe('lifeDistances', () => {
  it('cumule le trajet au sol, sans compter le saut d’un trou de réplication', () => {
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
  it('encadre l’image et tient la position après un trou', () => {
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
  it('mesure la vitesse et la direction du déplacement', () => {
    const pts: GaitPoint[] = Array.from({ length: 11 }, (_, t) => ({ t, x: 0, y: (-2.5 * t) / FPS, g: 0 }))
    const g = gaitAt(pts, lifeDistances(pts), 6, FPS)
    expect(g.speed).toBeCloseTo(2.5)
    expect(g.heading).toBeCloseTo(-90)
    expect(g.distance).toBeCloseTo(1.5)
  })

  it('immobile : vitesse nulle', () => {
    const pts = straight(0, 10)
    expect(gaitAt(pts, lifeDistances(pts), 5, FPS).speed).toBe(0)
  })

  it('au début de la vie, la fenêtre se raccourcit ; à la première image, vitesse nulle', () => {
    const pts = straight(2, 10)
    const dist = lifeDistances(pts)
    expect(gaitAt(pts, dist, 0, FPS).speed).toBe(0)
    expect(gaitAt(pts, dist, 1, FPS).speed).toBeCloseTo(2)
  })

  it('le saut d’un trou de réplication ne fait pas courir', () => {
    const pts: GaitPoint[] = [
      { t: 0, x: 0, y: 0, g: 0 },
      { t: 1, x: 0, y: 0, g: 0 },
      { t: 2, x: 50, y: 0, g: 9 },
      { t: 3, x: 50, y: 0, g: 0 },
    ]
    expect(gaitAt(pts, lifeDistances(pts), 2.5, FPS).speed).toBe(0)
  })

  it('lisse le tremblé sur la fenêtre', () => {
    // Immobile à 1 cm près, une image sur deux.
    const pts: GaitPoint[] = Array.from({ length: 21 }, (_, t) => ({ t, x: (t % 2) * 0.01, y: 0, g: 0 }))
    const g = gaitAt(pts, lifeDistances(pts), 10, FPS)
    expect(GAIT_WINDOW * FPS).toBe(2)
    expect(g.speed).toBe(0)
  })

  it('la même image rend la même allure, en avant comme en arrière', () => {
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

  it('lit l’allure du joueur à la cadence du document, null hors de sa vie', () => {
    const g = tracks.gait('A', 10)
    expect(g?.speed).toBeCloseTo(2)
    expect(g?.distance).toBeCloseTo(2)
    expect(tracks.gait('A', 30)).toBeNull()
    expect(tracks.gait('B', 10)).toBeNull()
  })
})
