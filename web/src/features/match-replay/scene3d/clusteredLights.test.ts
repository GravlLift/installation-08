// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildLampGrid, cellLamps, MAX_CELL_LAMPS } from './clusteredLights'
import type { PlacedLight } from './placedLights'

function lamp(x: number, range = 1, energy = 1): PlacedLight {
  return { kind: 'omni', position: new THREE.Vector3(x, 0, 0), direction: new THREE.Vector3(0, -1, 0), color: new THREE.Color(1, 1, 1), energy, range, cone: [0, 90] }
}

describe('lamp grid', () => {
  it('assigns cells touched by the sphere and excludes distant cells', () => {
    const grid = buildLampGrid([lamp(0, 2)], 1)
    expect(cellLamps(grid, new THREE.Vector3(0, 0, 0))).toEqual([0])
    expect(cellLamps(grid, new THREE.Vector3(1.5, 0, 0))).toEqual([0])
    expect(cellLamps(grid, new THREE.Vector3(9, 0, 0))).toEqual([])
  })
  it('keeps the strongest at the center and counts overflows', () => {
    const grid = buildLampGrid(Array.from({ length: 33 }, (_, i) => lamp(0, 2, i + 1)), 2)
    expect(grid.overflow).toBeGreaterThan(0)
    const indices = cellLamps(grid, new THREE.Vector3(0, 0, 0))
    expect(indices).toHaveLength(MAX_CELL_LAMPS)
    expect(indices).not.toContain(0)
    expect(indices).toContain(32)
  })
  it('produces an empty grid with no lamp', () => {
    const grid = buildLampGrid([], 2)
    expect(grid.cells).toHaveLength(0)
    expect(grid.indices).toHaveLength(0)
    expect(grid.overflow).toBe(0)
  })
})

import { packAtlas } from './bakedLight'
import { appendLampData, fitLampGrid, LAMP_CELL_SIZE } from './clusteredLights'

describe('fitLampGrid', () => {
  const at = (x: number, y: number, z: number): PlacedLight => ({ ...lamp(0, 15), position: new THREE.Vector3(x, y, z) })
  // A large map's lamps (Bazaar: 235): at 2 m cells, their box needs more atlas rows than
  // WebGL2 guarantees.
  const spread = Array.from({ length: 235 }, (_, i) => at((i * 37) % 600, ((i * 11) % 6) * 10, (i * 53) % 600))

  it('keeps 2 m cells when they fit', () => {
    expect(fitLampGrid([lamp(0, 2)], 1024, 0)?.size).toBe(LAMP_CELL_SIZE)
  })
  it('coarsens the cells until the tables fit, and the atlas then takes them', () => {
    const grid = fitLampGrid(spread, 1024, 0)
    expect(grid).not.toBeNull()
    expect(grid!.size).toBeGreaterThan(LAMP_CELL_SIZE)
    const atlas = packAtlas([])
    expect(() => appendLampData(atlas, grid!, spread)).not.toThrow()
    expect(atlas.irradiance.image.height).toBeLessThanOrEqual(2048)
    expect(cellLamps(grid!, spread[7].position)).toContain(7)
    atlas.irradiance.dispose()
  })
  it('answers null when even the coarsest cells do not fit, and with no lamp', () => {
    expect(fitLampGrid(spread, 1024, 1024 * 2048 - 10)).toBeNull() // the probes fill the atlas
    expect(fitLampGrid([], 1024, 0)).toBeNull()
  })
})

it('files cells and indices into a shared float atlas', () => {
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
