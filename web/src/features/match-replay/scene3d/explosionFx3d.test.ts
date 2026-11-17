// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { BLAST_END_SECONDS, BLAST_FLASH_SECONDS, blastAt, blastLight, blastStyleOf, rand, type BlastSink, type BlastStyle } from './explosionFx3d'
import { BLAST_RADIUS } from './flights3d'
import { MUZZLE_LIGHT } from './shots3d'

const INK = { core: { r: 1, g: 0.95, b: 0.85 }, tint: { r: 1, g: 0.45, b: 0.1 } }

interface Frame {
  sprites: number[][]
  streaks: number[][]
}

function frameAt(style: BlastStyle, age: number, seed = 1234): Frame {
  const out: Frame = { sprites: [], streaks: [] }
  const sink: BlastSink = {
    sprite: (...v) => out.sprites.push(v),
    streak: (...v) => out.streaks.push(v),
  }
  blastAt(style, age, seed, INK, sink)
  return out
}

/** La lumière émise par une image : la somme des couleurs, pondérée par la surface des éclats ronds. */
function energy(f: Frame): number {
  const sprites = f.sprites.reduce((s, [, , , radius, r, g, b]) => s + (r + g + b) * radius * radius, 0)
  const streaks = f.streaks.reduce((s, v) => s + v[6] + v[7] + v[8], 0) * 0.002
  return sprites + streaks
}

describe('blastAt — une explosion fonction pure de son âge', () => {
  it('rien avant la détonation ni à partir de la fin (moins d une seconde)', () => {
    expect(BLAST_END_SECONDS).toBeLessThan(1)
    for (const style of ['fire', 'plasma', 'shard'] as const) {
      expect(frameAt(style, -0.01)).toEqual({ sprites: [], streaks: [] })
      expect(frameAt(style, BLAST_END_SECONDS)).toEqual({ sprites: [], streaks: [] })
    }
  })

  it('même âge et même germe : même image, dans n importe quel ordre', () => {
    const ages = [0.3, 0.05, 0.12, 0.05, 0.3]
    const seen = ages.map((a) => frameAt('fire', a))
    expect(seen[1]).toEqual(seen[3])
    expect(seen[0]).toEqual(seen[4])
  })

  it('deux germes : deux boules de feu différentes', () => {
    expect(frameAt('fire', 0.15, 1)).not.toEqual(frameAt('fire', 0.15, 2))
  })

  it('l énergie est en tête : éclair blanc d une à deux images, puis décroissance rapide', () => {
    const flash = frameAt('fire', 0.01)
    expect(flash.sprites.some((s) => s[7] === 0 && s[4] > 2)).toBe(true)
    expect(frameAt('fire', BLAST_FLASH_SECONDS + 0.01).sprites.every((s) => s[4] < 3)).toBe(true)
    const e = [0.02, 0.15, 0.3, 0.5, 0.7].map((a) => energy(frameAt('fire', a)))
    for (let i = 1; i < e.length; i++) expect(e[i]).toBeLessThan(e[i - 1])
    expect(e[3]).toBeLessThan(e[0] * 0.15)
  })

  it('la boule de feu est faite de plusieurs bouffées et reste sous le rayon de dégâts', () => {
    for (const age of [0.05, 0.2, 0.4, 0.6]) {
      const f = frameAt('fire', age)
      // Le feu : les éclats qui émettent (la fumée, grise et éteinte, n'en est pas).
      const fire = f.sprites.filter((s) => s[4] > 0.05)
      for (const [x, y, z, radius] of fire) expect(Math.hypot(x, y, z) + radius).toBeLessThan(BLAST_RADIUS)
    }
    expect(frameAt('fire', 0.2).sprites.length).toBeGreaterThanOrEqual(8)
  })

  it('les étincelles filent puis retombent sous leur poids', () => {
    const early = frameAt('fire', 0.05).streaks
    const late = frameAt('fire', 0.4).streaks
    expect(early.length).toBeGreaterThan(20)
    const drop = (s: number[][]) => s.reduce((m, v) => m + (v[4] - v[1]), 0) / s.length
    expect(drop(late)).toBeLessThan(drop(early))
  })

  it('le plasma n a pas de fumée et finit plus tôt que le feu', () => {
    expect(frameAt('plasma', 0.5)).toEqual({ sprites: [], streaks: [] })
    expect(frameAt('fire', 0.5).sprites.length).toBeGreaterThan(0)
  })
})

describe('blastLight et blastStyleOf', () => {
  it('la lumière d une détonation dépasse celle d un tir puis s éteint en moins d une demi-seconde', () => {
    expect(blastLight('fire', 0)).toBeGreaterThan(MUZZLE_LIGHT)
    expect(blastLight('fire', 0.1)).toBeLessThan(blastLight('fire', 0))
    expect(blastLight('fire', 0.31)).toBe(0)
    expect(blastLight('fire', -0.01)).toBe(0)
  })

  it('la nature de la décharge choisit la mise en scène', () => {
    expect(blastStyleOf('blast')).toBe('fire')
    expect(blastStyleOf('plasma_cool')).toBe('plasma')
    expect(blastStyleOf('needle')).toBe('shard')
    expect(blastStyleOf('neutral')).toBe('fire')
  })

  it('les tirages sont stables et dans [0, 1)', () => {
    expect(rand(7, 3, 1)).toBe(rand(7, 3, 1))
    for (let i = 0; i < 200; i++) {
      const v = rand(i * 31, i, i % 5)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
