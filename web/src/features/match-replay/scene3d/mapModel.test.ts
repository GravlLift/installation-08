// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** Tests glass material selection and stencil decals. */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { glowStateAt, type GlowAnimSpec } from './glowAnimation3d'
import type { LayeredInfo } from './layeredMaterial'
import { glowLevel, IMAGE_GLOW_MAX, imageGlowLevel } from './lighting'
import { DECAL_TINT, decalStencilMaterial, loadLayerModel, teinteVerreTeint } from './mapModel'

/** A 2u-wide horizontal square at three.js height `y = 1`. */
const SQUARE = [-1, 1, -1, 1, 1, -1, 1, 1, 1, -1, 1, 1]
const INDICES = [0, 2, 1, 0, 3, 2]

/** The layered description of a dark glass (linear RGB), as in the map's GLB. */
const DARK_LAYERS: LayeredInfo = {
  couches: [
    { sorte: 'degrade', bas: [0.127, 0.127, 0.127], milieu: [0.095, 0.095, 0.095], haut: [0.091, 0.091, 0.091], opacite: 1 },
  ],
  masque: -1,
  jeuMasque: 0,
  jeuCouches: 0,
}

/** The expected tint: the average of the first layer's `bas`, `milieu` and `haut`. */
const EXPECTED_TINT = (0.127 + 0.095 + 0.091) / 3

/**
 * tinyGlb: a GLB reduced to one square per parent node: two dark glasses (same layers), one clear
 * glass (no layers), and three structure surfaces to test the stencil decal's placement — a
 * decal on the game's shader with no texture, a foreign shader, and a reference structure.
 */
function tinyGlb(glass: LayeredInfo = DARK_LAYERS): ArrayBuffer {
  const bin = new ArrayBuffer(60)
  new Float32Array(bin, 0, 12).set(SQUARE)
  new Uint16Array(bin, 48, 6).set(INDICES)
  const mesh = (material: number) => ({ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material }] })
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1, 2, 6, 7, 8] }],
    nodes: [
      { name: 'vitre_sombre_a', children: [3] },
      { name: 'vitre_sombre_b', children: [4] },
      { name: 'vitres', children: [5] },
      { mesh: 0 },
      { mesh: 1 },
      { mesh: 2 },
      { name: 'structure_plain', children: [9] },
      { name: 'decal_pochoir', children: [10] },
      { name: 'structure_autre', children: [11] },
      { mesh: 3 },
      { mesh: 4 },
      { mesh: 5 },
    ],
    meshes: [mesh(0), mesh(1), mesh(2), mesh(3), mesh(4), mesh(5)],
    materials: [
      { name: 'mat_sombre_a', extras: { vitre: true, couches: glass } },
      { name: 'mat_sombre_b', extras: { vitre: true, couches: glass } },
      { name: 'mat_vitre', extras: { vitre: true } },
      { name: 'mat_plain' },
      { name: 'mat_decal', extras: { shader: 3233303146 } },
      { name: 'mat_autre', extras: { shader: 0x1234 } },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-1, 1, -1], max: [1, 1, 1] },
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

/** glbOf: a GLB of one square per material, each under a parent node `n<rank>`. */
function glbOf(materials: object[]): ArrayBuffer {
  const bin = new ArrayBuffer(60)
  new Float32Array(bin, 0, 12).set(SQUARE)
  new Uint16Array(bin, 48, 6).set(INDICES)
  const n = materials.length
  const json = {
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_materials_emissive_strength'],
    scene: 0,
    scenes: [{ nodes: materials.map((_, i) => i) }],
    nodes: [
      ...materials.map((_, i) => ({ name: `n${i}`, children: [n + i] })),
      ...materials.map((_, i) => ({ mesh: i })),
    ],
    meshes: materials.map((_, i) => ({ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: i }] })),
    materials,
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-1, 1, -1], max: [1, 1, 1] },
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

describe('teinteVerreTeint', () => {
  it('averages the first layer\'s colors (bas, milieu, haut)', () => {
    const teinte = teinteVerreTeint(DARK_LAYERS)
    expect(teinte).toEqual([EXPECTED_TINT, EXPECTED_TINT, EXPECTED_TINT])
  })

  it('includes only the colors present', () => {
    const info: LayeredInfo = { couches: [{ sorte: 'couleur', bas: [0.1, 0.2, 0.3], opacite: 1 }], masque: -1, jeuMasque: 0, jeuCouches: 0 }
    expect(teinteVerreTeint(info)).toEqual([0.1, 0.2, 0.3])
  })

  it('returns null with no layer and no color', () => {
    expect(teinteVerreTeint({ couches: [], masque: -1, jeuMasque: 0, jeuCouches: 0 })).toBeNull()
    expect(teinteVerreTeint({ couches: [{ sorte: 'couleur' }], masque: -1, jeuMasque: 0, jeuCouches: 0 })).toBeNull()
  })
})

describe('layered glass', () => {
  const glass = (layers: LayeredInfo['couches']): LayeredInfo => ({ couches: layers, masque: -1, jeuMasque: 1, jeuCouches: layers.length })
  const gradient = (value: number) => ({ sorte: 'degrade' as const, bas: [value, value, value] as [number, number, number], milieu: [value, value, value] as [number, number, number], haut: [value, value, value] as [number, number, number], opacite: 1 })

  it.each([
    ['black single layer', glass([gradient(0)])],
    ['dark gray two layers', glass([gradient(0.105), gradient(0.06)])],
  ])('uses the shared clear glass for %s', async (_name, info) => {
    const layer = await loadLayerModel(tinyGlb(info), null)
    const material = meshUnder(layer.root, 'vitre_sombre_a').material as THREE.MeshStandardMaterial
    expect(material).toBe(meshUnder(layer.root, 'vitres').material)
    expect(material.color.getHex()).toBe(0x9fd4ff)
    expect(material.transparent).toBe(true)
    expect(material.opacity).toBe(0.18)
    expect(material.depthWrite).toBe(false)
    expect(material.side).toBe(THREE.DoubleSide)
    layer.dispose()
  })

  it('retains and shares multiply blending for a readable tint', async () => {
    const layer = await loadLayerModel(tinyGlb(glass([gradient(0.5)])), null)
    const material = meshUnder(layer.root, 'vitre_sombre_a').material as THREE.MeshBasicMaterial
    expect(material).toBe(meshUnder(layer.root, 'vitre_sombre_b').material)
    expect(material).not.toBe(meshUnder(layer.root, 'vitres').material)
    expect(material).toBeInstanceOf(THREE.MeshBasicMaterial)
    expect(material.blending).toBe(THREE.MultiplyBlending)
    expect(material.color.r).toBeCloseTo(0.5)
    expect(material.transparent).toBe(true)
    expect(material.depthWrite).toBe(false)
    expect(material.side).toBe(THREE.DoubleSide)
    layer.dispose()
  })
})

describe('self-lit surfaces', () => {
  const strength = (value: number) => ({ KHR_materials_emissive_strength: { emissiveStrength: value } })
  // Streets' NMPD sign: a dim blue tint at a high force (0.114 x 59).
  const sign = { name: 'sign', alphaMode: 'BLEND', emissiveFactor: [0.008, 0.024, 0.114], extensions: strength(59), extras: { melange: 1, emissionImage: true } }
  const freeSign = { name: 'free', alphaMode: 'BLEND', emissiveFactor: [0.685, 0.767, 1], extensions: strength(2), extras: { melange: 6, emissionImage: true } }
  const litGlass = { name: 'glass', alphaMode: 'BLEND', emissiveFactor: [1, 1, 1], extensions: strength(4), extras: { melange: 3, vitre: true } }
  const screen = { name: 'screen', emissiveFactor: [0.15, 0.15, 0.15], extensions: strength(60), extras: { emissionImage: true } }
  const neon = { name: 'neon', emissiveFactor: [0.745, 0.018, 0.745], extensions: strength(120), extras: {} }

  it('draws a see-through sign as its added picture, its whole light capped readable', async () => {
    const layer = await loadLayerModel(glbOf([sign]), null)
    const m = meshUnder(layer.root, 'n0').material as THREE.MeshBasicMaterial
    expect(m).toBeInstanceOf(THREE.MeshBasicMaterial)
    expect(m.blending).toBe(THREE.AdditiveBlending)
    expect(m.transparent).toBe(true)
    expect(m.depthWrite).toBe(false)
    expect(m.fog).toBe(false)
    expect(m.side).toBe(THREE.DoubleSide)
    expect(m.color.b).toBeCloseTo(IMAGE_GLOW_MAX)
    expect(m.color.r).toBeCloseTo((0.008 / 0.114) * IMAGE_GLOW_MAX)
    layer.dispose()
  })

  it('keeps the brighter of picture and background for the maximum blend', async () => {
    const layer = await loadLayerModel(glbOf([freeSign]), null)
    const m = meshUnder(layer.root, 'n0').material as THREE.MeshBasicMaterial
    expect(m.blending).toBe(THREE.CustomBlending)
    expect(m.blendEquation).toBe(THREE.MaxEquation)
    expect(m.color.b).toBeCloseTo(imageGlowLevel(2))
    layer.dispose()
  })

  it('keeps lit glass and a multiplying emitter on the glass family', async () => {
    const multiplying = { ...litGlass, name: 'multiply', extras: { melange: 4 } }
    const layer = await loadLayerModel(glbOf([litGlass, multiplying]), null)
    for (const node of ['n0', 'n1']) {
      const m = meshUnder(layer.root, node).material as THREE.MeshStandardMaterial
      expect(m).toBeInstanceOf(THREE.MeshStandardMaterial)
      expect(m.transparent).toBe(true)
      expect(m.emissiveIntensity).toBeCloseTo(glowLevel(4))
    }
    layer.dispose()
  })

  it('caps an opaque screen at a readable level and leaves a neon mask at its compressed force', async () => {
    const layer = await loadLayerModel(glbOf([screen, neon]), null)
    const s = meshUnder(layer.root, 'n0').material as THREE.MeshStandardMaterial
    expect(s.emissive.r).toBeCloseTo(1)
    expect(s.emissiveIntensity).toBeCloseTo(IMAGE_GLOW_MAX)
    const n = meshUnder(layer.root, 'n1').material as THREE.MeshStandardMaterial
    expect(n.emissive.r).toBeCloseTo(0.745)
    expect(n.emissive.g).toBeCloseTo(0.018)
    expect(n.emissiveIntensity).toBeCloseTo(glowLevel(120))
    layer.dispose()
  })

  it('animates the lights the build says the game animates, on match time, and draws the others still', async () => {
    // Streets' magenta neon 54a851a9: its amount wanders 0.2 Hz (a factor between 1.76 and 0.59).
    const pulse = { cible: 'force', periode: 1, fonction: { type: 3, min: 1.759288, max: 0.5858429, periodiques: [{ onde: 10, frequence: 0.2, phase: 0, min: 0, max: 1 }] } }
    const animated = { ...neon, name: 'pulse', extras: { id: 0x54a851a9, emissionAnim: [pulse] } }
    const layer = await loadLayerModel(glbOf([animated, neon, { ...sign, extras: { ...sign.extras, emissionAnim: [pulse] } }]), null)
    expect(layer.glowAnimation.size).toBe(2)
    const n = meshUnder(layer.root, 'n0').material as THREE.MeshStandardMaterial
    const still = meshUnder(layer.root, 'n1').material as THREE.MeshStandardMaterial
    expect(n).not.toBe(still)
    layer.glowAnimation.update(7.5)
    const factor = glowStateAt([pulse as GlowAnimSpec], [1, 1, 0, 0], 7.5, 0x54a851a9).force
    expect(n.emissiveIntensity).toBeCloseTo(glowLevel(120 * factor))
    expect(still.emissiveIntensity).toBeCloseTo(glowLevel(120))
    // Off: the still light of today, exactly.
    layer.glowAnimation.setEnabled(false)
    expect(n.emissiveIntensity).toBe(still.emissiveIntensity)
    layer.dispose()
  })

  it('has nothing to animate in a GLB without the animation extras', async () => {
    const layer = await loadLayerModel(glbOf([sign, freeSign, screen, neon]), null)
    expect(layer.glowAnimation.size).toBe(0)
    layer.dispose()
  })
})

describe('the stencil decal', () => {
  it('a tinted standard material whose alphaMap is the texture, with no map, translucent, depth-offset', () => {
    const texture = new THREE.Texture()
    const m = decalStencilMaterial(texture, new Map())
    expect(m).toBeInstanceOf(THREE.MeshStandardMaterial)
    expect(m.alphaMap).toBe(texture)
    expect(m.map).toBeNull()
    expect(m.transparent).toBe(true)
    expect(m.depthWrite).toBe(false)
    expect(m.color.getHex()).toBe(DECAL_TINT)
    expect(m.polygonOffset).toBe(true)
    expect(m.polygonOffsetFactor).toBe(-1)
    expect(m.polygonOffsetUnits).toBe(-1)
    expect(m.roughness).toBe(0.8)
    expect(m.metalness).toBe(0)
    expect(m.side).toBe(THREE.DoubleSide)
  })

  it('two surfaces sharing the texture share one material', () => {
    const texture = new THREE.Texture()
    const cache = new Map<string, THREE.MeshStandardMaterial>()
    expect(decalStencilMaterial(texture, cache)).toBe(decalStencilMaterial(texture, cache))
  })

  it('applies the linear color and shares by texture, color and opacity', () => {
    const texture = new THREE.Texture()
    const cache = new Map<string, THREE.MeshStandardMaterial>()
    const pochoir = { couleur: [0.2, 0.4, 0.8] as [number, number, number], opacite: 0.6 }
    const m = decalStencilMaterial(texture, cache, pochoir)
    expect(m.color.toArray()).toEqual(pochoir.couleur)
    expect(m.opacity).toBe(0.6)
    expect(decalStencilMaterial(texture, cache, pochoir)).toBe(m)
    expect(decalStencilMaterial(texture, cache, { ...pochoir, opacite: 1 })).not.toBe(m)
    expect(decalStencilMaterial(texture, cache, { ...pochoir, couleur: [1, 1, 1] })).not.toBe(m)
    expect(decalStencilMaterial(texture, cache)).not.toBe(m)
  })
  it('a decal with no texture and a foreign shader both keep the family material', async () => {
    const layer = await loadLayerModel(tinyGlb(), null)
    const plain = meshUnder(layer.root, 'structure_plain')
    const decal = meshUnder(layer.root, 'decal_pochoir')
    const autre = meshUnder(layer.root, 'structure_autre')
    // Neither the decal with no base texture nor the foreign shader switch to the decal material:
    // they share the structure's family material, with no mask map.
    expect(decal.material).toBe(plain.material)
    expect(autre.material).toBe(plain.material)
    const m = plain.material as THREE.MeshStandardMaterial
    expect(m.alphaMap).toBeNull()
    expect(m.map).toBeNull()
    layer.dispose()
  })
})
