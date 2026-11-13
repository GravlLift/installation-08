import { describe, expect, it } from 'vitest'

import { glowLevel } from './lighting'

describe('glowLevel', () => {
  it('comprime les forces du jeu sans en inverser l’ordre', () => {
    const forces = [0, 1, 5, 56, 400, 2000]
    const levels = forces.map(glowLevel)
    expect(levels[0]).toBe(0)
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1])
    // 2 000 fois plus fort dans le jeu, moins de 15 fois plus fort à l'écran.
    expect(glowLevel(2000) / glowLevel(1)).toBeLessThan(15)
  })
})
