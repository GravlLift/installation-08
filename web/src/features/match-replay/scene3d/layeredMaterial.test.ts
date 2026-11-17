// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import type { GLTFParser } from 'three/addons/loaders/GLTFLoader.js'
import { describe, expect, it } from 'vitest'

import { LAYER_ROWS, layeredMaterial, packLayers, prepareLayerUVs, type LayerInfo } from './layeredMaterial'

const row = (data: Float32Array, k: number, i: number) => Array.from(data.slice((k * LAYER_ROWS + i) * 4, (k * LAYER_ROWS + i) * 4 + 4))

describe('packLayers', () => {
  const degrade: LayerInfo = {
    sorte: 'degrade',
    echelle: [2, 3],
    decalage: [0.25, 0.5],
    echelleNormale: [4, 5],
    decalageNormale: [0.125, 0.75],
    echelleControle: [6, 7],
    decalageControle: [1, 2],
    teinte: [0.1, 0.2, 0.3],
    haut: [0.4, 0.5, 0.6],
    milieu: [0.7, 0.8, 0.9],
    bas: [1, 1.5, 2],
    melange: 1,
    opacite: 0.5,
    intensiteNormale: 3,
    melangeNormale: 1,
  }

  it('place chaque constante d’une couche à sa ligne de uLayer', () => {
    const data = packLayers([{ sorte: 'couleur' }, degrade], [false, true], [false, true])
    expect(data.length).toBe(4 * LAYER_ROWS * 4)
    const f = (v: number[]) => Array.from(new Float32Array(v))
    expect(row(data, 1, 0)).toEqual([2, 3, 0.25, 0.5])
    expect(row(data, 1, 1)).toEqual([4, 5, 0.125, 0.75])
    expect(row(data, 1, 2)).toEqual([6, 7, 1, 2])
    expect(row(data, 1, 3)).toEqual(f([0.1, 0.2, 0.3, 1]))
    expect(row(data, 1, 4)).toEqual(f([0.4, 0.5, 0.6, 1]))
    expect(row(data, 1, 5)).toEqual(f([0.7, 0.8, 0.9, 0.5]))
    expect(row(data, 1, 6)).toEqual([1, 1.5, 2, 3])
    expect(row(data, 1, 7)).toEqual([1, 1, 1, 1])
  })

  it('range le rang du gabarit d’une couche, à défaut sa position', () => {
    // Couches 1, 2 et 4 du gabarit (rochers de Live Fire) : la troisième lit le canal de la couche 4.
    const data = packLayers([{ sorte: 'couleur' }, { sorte: 'degrade' }, { sorte: 'degrade', rang: 3 }], [false, false, false], [false, false, false])
    expect(row(data, 0, 7)[3]).toBe(0)
    expect(row(data, 1, 7)[3]).toBe(1)
    expect(row(data, 2, 7)[3]).toBe(3)
  })

  it('marks a normal or control laid on the mask coordinates with 2', () => {
    const data = packLayers([{ sorte: 'degrade', normaleMacro: true, controleMacro: true }, { sorte: 'degrade', controleMacro: true }], [true, false], [true, false])
    expect(row(data, 0, 7)).toEqual([2, 0, 2, 0])
    // A flag without a loaded map stays 0.
    expect(row(data, 1, 7)).toEqual([0, 0, 0, 1])
  })

  it('donne leurs défauts aux champs absents et aux couches absentes', () => {
    const data = packLayers([{ sorte: 'couleur' }], [false], [false])
    // Couche présente sans champs : transformations neutres, sorte couleur, intensité de normale 1.
    for (let i = 0; i < 3; i++) expect(row(data, 0, i)).toEqual([1, 1, 0, 0])
    expect(row(data, 0, 3)).toEqual([0, 0, 0, 0])
    expect(row(data, 0, 6)).toEqual([0, 0, 0, 1])
    expect(row(data, 0, 7)).toEqual([0, 0, 0, 0])
    // Couche absente : transformations neutres, zéro partout ailleurs (intensité comprise).
    for (let i = 0; i < 3; i++) expect(row(data, 3, i)).toEqual([1, 1, 0, 0])
    for (let i = 3; i < LAYER_ROWS; i++) expect(row(data, 3, i)).toEqual([0, 0, 0, 0])
  })
})

describe('layeredMaterial', () => {
  it('transmet les cartes et les constantes de chaque couche au shader', async () => {
    const textures = Array.from({ length: 7 }, () => new THREE.Texture())
    const parser = { getDependency: async (_: string, index: number) => textures[index] } as unknown as GLTFParser
    const couches: LayerInfo[] = [
      { sorte: 'couleur', texture: 0, normale: 1, controle: 2, teinte: [0.25, 0.5, 1] },
      { sorte: 'degrade', texture: 3, normale: 4, controle: 5, opacite: 0.75 },
    ]
    const m = await layeredMaterial(new THREE.MeshStandardMaterial(), { couches, masque: 6, jeuMasque: 1, jeuCouches: 0 }, parser)
    const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: '', fragmentShader: '' }
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)
    expect(shader.uniforms.uLayer.value).toEqual(packLayers(couches, [true, true], [true, true]))
    expect([shader.uniforms.uCount.value, shader.uniforms.uHasMask.value]).toEqual([2, 1])
    expect(['uTex0', 'uNrm0', 'uCtl0', 'uTex1', 'uNrm1', 'uCtl1', 'uMask'].map((key) => shader.uniforms[key].value)).toEqual(textures)
    expect([textures[0].colorSpace, textures[3].colorSpace, textures[6].colorSpace]).toEqual([
      THREE.SRGBColorSpace, THREE.NoColorSpace, THREE.NoColorSpace,
    ])
    expect(shader.uniforms.uTex2.value).toBeNull()
  })

  it('ne déclare plus qu’un tableau de constantes par matériau', async () => {
    const parser = { getDependency: async () => new THREE.Texture() } as unknown as GLTFParser
    const info = { couches: [{ sorte: 'couleur' as const, texture: 0, normale: 1 }], masque: -1, jeuMasque: 1, jeuCouches: 0 }
    const m = await layeredMaterial(new THREE.MeshStandardMaterial(), info, parser)
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: '#include <common>\n#include <uv_vertex>',
      fragmentShader: '#include <common>\n#include <map_fragment>',
    }
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)
    const arrays = Object.entries(shader.uniforms).filter(([, u]) => u.value instanceof Float32Array)
    expect(arrays.map(([name]) => name)).toEqual(['uLayer'])
    expect(row(shader.uniforms.uLayer.value as Float32Array, 0, 7)).toEqual([1, 0, 0, 0])
    expect(shader.fragmentShader).toContain(`uniform vec4 uLayer[4 * LAYER_ROWS];`)
    expect(m.customProgramCacheKey()).toBe('couches-v6')
  })
})

describe('prepareLayerUVs', () => {
  const uv = (v: number) => new THREE.Float32BufferAttribute([v, v, v, v], 2)
  const geometry = (sets: number) => {
    const g = new THREE.BufferGeometry()
    ;['uv', 'uv1'].slice(0, sets).forEach((name, k) => g.setAttribute(name, uv(k)))
    return g
  }
  const flagged = { couches: [{ sorte: 'degrade' as const, controleMacro: true }], masque: -1, jeuMasque: 1, jeuCouches: 0 }

  it('binds the mask set for a map laid on it, without a mask', () => {
    const g = geometry(2)
    expect(prepareLayerUVs(g, flagged)).toBe(true)
    expect(g.getAttribute('cMacro')).toBe(g.getAttribute('uv1'))
    expect(g.getAttribute('cUv')).toBe(g.getAttribute('uv'))
  })

  it('falls back to the layer set when the geometry lacks the mask set', () => {
    const g = geometry(1)
    expect(prepareLayerUVs(g, flagged)).toBe(true)
    expect(g.getAttribute('cMacro')).toBe(g.getAttribute('uv'))
  })
})

describe('layeredMaterial cutout on the mask', () => {
  it('reads the cut from the mask alpha when decoupeMasque is set', async () => {
    const parser = { getDependency: async () => new THREE.Texture() } as unknown as GLTFParser
    const info = { couches: [{ sorte: 'degrade' as const, texture: 0 }], masque: 1, jeuMasque: 1, jeuCouches: 0, decoupeMasque: true }
    const m = await layeredMaterial(new THREE.MeshStandardMaterial(), info, parser)
    const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: '', fragmentShader: '#include <common>\n#include <map_fragment>' }
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)
    expect(shader.uniforms.uMaskCut.value).toBe(1)
    expect(shader.fragmentShader).toContain('uMaskCut > 0.5 ? texture2D(uMask, vMacro).a')
  })
})