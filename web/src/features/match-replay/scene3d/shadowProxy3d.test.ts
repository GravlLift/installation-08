// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { buildShadowProxies } from './shadowProxy3d'

/** Deux surfaces sur un même tampon de sommets (un triangle chacune), plus une surface à découpe. */
function scene() {
  const position = new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0]), 3)
  const surface = (index: number[], material: THREE.Material) => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', position)
    geometry.setIndex(index)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true
    return mesh
  }
  const plain = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })
  const a = surface([0, 1, 2], plain)
  const b = surface([3, 4, 5], plain)
  const cutout = surface([0, 1, 2], new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, alphaTest: 0.5 }))
  const root = new THREE.Group()
  root.add(a, b, cutout)
  return { root, a, b, cutout, position }
}

describe('buildShadowProxies', () => {
  it("porte l'ombre des surfaces d'un même tampon par un seul maillage", () => {
    const { root, a, b, cutout, position } = scene()
    const proxies = buildShadowProxies(root, [a, b, cutout])
    expect(proxies.merged).toBe(2)
    expect(proxies.meshes).toHaveLength(1)
    const proxy = proxies.meshes[0]
    expect(proxy.castShadow).toBe(true)
    expect(proxy.parent).toBe(root)
    expect(proxy.geometry.getAttribute('position')).toBe(position)
    expect(Array.from(proxy.geometry.index!.array)).toEqual([0, 1, 2, 3, 4, 5])
    expect(a.castShadow).toBe(false)
    expect(b.castShadow).toBe(false)
    // La découpe garde son ombre propre : ses trous ne se lisent que dans son matériau.
    expect(cutout.castShadow).toBe(true)
  })

  it("n'est dessiné que dans la passe d'ombre et ne répond à aucun rayon", () => {
    const { root, a, b } = scene()
    const proxy = buildShadowProxies(root, [a, b]).meshes[0]
    const call = [null, null, null, null, null, null] as unknown as Parameters<THREE.Mesh['onBeforeRender']>
    proxy.onBeforeRender(...call)
    expect(proxy.geometry.drawRange.count).toBe(0)
    proxy.onAfterRender(...call)
    expect(proxy.geometry.drawRange.count).toBe(Infinity)
    const hits: THREE.Intersection[] = []
    proxy.raycast(new THREE.Raycaster(new THREE.Vector3(0.2, 0.2, 1), new THREE.Vector3(0, 0, -1)), hits)
    expect(hits).toHaveLength(0)
  })

  it('sépare les surfaces dont la face dessinée diffère et libère sans toucher aux sommets', () => {
    const { root, a, b, position } = scene()
    b.material = new THREE.MeshStandardMaterial({ side: THREE.FrontSide })
    const proxies = buildShadowProxies(root, [a, b])
    // Un groupe d'une seule surface ne gagne rien : elle garde son ombre.
    expect(proxies.meshes).toHaveLength(0)
    expect(a.castShadow).toBe(true)
    proxies.dispose()
    expect(a.geometry.getAttribute('position')).toBe(position)
  })
})
