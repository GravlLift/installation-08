/** Tests the KTX2 (GPU-compressed) texture path of the map and variant GLBs. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BASIS_TRANSCODER_FILES, BASIS_TRANSCODER_PATH, completeMips, createKtx2Loader, ktx2WorkerCount, releaseTexels, withKtx2 } from './ktx2Textures3d'
import { IMAGE_LIBEREE, isMergedMaterial, LayeredAtlas } from './layeredArrays3d'
import { layeredComposition, layeredMaterial, type LayeredInfo } from './layeredMaterial'
import { textureFacts } from './layeredMerge3d'
import { loadLayerModel, loadMapModel } from './mapModel'

/** The web/ folder (this file is web/src/features/match-replay/scene3d/). */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

const BPTC = { COMPRESSED_RGBA_BPTC_UNORM_EXT: 0x8e8c, COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT: 0x8e8d }

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
function fakeKtx2(levels = 3) {
  const urls: string[] = []
  const loader = {
    load(url: string, onLoad: (t: THREE.CompressedTexture) => void) {
      urls.push(url)
      onLoad(compressed(4, levels))
    },
  }
  return { urls, loader: loader as unknown as KTX2Loader }
}

/**
 * ktx2Glb: one square under `structure` whose layered material reads texture 0, a KTX2 image
 * (`KHR_texture_basisu`, required), and one cutout square under `decor` whose base color is the
 * same texture.
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
      { name: 'couches', extras: { couches: { couches: [{ sorte: 'couleur', texture: 0, opacite: 1 }], masque: -1, jeuMasque: 0, jeuCouches: 0 } } },
      { name: 'decoupe', alphaMode: 'MASK', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
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

function meshUnder(root: THREE.Object3D, node: string): THREE.Mesh {
  const found = root.getObjectByName(node)?.children[0]
  if (!(found instanceof THREE.Mesh)) throw new Error(`no mesh under ${node}`)
  return found
}

// GLTFLoader hands an embedded image to its loader as a blob URL, which jsdom does not make.
const realCreate = URL.createObjectURL
const realRevoke = URL.revokeObjectURL
beforeEach(() => {
  URL.createObjectURL = () => 'blob:it3d-test'
  URL.revokeObjectURL = () => {}
})
afterEach(() => {
  URL.createObjectURL = realCreate
  URL.revokeObjectURL = realRevoke
})

describe('createKtx2Loader', () => {
  it('serves the Basis transcoder from the app itself, never another origin', () => {
    expect(BASIS_TRANSCODER_PATH).toBe('/assets/')
    expect(BASIS_TRANSCODER_PATH.startsWith('/') && !BASIS_TRANSCODER_PATH.startsWith('//')).toBe(true)
    expect(new URL(BASIS_TRANSCODER_PATH, 'http://127.0.0.1:8177/match/x').origin).toBe('http://127.0.0.1:8177')
    const renderer = { extensions: { has: (name: string) => name === 'EXT_texture_compression_bptc' || name === 'WEBGL_compressed_texture_s3tc' } }
    const loader = createKtx2Loader(renderer as unknown as THREE.WebGLRenderer)
    expect(loader.transcoderPath).toBe(BASIS_TRANSCODER_PATH)
    expect(loader.workerConfig).toMatchObject({ bptcSupported: true, dxtSupported: true, astcSupported: false })
    loader.dispose()
  })

  it('sizes the decode workers to the machine, two under the core count, clamped to [2, 8]', () => {
    const cores = vi.spyOn(navigator, 'hardwareConcurrency', 'get')
    const expectCount = (logicalCores: number, workers: number) => {
      cores.mockReturnValue(logicalCores)
      expect(ktx2WorkerCount(), `hardwareConcurrency=${logicalCores}`).toBe(workers)
    }
    // Below and at the floor: the clamp keeps two workers even when cores minus two is zero.
    expectCount(0, 2)   // missing -> falls back to 4, 4 - 2 = 2
    expectCount(2, 2)   // 2 - 2 = 0 -> clamped up to 2
    expectCount(3, 2)   // 3 - 2 = 1 -> clamped up to 2
    // The middle range: cores minus two, unchanged.
    expectCount(4, 2)
    expectCount(6, 4)
    expectCount(10, 8)
    // Above the ceiling: the clamp caps at eight workers.
    expectCount(12, 8)  // 12 - 2 = 10 -> clamped down to 8
    expectCount(32, 8)  // 32 - 2 = 30 -> clamped down to 8
    cores.mockRestore()
  })

  it('hands the machine-sized worker limit to the KTX2Loader', () => {
    const cores = vi.spyOn(navigator, 'hardwareConcurrency', 'get')
    cores.mockReturnValue(16) // 16 - 2 = 14 -> clamped to 8
    const renderer = { extensions: { has: (name: string) => name === 'EXT_texture_compression_bptc' } }
    const loader = createKtx2Loader(renderer as unknown as THREE.WebGLRenderer)
    expect((loader as unknown as { workerPool: { pool: number } }).workerPool.pool).toBe(8)
    loader.dispose()
    cores.mockRestore()
  })

  it('names the files three ships, which the Vite build copies into assets/', () => {
    const basis = path.join(WEB_DIR, 'node_modules/three/examples/jsm/libs/basis')
    for (const f of BASIS_TRANSCODER_FILES) expect(fs.existsSync(path.join(basis, f)), f).toBe(true)
    const config = fs.readFileSync(path.join(WEB_DIR, 'vite.config.ts'), 'utf8')
    for (const f of BASIS_TRANSCODER_FILES) expect(config).toContain(`'${f}'`)
    expect(config).toContain('fileName: `assets/${f}`')
  })
})

describe('withKtx2', () => {
  it('leaves a loader without KTX2 loader as it was', () => {
    const loader = new GLTFLoader()
    const plugins = (loader as unknown as { pluginCallbacks: unknown[] }).pluginCallbacks.length
    expect(withKtx2(loader, null)).toBe(loader)
    expect((loader as unknown as { ktx2Loader: unknown }).ktx2Loader).toBeNull()
    expect((loader as unknown as { pluginCallbacks: unknown[] }).pluginCallbacks.length).toBe(plugins)
  })

  it('routes the map GLB\'s KTX2 images through the given loader, counted by the loading bar', async () => {
    const { urls, loader } = fakeKtx2()
    const steps: [string, number | undefined, number | undefined][] = []
    const model = await loadMapModel(ktx2Glb(), (step, done, total) => steps.push([step, done, total]), loader)
    expect(urls.length).toBe(1)
    const decor = meshUnder(model.root, 'decor').material as THREE.MeshStandardMaterial
    expect(decor.map).toBeInstanceOf(THREE.CompressedTexture)
    expect(steps).toContainEqual(['materials', 1, 1])
    model.dispose()
  })

  it('routes the variant GLB\'s KTX2 images through the given loader into a compressed merged array', async () => {
    const { urls, loader } = fakeKtx2()
    const layer = await loadLayerModel(ktx2Glb(), null, undefined, loader)
    expect(urls.length).toBe(1)
    const m = meshUnder(layer.root, 'structure').material as THREE.MeshStandardMaterial
    expect(isMergedMaterial(m)).toBe(true)
    const arrays = (m.userData.textures as THREE.Texture[]).filter((t) => t instanceof THREE.CompressedArrayTexture) as THREE.CompressedArrayTexture[]
    expect(arrays.length).toBe(1)
    expect(arrays[0].format).toBe(THREE.RGBA_BPTC_Format)
    expect(arrays[0].colorSpace).toBe(THREE.SRGBColorSpace)
    expect(arrays[0].flipY).toBe(false)
    expect(arrays[0].mipmaps?.map((l) => l.width)).toEqual([4, 2, 1])
    layer.dispose()
  })

  it('fails a KTX2 GLB loudly without a KTX2 loader', async () => {
    await expect(loadLayerModel(ktx2Glb(), null)).rejects.toThrow(/setKTX2Loader/)
  })

  it('keeps a single-level compressed texture drawable', async () => {
    const { loader } = fakeKtx2(1)
    const model = await loadMapModel(ktx2Glb(), () => {}, loader)
    const decor = meshUnder(model.root, 'decor').material as THREE.MeshStandardMaterial
    // GLTFLoader gave it the default mipmapped filter; one level cannot be sampled that way.
    expect(decor.map?.minFilter).toBe(THREE.LinearFilter)
    model.dispose()
  })
})

describe('compressed textures on the paths that read pixels', () => {
  it('completeMips: leaves decoded and full-chain textures alone', () => {
    const decoded = new THREE.Texture()
    decoded.minFilter = THREE.LinearMipmapLinearFilter
    completeMips(decoded)
    expect(decoded.minFilter).toBe(THREE.LinearMipmapLinearFilter)
    const full = compressed(4, 3)
    completeMips(full)
    expect(full.minFilter).toBe(THREE.LinearMipmapLinearFilter)
    const one = compressed(4, 1)
    one.minFilter = THREE.NearestMipmapNearestFilter
    completeMips(one)
    expect(one.minFilter).toBe(THREE.NearestFilter)
  })

  it('textureFacts: a compressed map has its size, groups by format and level count, unreadable once released', () => {
    const t = compressed(4, 3)
    const facts = textureFacts(t)
    expect(facts).toMatchObject({ width: 4, height: 4 })
    expect(facts?.settings).not.toBe(textureFacts(compressed(4, 2))?.settings)
    const decoded = new THREE.Texture()
    decoded.image = { width: 4, height: 4 }
    decoded.flipY = false
    expect(facts?.settings).not.toBe(textureFacts(decoded)?.settings)
    releaseTexels(t)
    expect(textureFacts(t)).toBeNull()
  })

  it('LayeredAtlas.upload: copies the encoded levels of each layer, decodes and generates nothing', () => {
    const members = [compressed(4, 3), compressed(4, 3)]
    members.forEach((t) => (t.colorSpace = THREE.SRGBColorSpace))
    members[1].userData[IMAGE_LIBEREE] = true
    const atlas = new LayeredAtlas([{ width: 4, height: 4, settings: 's', members }], new Float32Array(4), 1)
    const array = atlas.arrays[0] as THREE.CompressedArrayTexture
    expect(array).toBeInstanceOf(THREE.CompressedArrayTexture)
    expect(array.image).toMatchObject({ width: 4, height: 4, depth: 2 })
    expect(array.source.dataReady).toBe(false)
    const compressedCalls: unknown[][] = []
    const gl = {
      TEXTURE_2D_ARRAY: 0x8c1a, UNPACK_FLIP_Y_WEBGL: 0x9240, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
      pixelStorei: vi.fn(),
      compressedTexSubImage3D: (...args: unknown[]) => compressedCalls.push(args),
      texSubImage3D: vi.fn(),
      generateMipmap: vi.fn(),
    }
    const renderer = {
      getContext: () => gl,
      initTexture: vi.fn(),
      properties: { get: () => ({ __webglTexture: {} }) },
      state: { bindTexture: vi.fn(), unbindTexture: vi.fn() },
      extensions: { get: (name: string) => (name === 'EXT_texture_compression_bptc' ? BPTC : null) },
    }
    const kept = members[0].mipmaps?.map((m) => m.data)
    atlas.upload(renderer as unknown as THREE.WebGLRenderer)
    expect(gl.texSubImage3D).not.toHaveBeenCalled()
    expect(gl.generateMipmap).not.toHaveBeenCalled()
    expect(gl.pixelStorei).toHaveBeenCalledWith(gl.UNPACK_FLIP_Y_WEBGL, false)
    // Two layers, three levels each, in the sRGB BC7 format three allocated the array with.
    expect(compressedCalls.map((c) => [c[1], c[4], c[5], c[6], c[7], c[8]])).toEqual([
      [0, 0, 4, 4, 1, BPTC.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT],
      [1, 0, 2, 2, 1, BPTC.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT],
      [2, 0, 1, 1, 1, BPTC.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT],
      [0, 1, 4, 4, 1, BPTC.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT],
      [1, 1, 2, 2, 1, BPTC.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT],
      [2, 1, 1, 1, 1, BPTC.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT],
    ])
    expect(compressedCalls[0][9]).toBe(kept?.[0])
    // The released member's levels are dropped once copied; the kept one still has its own.
    expect(members[1].mipmaps).toEqual([])
    expect(members[0].mipmaps?.length).toBe(3)
    atlas.dispose()
  })

  it('layered material: takes the compressed map from the parser, in the layer\'s color space', async () => {
    const { loader } = fakeKtx2()
    const gltf = await withKtx2(new GLTFLoader(), loader).parseAsync(ktx2Glb(), '')
    const info: LayeredInfo = { couches: [{ sorte: 'couleur', texture: 0, opacite: 1 }, { sorte: 'degrade', controle: 0, opacite: 1 }], masque: -1, jeuMasque: 0, jeuCouches: 0 }
    const m = await layeredMaterial(new THREE.MeshStandardMaterial(), info, gltf.parser)
    const composition = layeredComposition(m)
    expect(composition?.maps[0]).toBeInstanceOf(THREE.CompressedTexture)
    expect(composition?.controls[1]).toBeInstanceOf(THREE.CompressedTexture)
    // glTF textures are never flipped, KTX2 ones cannot be: same UV orientation as the PNG maps.
    expect(composition?.maps[0]?.flipY).toBe(false)
    expect(m.userData.textures.length).toBe(2)
    m.dispose()
  })
})