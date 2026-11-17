// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import type { GLTFParser } from 'three/addons/loaders/GLTFLoader.js'
import { describe, expect, it, vi } from 'vitest'

import { isMergedMaterial } from './layeredArrays3d'
import { batchLayered } from './layeredBatch3d'
import { layeredMaterial, prepareLayerUVs, type LayeredInfo } from './layeredMaterial'
import { convertLayered } from './layeredMerge3d'
import { GLOW_TEXEL, ROW_TEXELS } from './layeredPlan3d'
import { tightenBounds } from './mapModel'
import { probeSurface, tagSurface } from './surfaceProbe3d'

/** Four textures: color 4x4, normal 4x4, mask 4x4, glow 8x8. */
function textures(): THREE.Texture[] {
  return [4, 4, 4, 8].map((size) => new THREE.Texture({ width: size, height: size } as unknown as HTMLImageElement))
}

/**
 * Two surfaces of a node on the same four-vertex buffer, which share vertices 1 and 2, and a
 * layer-less glass pane on the same buffer.
 */
async function scene() {
  const maps = textures()
  const parser = { getDependency: async (_: string, i: number) => maps[i] } as unknown as GLTFParser
  const position = new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3)
  const uv = (k: number) => new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1].map((v) => v + k)), 2)
  const uvs = [uv(0), uv(1), uv(2)]
  const geometry = (index: number[]) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', position)
    uvs.forEach((a, k) => g.setAttribute(['uv', 'uv1', 'uv2'][k], a))
    g.setIndex(index)
    return g
  }
  const base = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, flatShading: true })
  const infoA: LayeredInfo = { couches: [{ sorte: 'couleur', texture: 0, normale: 1 }], masque: 2, jeuMasque: 1, jeuCouches: 2 }
  const infoB: LayeredInfo = { couches: [{ sorte: 'degrade', texture: 3 }], masque: -1, jeuMasque: 0, jeuCouches: 2 }
  const classicA = await layeredMaterial(base, infoA, parser)
  const classicB = await layeredMaterial(base, infoB, parser)
  classicB.emissive.setRGB(1, 0.5, 0)
  classicB.emissiveIntensity = 2
  const a = new THREE.Mesh(geometry([0, 1, 2]), classicA)
  const b = new THREE.Mesh(geometry([2, 1, 3]), classicB)
  const glass = new THREE.Mesh(geometry([0, 2, 3]), new THREE.MeshStandardMaterial({ transparent: true }))
  prepareLayerUVs(a.geometry, infoA)
  prepareLayerUVs(b.geometry, infoB)
  const root = new THREE.Group()
  root.add(a, b, glass)
  tagSurface(a, Object.assign(new THREE.MeshStandardMaterial(), { name: 'mat_a' }), 1, 'structure')
  tagSurface(b, Object.assign(new THREE.MeshStandardMaterial(), { name: 'mat_b' }), 2, 'structure')
  return { maps, a, b, glass, root, uvs, owned: [classicA, classicB, glass.material] as THREE.Material[] }
}

describe('convertLayered', () => {
  it('places a merged material, one row per composition, and duplicates shared vertices', async () => {
    const { maps, a, b, glass, owned } = await scene()
    const disposed = new Set<THREE.Texture>()
    for (const t of maps) t.addEventListener('dispose', () => disposed.add(t))
    const merge = convertLayered([a, b], [a, b, glass], owned)
    expect(merge?.stats).toMatchObject({ materialsBefore: 2, materialsAfter: 1, meshes: 2, rows: 2, rejected: 0, duplicated: 2 })
    expect(merge?.stats.arrays).toEqual(['4x4x1', '4x4x2', '8x8x1'])
    expect(a.material).toBe(b.material)
    expect(isMergedMaterial(a.material)).toBe(true)
    expect(owned).toEqual([glass.material, a.material])
    expect(disposed).toEqual(new Set(maps))
    // The extended buffer serves the three surfaces; vertices 1 and 2 have a copy for b's row.
    const position = a.geometry.getAttribute('position')
    expect([position.count, b.geometry.getAttribute('position'), glass.geometry.getAttribute('position')]).toEqual([6, position, position])
    expect(Array.from(a.geometry.getAttribute('cRow').array)).toEqual([0, 0, 0, 1, 1, 1])
    expect(Array.from(b.geometry.index!.array)).toEqual([4, 5, 3])
    expect([position.getX(4), position.getY(4), position.getX(5), position.getY(5)]).toEqual([-1, 1, 1, -1])
    // b has no mask: it reads a's mask set, to share its material.
    expect(b.geometry.getAttribute('cMacro')).toBe(a.geometry.getAttribute('cMacro'))
    // b's own light is in its row (intensity included), not in the material.
    const params = merge!.atlas.params.image.data as unknown as Float32Array
    expect(Array.from(params.slice((ROW_TEXELS + GLOW_TEXEL) * 4, (ROW_TEXELS + GLOW_TEXEL) * 4 + 4))).toEqual([2, 1, 0, 0])
  })

  it("replaces the shader's maps with arrays read at the vertex's row", async () => {
    const { a, b, glass, owned } = await scene()
    convertLayered([a, b], [a, b, glass], owned)
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: '#include <common>\n#include <uv_vertex>',
      fragmentShader: '#include <common>\n#include <map_fragment>\n#include <emissivemap_fragment>',
    }
    ;(a.material as THREE.Material).onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)
    expect(Object.keys(shader.uniforms).sort()).toEqual(['uArr0', 'uArr1', 'uArr2', 'uParams'])
    expect(shader.fragmentShader).toContain('uniform highp sampler2DArray uArr2;')
    expect(shader.fragmentShader).not.toContain('uLayer')
    expect(shader.fragmentShader).toContain(`totalEmissiveRadiance = P_TEXEL(${GLOW_TEXEL}).rgb;`)
    expect(shader.vertexShader).toContain('vRow = cRow;')
  })
})

describe('batchLayered', () => {
  it('draws same-material surfaces as a single mesh; the inspector still names the surface', async () => {
    const { a, b, glass, root, owned } = await scene()
    const merge = convertLayered([a, b], [a, b, glass], owned)!
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const release = batchLayered(merge, [a, b, glass], tightenBounds)
    expect(info).toHaveBeenCalledTimes(1)
    info.mockRestore()
    const drawn = root.children.filter((o) => o.name === 'merged-map') as THREE.Mesh[]
    expect(drawn).toHaveLength(1)
    expect(Array.from(drawn[0].geometry.index!.array)).toEqual([0, 1, 2, 4, 5, 3])
    expect(drawn[0].material).toBe(a.material)
    expect([a.visible, b.visible, glass.visible]).toEqual([false, false, true])
    expect(drawn[0].geometry.boundingBox?.max.toArray()).toEqual([1, 1, 0])

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    root.updateMatrixWorld(true)
    expect(probeSurface([root], camera, new THREE.Vector2(0.05, -0.1))?.material).toBe('mat_a')

    release()
    expect(root.children.some((o) => o.name === 'merged-map')).toBe(false)
  })
})
