// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * variantLayer.test.ts — the variant's object layer goes through the map's preparation
 * (families, inspector tags, `ombre*` nodes, index, the structure's back face, baked light
 * carried over), becomes ground for action layers, and a 404 is not a failure.
 */
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Ground } from './actionKit'
import { BACK_FACE_NAME } from './backFaces3d'
import type { BakedLight } from './bakedLightShader'
import { loadLayerModel } from './mapModel'
import { fetchMesh } from './meshFetch'
import type { SurfaceTag } from './surfaceProbe3d'
import { loadVariantLayer } from './variantLayer'

vi.mock('./meshFetch', () => ({ fetchMesh: vi.fn() }))

const fetchMock = vi.mocked(fetchMesh)

/** A horizontal 2 u square at three height `y`. */
const SQUARE = (y: number) => [-1, y, -1, 1, y, -1, 1, y, 1, -1, y, 1]
const INDICES = [0, 2, 1, 0, 3, 2]

/**
 * tinyGlb: a GLB in the map's mesh format, reduced to one square per parent node: a crate
 * (structure, published shader), a backdrop (`decor*`), a glass pane (`vitre`), a shadow
 * proxy (`ombre*`).
 */
function tinyGlb(height = 1): ArrayBuffer {
  const bin = new ArrayBuffer(60)
  new Float32Array(bin, 0, 12).set(SQUARE(height))
  new Uint16Array(bin, 48, 6).set(INDICES)
  const mesh = (material: number) => ({ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material }] })
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1, 2, 3] }],
    nodes: [
      { name: 'structure', children: [4] },
      { name: 'decor_fond', children: [5] },
      { name: 'vitres', children: [6] },
      { name: 'ombre_mandataire', children: [7] },
      { mesh: 0 },
      { mesh: 1 },
      { mesh: 2 },
      { mesh: 0 },
    ],
    meshes: [mesh(0), mesh(1), mesh(2)],
    materials: [
      { name: 'mat_caisse', extras: { shader: 0x377bfad9 } },
      { name: 'mat_fond' },
      { name: 'mat_vitre', extras: { vitre: true } },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-1, height, -1], max: [1, height, 1] },
      { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 48, target: 34962 },
      { buffer: 0, byteOffset: 48, byteLength: 12, target: 34963 },
    ],
    buffers: [{ byteLength: 60 }],
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

afterEach(() => {
  fetchMock.mockReset()
  vi.restoreAllMocks()
})

describe('loadLayerModel', () => {
  it('prepares the layer like the map: families, tags, hidden shadows, index', async () => {
    const layer = await loadLayerModel(tinyGlb(), null)
    const crate = meshUnder(layer.root, 'structure')
    expect(layer.pickables).toEqual([crate])
    expect(layer.seeThrough).toEqual([meshUnder(layer.root, 'vitres')])
    expect(layer.surfaces).toHaveLength(3)
    expect(crate.userData.surface as SurfaceTag).toEqual({ material: 'mat_caisse', shader: '377bfad9', family: 'structure' })
    expect((meshUnder(layer.root, 'decor_fond').userData.surface as SurfaceTag).family).toBe('decor')
    expect(meshUnder(layer.root, 'ombre_mandataire').visible).toBe(false)
    expect(crate.geometry.boundsTree).toBeDefined()
    layer.dispose()
  })

  it('only the structure has its back face, outside the model lists, released with it', async () => {
    const layer = await loadLayerModel(tinyGlb(), null)
    const crate = meshUnder(layer.root, 'structure')
    const backs = layer.root.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.name === BACK_FACE_NAME)
    // The backdrop (decor) and the glass pane read the same buffer: only the crate's index enters the back face.
    expect(backs).toHaveLength(1)
    expect(backs[0].geometry.getAttribute('position')).toBe(crate.geometry.getAttribute('position'))
    expect(Array.from(backs[0].geometry.index?.array ?? [])).toEqual(Array.from(crate.geometry.index?.array ?? []))
    expect(layer.surfaces).not.toContain(backs[0])
    expect(layer.pickables).not.toContain(backs[0])
    let released = 0
    ;(backs[0].material as THREE.Material).addEventListener('dispose', () => released++)
    layer.dispose()
    expect(released).toBe(1)
    expect(backs[0].parent).toBeNull()
  })

  it("carries over the map's baked light onto each of its materials", async () => {
    const light = { apply: vi.fn() } as unknown as BakedLight
    const layer = await loadLayerModel(tinyGlb(), light)
    const applied = vi.mocked(light.apply).mock.calls.map(([m]) => m)
    for (const mesh of layer.surfaces) expect(applied).toContain(mesh.material)
    layer.dispose()
  })
})

describe('Ground with a layer', () => {
  it('ground placed after the fact carries action layers, already-read heights are forgotten', async () => {
    const map = await loadLayerModel(tinyGlb(0), null)
    const layer = await loadLayerModel(tinyGlb(1), null)
    const ground = new Ground([...map.pickables], 10)
    expect(ground.floorY(0, 0, null)).toBeCloseTo(0)
    ground.setPickables([...map.pickables, ...layer.pickables])
    expect(ground.floorY(0, 0, null)).toBeCloseTo(1)
    ground.setPickables([...map.pickables])
    expect(ground.floorY(0, 0, null)).toBeCloseTo(0)
    map.dispose()
    layer.dispose()
  })
})

describe('loadVariantLayer', () => {
  const signal = new AbortController().signal

  it('absent (404): no layer, only logged at debug level', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn')
    fetchMock.mockRejectedValue({ code: 'not_found', message: 'absent', retryable: false, status: 404 })
    await expect(loadVariantLayer('/v.glb', signal, null)).resolves.toBeNull()
    expect(debug).toHaveBeenCalledOnce()
    expect(warn).not.toHaveBeenCalled()
  })

  it('a different failure: the error bubbles up to the caller', async () => {
    fetchMock.mockRejectedValue({ code: 'internal', message: 'panne', retryable: true, status: 500 })
    await expect(loadVariantLayer('/v.glb', signal, null)).rejects.toMatchObject({ status: 500 })
  })

  it('present: the prepared layer', async () => {
    fetchMock.mockResolvedValue(tinyGlb())
    const layer = await loadVariantLayer('/v.glb', signal, null)
    expect(fetchMock).toHaveBeenCalledWith('/v.glb', expect.any(Function), signal)
    expect(layer?.pickables).toHaveLength(1)
    layer?.dispose()
  })
})
