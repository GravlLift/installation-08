// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { MAX_REGIONS, packAtlas, type BakedAtlas, type BakedRegion } from './bakedLight'
import { BAKED_ROWS, BakedLight, loadBakedLight, packBakedRegions } from './bakedLightShader'

const row = (data: Float32Array, r: number, i: number) => Array.from(data.slice((r * BAKED_ROWS + i) * 4, (r * BAKED_ROWS + i) * 4 + 4))

function region(priority: number, base: number): BakedRegion {
  return {
    min: new THREE.Vector3(-10, -20, -0.5),
    max: new THREE.Vector3(30, 40, 12),
    count: new THREE.Vector3(5, 6, 3),
    priority,
    blend: new THREE.Vector2(2, 0.75),
    base,
  }
}

describe('packBakedRegions', () => {
  it("places min + base, max + blend x, grid + blend y at the region's three rows", () => {
    const data = packBakedRegions([region(1, 0), region(1, 90)])
    expect(data.length).toBe(MAX_REGIONS * BAKED_ROWS * 4)
    expect(row(data, 1, 0)).toEqual([-10, -20, -0.5, 90])
    expect(row(data, 1, 1)).toEqual([30, 40, 12, 2])
    expect(row(data, 1, 2)).toEqual([5, 6, 3, 0.75])
  })

  it('fills the slots without a region with neutral values', () => {
    const data = packBakedRegions([region(1, 0)])
    for (let r = 1; r < MAX_REGIONS; r++) {
      expect(row(data, r, 0)).toEqual([0, 0, 0, 0])
      expect(row(data, r, 1)).toEqual([0, 0, 0, 1])
      expect(row(data, r, 2)).toEqual([1, 1, 1, 1])
    }
  })
})

describe('BakedLight', () => {
  it('grafts a single array of regions, packed from highest to lowest priority', () => {
    const atlas = { irradiance: new THREE.DataTexture(new Uint16Array(4), 1, 1), columns: 1, activeCount: 1, total: 1 } as BakedAtlas
    const light = new BakedLight([region(1, 0), region(5, 30)], atlas, 1)
    const m = new THREE.MeshStandardMaterial()
    light.apply(m)
    const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: '#include <common>', fragmentShader: '#include <common>' }
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)
    const arrays = Object.entries(shader.uniforms).filter(([, u]) => u.value instanceof Float32Array)
    expect(arrays.map(([name]) => name)).toEqual(['uBaked'])
    expect(row(shader.uniforms.uBaked.value as Float32Array, 0, 0)[3]).toBe(30)
    expect(shader.uniforms.uBakedCount.value).toBe(2)
    expect(m.customProgramCacheKey()).toContain('|baked-v3')
  })
})

const lampShader = () => ({ uniforms: {} as Record<string, THREE.IUniform>, vertexShader: '#include <common>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <lights_pars_begin>\n#include <lights_fragment_begin>\n#include <lights_fragment_maps>' })
const oneLamp = () => [{ kind: 'omni' as const, position: new THREE.Vector3(), direction: new THREE.Vector3(0, -1, 0), color: new THREE.Color(1, 1, 1), energy: 1, range: 2, cone: [0, 90] as [number, number] }]

it('grafts the lamps onto every material, the map like a Spartan, and shares their switch', () => {
  // A Spartan on a night map is lit by the same lamps as the street it stands on (Streets: the
  // lamps are 96% of the light on the ground where the 0:39 corpse lies, the baked probes 4%).
  const light = new BakedLight([], packAtlas([]), 1, oneLamp())
  const map = new THREE.MeshStandardMaterial()
  const spartan = new THREE.MeshStandardMaterial()
  light.apply(map)
  light.apply(spartan)
  const mapShader = lampShader(), spartanShader = lampShader()
  map.onBeforeCompile(mapShader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)
  spartan.onBeforeCompile(spartanShader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)
  for (const s of [mapShader, spartanShader]) expect(s.fragmentShader).toContain('RE_Direct(clusteredLamp')
  expect(spartan.customProgramCacheKey()).toContain('|lamps-true')
  light.enabled = false
  expect(mapShader.uniforms.uBakedOn.value).toBe(0)
  expect(spartanShader.uniforms.uBakedOn.value).toBe(0)
  light.dispose()
})

it("grafts no lamp loop when the map doesn't publish any", () => {
  const light = new BakedLight([], packAtlas([]), 1)
  const m = new THREE.MeshStandardMaterial()
  light.apply(m)
  const s = lampShader()
  m.onBeforeCompile(s as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)
  expect(s.fragmentShader).not.toContain('RE_Direct(clusteredLamp')
  expect(m.customProgramCacheKey()).toContain('|lamps-false')
  light.dispose()
})

it('creates an atlas for lamps without probes, and no shader without light', async () => {
  const parser = { getDependency: async () => new ArrayBuffer(0) }
  expect(await loadBakedLight({}, parser, 1)).toBeNull()
  const light = await loadBakedLight({}, parser, 1, oneLamp())
  expect(light?.regions).toHaveLength(0)
  expect(light?.atlas.irradiance.type).toBe(THREE.FloatType)
  light?.dispose()
})