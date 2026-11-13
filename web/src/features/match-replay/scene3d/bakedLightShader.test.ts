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
  it('place min + base, max + fondu x, grille + fondu y aux trois lignes de la région', () => {
    const data = packBakedRegions([region(1, 0), region(1, 90)])
    expect(data.length).toBe(MAX_REGIONS * BAKED_ROWS * 4)
    expect(row(data, 1, 0)).toEqual([-10, -20, -0.5, 90])
    expect(row(data, 1, 1)).toEqual([30, 40, 12, 2])
    expect(row(data, 1, 2)).toEqual([5, 6, 3, 0.75])
  })

  it('remplit les places sans région des valeurs neutres', () => {
    const data = packBakedRegions([region(1, 0)])
    for (let r = 1; r < MAX_REGIONS; r++) {
      expect(row(data, r, 0)).toEqual([0, 0, 0, 0])
      expect(row(data, r, 1)).toEqual([0, 0, 0, 1])
      expect(row(data, r, 2)).toEqual([1, 1, 1, 1])
    }
  })
})

describe('BakedLight', () => {
  it('greffe un seul tableau de régions, rangées des plus prioritaires aux moins prioritaires', () => {
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
    expect(m.customProgramCacheKey()).toContain('|cuite-v3')
  })
})

it('greffe les lampes seulement sur les matériaux demandés et partage leur interrupteur', () => {
  const atlas = packAtlas([])
  const lamps = [{ kind: 'omni' as const, position: new THREE.Vector3(), direction: new THREE.Vector3(0, -1, 0), color: new THREE.Color(1, 1, 1), energy: 1, range: 2, cone: [0, 90] as [number, number] }]
  const light = new BakedLight([], atlas, 1, lamps)
  const shader = () => ({ uniforms: {} as Record<string, THREE.IUniform>, vertexShader: '#include <common>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <lights_pars_begin>\n#include <lights_fragment_begin>\n#include <lights_fragment_maps>' })
  const map = new THREE.MeshStandardMaterial()
  const object = new THREE.MeshStandardMaterial()
  light.apply(map, true)
  light.apply(object)
  const mapShader = shader(), objectShader = shader()
  map.onBeforeCompile(mapShader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)
  object.onBeforeCompile(objectShader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)
  expect(mapShader.fragmentShader).toContain('RE_Direct(clusteredLamp')
  expect(objectShader.fragmentShader).not.toContain('RE_Direct(clusteredLamp')
  light.enabled = false
  expect(mapShader.uniforms.uBakedOn.value).toBe(0)
  expect(objectShader.uniforms.uBakedOn.value).toBe(0)
  light.dispose()
})

it('crée un atlas pour des lampes sans sondes et aucun shader sans lumière', async () => {
  const parser = { getDependency: async () => new ArrayBuffer(0) }
  expect(await loadBakedLight({}, parser, 1)).toBeNull()
  const lamps = [{ kind: 'omni' as const, position: new THREE.Vector3(), direction: new THREE.Vector3(0, -1, 0), color: new THREE.Color(1, 1, 1), energy: 1, range: 2, cone: [0, 90] as [number, number] }]
  const light = await loadBakedLight({}, parser, 1, lamps)
  expect(light?.regions).toHaveLength(0)
  expect(light?.atlas.irradiance.type).toBe(THREE.FloatType)
  light?.dispose()
})