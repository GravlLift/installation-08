import * as THREE from 'three'
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LoadGate } from './loadGate3d'
import { fetchMesh } from './meshFetch'
import { WeaponModels } from './weaponModels3d'

vi.mock('./meshFetch', () => ({ fetchMesh: vi.fn() }))

/** A transcoded KTX2 texture as KTX2Loader hands it: BC7 levels, `levels` of them from `size`. */
function compressed(size = 4, levels = 3): THREE.CompressedTexture {
  const mipmaps = Array.from({ length: levels }, (_, i) => {
    const side = Math.max(1, size >> i)
    return { data: new Uint8Array(Math.max(1, Math.ceil(side / 4)) ** 2 * 16).fill(i + 1), width: side, height: side }
  })
  const t = new THREE.CompressedTexture(mipmaps, size, size, THREE.RGBA_BPTC_Format)
  t.minFilter = levels > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
  t.generateMipmaps = false
  return t
}

/** A KTX2Loader stand-in: every image it is asked for is a transcoded `compressed()` texture. */
function fakeKtx2() {
  const urls: string[] = []
  const loader = {
    load(url: string, onLoad: (t: THREE.CompressedTexture) => void) {
      urls.push(url)
      onLoad(compressed())
    },
  }
  return { urls, loader: loader as unknown as KTX2Loader }
}

/**
 * ktx2Glb: one square under `structure` and one under `decor` whose base color is a KTX2 image
 * (`KHR_texture_basisu`, required).
 */
function ktx2Glb(): ArrayBuffer {
  const bin = new ArrayBuffer(48 + 32 + 12 + 4)
  new Float32Array(bin, 0, 12).set([-1, 1, -1, 1, 1, -1, 1, 1, 1, -1, 1, 1])
  new Float32Array(bin, 48, 8).set([0, 0, 1, 0, 1, 1, 0, 1])
  new Uint16Array(bin, 80, 6).set([0, 2, 1, 0, 3, 2])
  new Uint8Array(bin, 92, 4).set([0xab, 0x4b, 0x54, 0x58])
  const mesh = (material: number) => ({ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material }] })
  const json = {
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_texture_basisu'],
    extensionsRequired: ['KHR_texture_basisu'],
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [{ name: 'structure', children: [2] }, { name: 'decor', children: [3] }, { mesh: 0 }, { mesh: 1 }],
    meshes: [mesh(0), mesh(1)],
    materials: [
      { name: 'structure' },
      { name: 'decor', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
    ],
    textures: [{ extensions: { KHR_texture_basisu: { source: 0 } } }],
    images: [{ bufferView: 3, mimeType: 'image/ktx2' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-1, 1, -1], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: 2, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 48, target: 34962 },
      { buffer: 0, byteOffset: 48, byteLength: 32, target: 34962 },
      { buffer: 0, byteOffset: 80, byteLength: 12, target: 34963 },
      { buffer: 0, byteOffset: 92, byteLength: 4 },
    ],
    buffers: [{ byteLength: bin.byteLength }],
  }
  const text = new TextEncoder().encode(JSON.stringify(json))
  const jsonLength = Math.ceil(text.length / 4) * 4
  const out = new Uint8Array(12 + 8 + jsonLength + 8 + bin.byteLength)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, out.length, true)
  view.setUint32(12, jsonLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  out.fill(0x20, 20, 20 + jsonLength)
  out.set(text, 20)
  const binAt = 20 + jsonLength
  view.setUint32(binAt, bin.byteLength, true)
  view.setUint32(binAt + 4, 0x004e4942, true)
  out.set(new Uint8Array(bin), binAt + 8)
  return out.buffer
}

// GLTFLoader hands an embedded image to its loader as a blob URL, which jsdom does not make.
const realCreate = URL.createObjectURL
const realRevoke = URL.revokeObjectURL
beforeEach(() => {
  vi.clearAllMocks()
  URL.createObjectURL = () => 'blob:it3d-test'
  URL.revokeObjectURL = () => {}
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  URL.createObjectURL = realCreate
  URL.revokeObjectURL = realRevoke
  vi.restoreAllMocks()
})

describe('WeaponModels.sourcesChargees', () => {
  it('rend les modèles chargés, vide sans modèle chargé', () => {
    const models = new WeaponModels('/weapons')
    expect(models.sourcesChargees()).toEqual([])
    models.dispose()
    expect(models.sourcesChargees()).toEqual([])
  })
})

describe('WeaponModels KTX2', () => {
  it('routes a weapon GLB KTX2 image through the KTX2 loader it was given', async () => {
    const { urls, loader } = fakeKtx2()
    vi.mocked(fetchMesh).mockResolvedValueOnce(ktx2Glb())
    const gate = new LoadGate()
    const models = new WeaponModels('/weapons', gate, undefined, undefined, undefined, loader)
    expect(models.model('2b1824d5')).toBeNull()
    await gate.idle(2000)
    const model = models.model('2b1824d5')
    expect(model).not.toBeNull()
    expect(urls).toHaveLength(1)
    const decor = model!.getObjectByName('decor')!.children[0] as THREE.Mesh
    expect((decor.material as THREE.MeshStandardMaterial).map).toBeInstanceOf(THREE.CompressedTexture)
    models.dispose()
  })

  it('keeps a KTX2 weapon GLB absent without a KTX2 loader (the PNG-only cache of before)', async () => {
    vi.mocked(fetchMesh).mockResolvedValueOnce(ktx2Glb())
    const gate = new LoadGate()
    const models = new WeaponModels('/weapons', gate, undefined, undefined, undefined, null)
    expect(models.model('2b1824d5')).toBeNull()
    await gate.idle(2000)
    expect(models.model('2b1824d5')).toBeNull()
    expect(vi.mocked(fetchMesh)).toHaveBeenCalledTimes(1)
    models.dispose()
  })
})
