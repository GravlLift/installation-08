import { describe, expect, it } from 'vitest'
import { hauteurInitiale, poidsHauteur } from './layeredHeight3d'

describe('mélange des hauteurs', () => {
  it('calcule le poids du métal au point mesuré', () => {
    const h = hauteurInitiale(1, 99 / 255, 170 / 255)
    expect(h).toBeCloseTo(14 / 255)
    const p = { scale: 0, rang: 2, range: 0.9, opacite: 1, accumulation: 1 }
    expect(poidsHauteur(h, 242 / 255, 82 / 255, p).poids).toBeCloseTo(0.7963, 3)
    expect(poidsHauteur(h, 242 / 255, 153 / 255, p).poids).toBe(1)
  })

  it('sature la quatrième couche au point mesuré de la paroi', () => {
    const p = { scale: 0.35064936, rang: 4, range: 1.333, opacite: 1, accumulation: 0 }
    expect(poidsHauteur(0.9, 0, 1, p).poids).toBe(1)
  })
})
