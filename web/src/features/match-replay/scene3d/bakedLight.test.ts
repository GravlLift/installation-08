// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { packAtlas, readBakedRegions } from './bakedLight'

const TILE_TEXELS = 64

/** Un texel R11G11B10 : trois flottants 11, 11 et 10 bits (exposant biais 15, sans signe). */
function packed(r: number, g: number, b: number): number {
  const small = (v: number, mantissa: number) => {
    if (v === 0) return 0
    const e = Math.floor(Math.log2(v))
    const m = Math.round((v / 2 ** e - 1) * (1 << mantissa))
    return ((e + 15) << mantissa) | m
  }
  return (small(r, 6) | (small(g, 6) << 11) | (small(b, 5) << 22)) >>> 0
}

function region(count: [number, number, number], fill: (probe: number) => number) {
  const [nx, ny, nz] = count
  const texels = new Uint32Array(nx * ny * nz * TILE_TEXELS)
  const row = nx * 8
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++)
        for (let j = 0; j < 8; j++)
          for (let i = 0; i < 8; i++) texels[z * row * ny * 8 + (y * 8 + j) * row + x * 8 + i] = fill(x + nx * (y + ny * z))
  return texels
}

function half(h: number): number {
  return THREE.DataUtils.fromHalfFloat(h)
}

describe('readBakedRegions', () => {
  it('lit chaque région et numérote ses sondes à la suite des précédentes', async () => {
    const views = [region([2, 1, 1], () => 1), region([1, 1, 3], () => 1)]
    const parser = { getDependency: async (_: 'bufferView', i: number) => views[i].buffer as ArrayBuffer }
    const extras = {
      levelupProbes: {
        tile: 8,
        regions: [
          { min: [0, 0, 0], max: [2, 1, 1], count: [2, 1, 1], priority: 1, blend: [0.5, 0.5], irradiance: 0 },
          { min: [0, 0, 0], max: [1, 1, 3], count: [1, 1, 3], priority: 2, blend: [0.5, 0.25], irradiance: 1 },
        ],
      },
    }
    const regions = await readBakedRegions(extras, parser)
    expect(regions?.map((r) => r.base)).toEqual([0, 2])
    expect(regions?.[1].blend.toArray()).toEqual([0.5, 0.25])
  })

  it('rend null sans sondes ou quand une vue ne tombe pas à la taille de sa grille', async () => {
    const parser = { getDependency: async () => new Uint32Array(10).buffer as ArrayBuffer }
    expect(await readBakedRegions({}, parser)).toBeNull()
    const extras = { levelupProbes: { tile: 8, regions: [{ min: [0, 0, 0], max: [1, 1, 1], count: [1, 1, 1], priority: 1, blend: [1, 1], irradiance: 0 }] } }
    expect(await readBakedRegions(extras, parser)).toBeNull()
  })
})

describe('packAtlas', () => {
  it('convertit les texels du jeu en demi-flottants et marque les sondes enfouies', async () => {
    // Sonde 0 : (0,25 ; 1,5 ; 3) ; sonde 1 : enfouie (tout à zéro).
    const texels = region([2, 1, 1], (k) => (k === 0 ? packed(0.25, 1.5, 3) : 0))
    const parser = { getDependency: async () => texels.buffer as ArrayBuffer }
    const extras = { levelupProbes: { tile: 8, regions: [{ min: [0, 0, 0], max: [2, 1, 1], count: [2, 1, 1], priority: 1, blend: [1, 1], irradiance: 0 }] } }
    const regions = await readBakedRegions(extras, parser)
    const atlas = packAtlas(regions!)
    expect(atlas.total).toBe(2)
    expect(atlas.activeCount).toBe(1)
    const data = atlas.irradiance.image.data as unknown as Uint16Array
    const width = atlas.irradiance.image.width
    const at = (x: number, y: number) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4), half)
    expect(at(3, 3)).toEqual([0.25, 1.5, 3, 1])
    expect(at(8 + 3, 3)).toEqual([0, 0, 0, 0])
  })
})
