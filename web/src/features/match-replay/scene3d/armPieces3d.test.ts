// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import nyexc from './testdata/nyexc-arms.json'
import { fetchMesh } from './meshFetch'
import { ArmPieces3d, lierPiece, planBras, type BrasIndex, type BrasPiece } from './armPieces3d'

vi.mock('./meshFetch', () => ({ fetchMesh: vi.fn() }))

function indexPieces(pieces: BrasPiece[], defaults: Record<string, string>): BrasIndex {
  return { schema: 2, skeleton: { bones: ['a', 'b'] }, pieces, default: defaults, failures: [] }
}

function piece(key: string, region: string, permutation: string): BrasPiece {
  return { key, region, permutation, file: `piece-${key}.glb`, triangles: 1, bbox: { min: [0,0,0], max: [1,1,1] }, bytes: 1 }
}

describe('planBras', () => {
  it('selects Nyexc’s live prosthetic arm pieces', () => {
    const pieces = planBras(nyexc.catalog, nyexc.player.regions)
    expect(pieces).toHaveLength(8)
    expect(pieces.map((p) => p.key)).toContain('3f91af6a-16a12dd4')
    expect(pieces.map((p) => p.key)).toContain('62059329-16a12dd4')
    expect(nyexc.player.regions.find((r) => r.region_key === '3f91af6a')?.source).toBe('prosthetic_left_arm')
  })

  it(`selects the player's permutation when the piece exists`, () => {
    const idx = indexPieces(
      [piece('r1-p1', 'r1', 'p1'), piece('r1-d', 'r1', 'd')],
      { r1: 'd' },
    )
    const regions = [{ region_key: 'r1', permutation_key: 'p1' }]
    const plan = planBras(idx, regions)
    expect(plan.map((p) => p.key)).toEqual(['r1-p1'])
  })

  it(`falls back to the default permutation when the player's does not exist`, () => {
    const idx = indexPieces(
      [piece('r1-p1', 'r1', 'p1'), piece('r1-d', 'r1', 'd')],
      { r1: 'd' },
    )
    const regions = [{ region_key: 'r1', permutation_key: 'inconnue' }]
    const plan = planBras(idx, regions)
    expect(plan.map((p) => p.key)).toEqual(['r1-d'])
  })

  it(`skips a region when neither the player's piece nor the default exists`, () => {
    const idx = indexPieces(
      [piece('r2-d', 'r2', 'd')],
      { r1: 'x', r2: 'd' },
    )
    const regions = [{ region_key: 'r1', permutation_key: 'y' }]
    const plan = planBras(idx, regions)
    expect(plan.map((p) => p.region)).toEqual(['r2'])
  })

  it(`gives the default set when regions is null`, () => {
    const idx = indexPieces(
      [piece('r1-d', 'r1', 'd'), piece('r2-d', 'r2', 'd')],
      { r1: 'd', r2: 'd' },
    )
    const plan = planBras(idx, null)
    expect(plan.map((p) => p.key).sort()).toEqual(['r1-d', 'r2-d'])
  })

  it(`ignores regions outside the index`, () => {
    const idx = indexPieces(
      [piece('r1-d', 'r1', 'd')],
      { r1: 'd' },
    )
    const regions = [{ region_key: 'hors', permutation_key: 'x' }, { region_key: 'r1', permutation_key: 'p1' }]
    const plan = planBras(idx, regions)
    expect(plan.map((p) => p.region)).toEqual(['r1'])
  })
})

describe('lierPiece', () => {
  function pieceTest(boneNames: string[]): THREE.Object3D {
    const scene = new THREE.Group()
    const bones = boneNames.map((n) => { const b = new THREE.Bone(); b.name = n; return b })
    scene.add(...bones)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,0, 1,0,0, 0,1,0]), 3))
    const mat = new THREE.MeshStandardMaterial()
    mat.userData.surfaceBrute = {}
    const mesh = new THREE.SkinnedMesh(geo, mat)
    const skel = new THREE.Skeleton(bones)
    mesh.bind(skel)
    scene.add(mesh)
    return scene
  }

  function rigTest(boneNames: string[]): THREE.Object3D {
    const scene = new THREE.Group()
    for (const n of boneNames) { const b = new THREE.Bone(); b.name = n; scene.add(b) }
    return scene
  }

  it(`binds the piece's bones to the rig's in the piece's order`, () => {
    const pieceScene = pieceTest(['a', 'b'])
    const rig = rigTest(['b', 'x', 'a'])
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = lierPiece(pieceScene, rig)
    expect(result).toHaveLength(1)
    const rigBones = result[0].skeleton.bones
    expect(rigBones[0].name).toBe('a')
    expect(rigBones[1].name).toBe('b')
    expect(rigBones[0]).toBe(rig.getObjectByName('a'))
    expect(rigBones[1]).toBe(rig.getObjectByName('b'))
  })

  it(`skips the mesh when a bone is missing from the rig`, () => {
    const pieceScene = pieceTest(['a', 'b'])
    const rig = rigTest(['x'])
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = lierPiece(pieceScene, rig)
    expect(result).toHaveLength(0)
  })
})

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
    // Embedded images reach the transcoder as bytes (no blob URL); counted like a load.
    parse(_bytes: ArrayBuffer, onLoad: (t: THREE.CompressedTexture) => void) {
      urls.push('bytes')
      onLoad(compressed())
    },
  }
  return { urls, loader: loader as unknown as KTX2Loader }
}

/** ktx2Glb: one square under `decor` whose base color is a KTX2 image (`KHR_texture_basisu`). */
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

describe('ArmPieces3d KTX2', () => {
  it('routes a piece GLB KTX2 image through the KTX2 loader it was given', async () => {
    const { urls, loader } = fakeKtx2()
    vi.mocked(fetchMesh).mockResolvedValueOnce(ktx2Glb())
    const pieces = new ArmPieces3d('/bras', new AbortController().signal, loader)
    const scene = await pieces.piece('piece-x.glb')
    expect(scene).not.toBeNull()
    expect(urls).toHaveLength(1)
    const decor = scene!.getObjectByName('decor')!.children[0] as THREE.Mesh
    expect((decor.material as THREE.MeshStandardMaterial).map).toBeInstanceOf(THREE.CompressedTexture)
    pieces.dispose()
  })

  it('resolves a KTX2 piece to null without a KTX2 loader', async () => {
    vi.mocked(fetchMesh).mockResolvedValueOnce(ktx2Glb())
    const pieces = new ArmPieces3d('/bras', new AbortController().signal, null)
    await expect(pieces.piece('piece-x.glb')).resolves.toBeNull()
    expect(vi.mocked(fetchMesh)).toHaveBeenCalledTimes(1)
    pieces.dispose()
  })
})
