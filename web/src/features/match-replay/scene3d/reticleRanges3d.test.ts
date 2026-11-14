import { describe, expect, it, vi } from 'vitest'
import { ReticleRanges, parseReticleRanges, reticleRangeAt } from './reticleRanges3d'
import { WeaponModels } from './weaponModels3d'

const index = {
  schema: 1,
  weapons: ['2b1824d5', '0a1992bc', 'f408190f', '000025ad'],
  reticle_ranges: {
    '2b1824d5': { unscoped: 18, zoomed: [36] },
    '0a1992bc': { unscoped: 17, zoomed: [68, 153] },
    'f408190f': { unscoped: 15, zoomed: [] },
  },
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('red reticle ranges', () => {
  it('reads the range per weapon and per zoom level', () => {
    const table = parseReticleRanges(index)!
    expect(reticleRangeAt(table['2b1824d5'], 0)).toBe(18)
    expect(reticleRangeAt(table['2b1824d5'], 1)).toBe(36)
    expect(reticleRangeAt(table['0a1992bc'], 2)).toBe(153)
    // A level past the declared ones reads the last; a weapon without zoom keeps its unscoped range.
    expect(reticleRangeAt(table['2b1824d5'], 2)).toBe(36)
    expect(reticleRangeAt(table['f408190f'], 1)).toBe(15)
    // A weapon absent from the table has no range.
    expect(reticleRangeAt(table['000025ad'], 0)).toBeNull()
  })

  it('treats an index without the field as having no ranges yet', () => {
    expect(parseReticleRanges({ schema: 1, weapons: [] })).toBeNull()
    expect(parseReticleRanges({ reticle_ranges: { a: { unscoped: 0, zoomed: [] } } })).toEqual({})
  })

  it('loads the index once and answers by held weapon id', async () => {
    const fetchJson = vi.fn((_url: string, _signal: AbortSignal) => Promise.resolve<unknown>(index))
    const models = new WeaponModels('/api/weapons', undefined, new ReticleRanges('/api/weapons', fetchJson))
    expect(models.reticleRange('0x2b1824d5cafebabe', 0)).toBeNull() // not loaded yet
    await flush()
    expect(models.reticleRange('0x2b1824d5cafebabe', 0)).toBe(18)
    expect(models.reticleRange('0xf408190fcafebabe', 0)).toBe(15)
    expect(models.reticleRange('0x000025adcafebabe', 0)).toBeNull()
    expect(models.reticleRange('not-a-weapon', 0)).toBeNull()
    expect(fetchJson).toHaveBeenCalledTimes(1)
    expect(fetchJson.mock.calls[0][0]).toBe('/api/weapons')
    models.dispose()
  })
})
