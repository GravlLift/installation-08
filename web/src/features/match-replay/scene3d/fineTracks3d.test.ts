import { describe, expect, it } from 'vitest'

import type { ReplayFullRateReady } from '@/lib/replay/replayFullRate'

import { aimAt, fineLifePoints, HOLD_AFTER_TICKS, lifeTick } from './fineTracks3d'

/** Un tick de 60 Hz sur une grille de 100 ms, en images. */
const TICK = 1 / 6

function life(partial: Partial<ReplayFullRateReady>): ReplayFullRateReady {
  return { t: [], x: [], y: [], z: [], gaps: [], aimT: [], h: [], p: [], ...partial }
}

describe('fineLifePoints', () => {
  it('garde chaque échantillon à son instant, sans le ramener à la grille', () => {
    const t = [0, TICK, 2 * TICK, 3 * TICK]
    const pts = fineLifePoints(life({ t, x: [0, 1, 2, 3], y: [0, 0, 0, 0], z: [0, 0, 0, 0] }))
    expect(pts.map((p) => p.t)).toEqual(t)
    expect(pts.map((p) => p.x)).toEqual([0, 1, 2, 3])
  })

  it('lit la visée sur son propre axe, exacte à ses instants et interpolée entre eux', () => {
    const t = [0, TICK, 2 * TICK]
    const pts = fineLifePoints(
      life({ t, x: [0, 0, 0], y: [0, 0, 0], z: [0, 0, 0], aimT: [0, 2 * TICK], h: [350, 10], p: [0, 4] }),
    )
    expect(pts[0].h).toBe(350)
    // À mi-chemin, le cap passe par 0 (plus court chemin), pas par 180.
    expect(((pts[1].h % 360) + 360) % 360).toBeCloseTo(0, 6)
    expect(pts[1].p).toBeCloseTo(2, 6)
    expect(pts[2].h).toBe(10)
    expect(pts.every((p) => p.aim)).toBe(true)
  })

  it("tient la position pendant un silence et ne bouge qu'au dernier tick", () => {
    const t = [0, TICK, 2 * TICK, 12 * TICK]
    const pts = fineLifePoints(life({ t, x: [0, 0, 1, 5], y: [0, 0, 0, 0], z: [0, 0, 0, 0] }))
    expect(pts).toHaveLength(5)
    expect(pts[3].t).toBeCloseTo(11 * TICK, 9)
    expect(pts[3].x).toBe(1)
    expect(pts[4].x).toBe(5)
  })

  it('marque la lacune sur le point qui la suit, sans point de tenue', () => {
    const t = [0, TICK, 80 * TICK]
    const pts = fineLifePoints(life({ t, x: [0, 1, 9], y: [0, 0, 0], z: [0, 0, 0], gaps: [2] }))
    expect(pts.map((p) => p.g)).toEqual([0, 0, 1])
  })
})

describe('aimAt', () => {
  it("tient la visée après un silence jusqu'à un tick avant la suivante", () => {
    const fr = life({ aimT: [0, 10 * TICK], h: [0, 90], p: [0, 0] })
    expect(aimAt(fr, 5 * TICK, TICK).h).toBe(0)
    expect(aimAt(fr, 9.5 * TICK, TICK).h).toBeCloseTo(45, 6)
    expect(aimAt(fr, 10 * TICK, TICK).h).toBe(90)
  })

  it('rend la première visée, non connue, avant le premier échantillon', () => {
    const fr = life({ aimT: [3], h: [12], p: [1] })
    expect(aimAt(fr, 1, TICK)).toEqual({ h: 12, p: 1, known: false })
    expect(aimAt(life({}), 1, TICK).known).toBe(false)
  })
})

describe('lifeTick', () => {
  it("prend l'écart médian entre positions", () => {
    expect(lifeTick([0, TICK, 2 * TICK, 3 * TICK, 40])).toBeCloseTo(TICK, 9)
    expect(lifeTick([1])).toBeCloseTo(TICK, 9)
    expect(HOLD_AFTER_TICKS).toBeGreaterThan(1)
  })
})
