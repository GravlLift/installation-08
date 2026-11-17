// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildLampGrid, cellLamps, MAX_CELL_LAMPS } from './clusteredLights'
import type { PlacedLight } from './placedLights'

function lamp(x: number, range = 1, energy = 1): PlacedLight {
  return { kind: 'omni', position: new THREE.Vector3(x, 0, 0), direction: new THREE.Vector3(0, -1, 0), color: new THREE.Color(1, 1, 1), energy, range, cone: [0, 90] }
}

describe('grille des lampes', () => {
  it('associe les cellules touchées par la sphère et exclut les cellules éloignées', () => {
    const grid = buildLampGrid([lamp(0, 2)], 1)
    expect(cellLamps(grid, new THREE.Vector3(0, 0, 0))).toEqual([0])
    expect(cellLamps(grid, new THREE.Vector3(1.5, 0, 0))).toEqual([0])
    expect(cellLamps(grid, new THREE.Vector3(9, 0, 0))).toEqual([])
  })
  it('garde les plus fortes au centre et compte les dépassements', () => {
    const grid = buildLampGrid(Array.from({ length: 33 }, (_, i) => lamp(0, 2, i + 1)), 2)
    expect(grid.overflow).toBeGreaterThan(0)
    const indices = cellLamps(grid, new THREE.Vector3(0, 0, 0))
    expect(indices).toHaveLength(MAX_CELL_LAMPS)
    expect(indices).not.toContain(0)
    expect(indices).toContain(32)
  })
  it('produit une grille vide sans lampe', () => {
    const grid = buildLampGrid([], 2)
    expect(grid.cells).toHaveLength(0)
    expect(grid.indices).toHaveLength(0)
    expect(grid.overflow).toBe(0)
  })
})

import { packAtlas } from './bakedLight'
import { appendLampData } from './clusteredLights'

it('range les cellules et indices dans un atlas flottant partagé', () => {
  const lamps = [lamp(0, 2)]
  const grid = buildLampGrid(lamps)
  const atlas = packAtlas([])
  const offsets = appendLampData(atlas, grid, lamps)
  expect(atlas.irradiance.type).toBe(THREE.FloatType)
  expect(atlas.irradiance.image.width).toBe(1024)
  expect(atlas.irradiance.image.height).toBe(Math.ceil((offsets.records + 3) / 1024))
  const data = atlas.irradiance.image.data as unknown as Float32Array
  const cell = cellLamps(grid, new THREE.Vector3(0, 0, 0))
  const k = grid.cells.indexOf(cell)
  const offset = data[(offsets.table + k) * 4]
  expect(data[(offsets.table + k) * 4 + 1]).toBe(1)
  expect(data[offsets.list * 4 + offset]).toBe(0)
  expect(data[(offsets.records + 1) * 4]).toBe(2)
  atlas.irradiance.dispose()
})
