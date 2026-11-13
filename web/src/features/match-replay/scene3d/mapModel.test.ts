/**
 * mapModel.test.ts — la vitre teintée du jeu (matériau `vitre` en couches sombres) se dessine
 * sombre à l'opacité de la vitre teintée, la vitre claire sans couches garde le verre clair
 * partagé, et deux vitres de même teinte partagent un matériau.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import type { LayeredInfo } from './layeredMaterial'
import { DECAL_TINT, decalStencilMaterial, loadLayerModel, teinteVerreTeint } from './mapModel'

/** Un carré horizontal de 2 u de côté à la hauteur three `y = 1`. */
const SQUARE = [-1, 1, -1, 1, 1, -1, 1, 1, 1, -1, 1, 1]
const INDICES = [0, 2, 1, 0, 3, 2]

/** La description en couches d'une vitre sombre (RVB linéaire), comme dans le GLB de la carte. */
const COUCHES_SOMBRE: LayeredInfo = {
  couches: [
    { sorte: 'degrade', bas: [0.127, 0.127, 0.127], milieu: [0.095, 0.095, 0.095], haut: [0.091, 0.091, 0.091], opacite: 1 },
  ],
  masque: -1,
  jeuMasque: 0,
  jeuCouches: 0,
}

/** La teinte attendue : la moyenne de `bas`, `milieu` et `haut` de la première couche. */
const TEINTE_ATTENDUE = (0.127 + 0.095 + 0.091) / 3

/**
 * tinyGlb : un GLB réduit à un carré par nœud parent : deux vitres sombres (mêmes couches), une
 * vitre claire (sans couches), et trois surfaces de structure pour tester la pose du décalque
 * pochoir — un décalque au shader du jeu sans texture, un shader étranger, et une structure de
 * référence.
 */
function tinyGlb(): ArrayBuffer {
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
      { name: 'mat_sombre_a', extras: { vitre: true, couches: COUCHES_SOMBRE } },
      { name: 'mat_sombre_b', extras: { vitre: true, couches: COUCHES_SOMBRE } },
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

function meshUnder(root: THREE.Object3D, node: string): THREE.Mesh {
  const found = root.getObjectByName(node)?.children[0]
  if (!(found instanceof THREE.Mesh)) throw new Error(`pas de maillage sous ${node}`)
  return found
}

describe('teinteVerreTeint', () => {
  it('moyenne les couleurs de la première couche (bas, milieu, haut)', () => {
    const teinte = teinteVerreTeint(COUCHES_SOMBRE)
    expect(teinte).toEqual([TEINTE_ATTENDUE, TEINTE_ATTENDUE, TEINTE_ATTENDUE])
  })

  it('n\'inclut que les couleurs présentes', () => {
    const info: LayeredInfo = { couches: [{ sorte: 'couleur', bas: [0.1, 0.2, 0.3], opacite: 1 }], masque: -1, jeuMasque: 0, jeuCouches: 0 }
    expect(teinteVerreTeint(info)).toEqual([0.1, 0.2, 0.3])
  })

  it('renvoie null sans couche ni couleur', () => {
    expect(teinteVerreTeint({ couches: [], masque: -1, jeuMasque: 0, jeuCouches: 0 })).toBeNull()
    expect(teinteVerreTeint({ couches: [{ sorte: 'couleur' }], masque: -1, jeuMasque: 0, jeuCouches: 0 })).toBeNull()
  })
})

describe('la vitre teintée', () => {
  it('une vitre en couches sombres porte un matériau teinté, pas le verre clair partagé', async () => {
    const layer = await loadLayerModel(tinyGlb(), null)
    const sombre = meshUnder(layer.root, 'vitre_sombre_a')
    const claire = meshUnder(layer.root, 'vitres')
    const m = sombre.material as THREE.MeshBasicMaterial
    expect(m).not.toBe(claire.material)
    expect(m).toBeInstanceOf(THREE.MeshBasicMaterial)
    expect(m.blending).toBe(THREE.MultiplyBlending)
    expect(m.color.r).toBeCloseTo(TEINTE_ATTENDUE)
    expect(m.color.g).toBeCloseTo(TEINTE_ATTENDUE)
    expect(m.color.b).toBeCloseTo(TEINTE_ATTENDUE)
    // Elle multiplie ce qui est derrière elle : translucide, sans écriture de profondeur, double face.
    expect(m.transparent).toBe(true)
    expect(m.depthWrite).toBe(false)
    expect(m.side).toBe(THREE.DoubleSide)
    // Le verre clair sans couches garde son opacité de famille.
    expect((claire.material as THREE.MeshStandardMaterial).opacity).toBe(0.18)
    layer.dispose()
  })

  it('deux vitres sombres de même teinte partagent un matériau', async () => {
    const layer = await loadLayerModel(tinyGlb(), null)
    const a = meshUnder(layer.root, 'vitre_sombre_a')
    const b = meshUnder(layer.root, 'vitre_sombre_b')
    expect(a.material).toBe(b.material)
    layer.dispose()
  })
})

describe('le décalque pochoir', () => {
  it('un standard teinté dont alphaMap est la texture, sans map, translucide, en retrait de profondeur', () => {
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

  it('deux surfaces qui partagent la texture partagent un matériau', () => {
    const texture = new THREE.Texture()
    const cache = new Map<string, THREE.MeshStandardMaterial>()
    expect(decalStencilMaterial(texture, cache)).toBe(decalStencilMaterial(texture, cache))
  })

  it('applique la couleur linéaire et partage par texture, couleur et opacité', () => {
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
  it('un décalque sans texture et un shader étranger gardent le matériau de famille', async () => {
    const layer = await loadLayerModel(tinyGlb(), null)
    const plain = meshUnder(layer.root, 'structure_plain')
    const decal = meshUnder(layer.root, 'decal_pochoir')
    const autre = meshUnder(layer.root, 'structure_autre')
    // Ni le décalque sans texture de base ni le shader étranger ne passent au matériau de décalque :
    // ils partagent le matériau de famille de la structure, sans carte de masque.
    expect(decal.material).toBe(plain.material)
    expect(autre.material).toBe(plain.material)
    const m = plain.material as THREE.MeshStandardMaterial
    expect(m.alphaMap).toBeNull()
    expect(m.map).toBeNull()
    layer.dispose()
  })
})
