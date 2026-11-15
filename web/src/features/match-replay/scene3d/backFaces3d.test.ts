/**
 * backFaces3d.test.ts — l'envers de la structure : un maillage d'envers par attribut de sommets et
 * transformation, qui reprend les sommets et les index des surfaces, dessiné de dos, reculé en
 * profondeur, sans ombre, sans rayon ni étiquette, et libéré avec son matériau commun une seule fois.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { BACK_FACE_NAME, BACK_FACE_TINT, buildBackFaces } from './backFaces3d'
import { surfaceFamily } from './surfaceProbe3d'

/** Deux carrés horizontaux (y = 0 et y = 1) dans un même tampon de sommets. */
const POSITIONS = new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, -1, 1, -1, 1, 1, -1, 1, 1, 1, -1, 1, 1])

function surface(position: THREE.BufferAttribute, index: number[], material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', position)
  geometry.setIndex(index)
  return new THREE.Mesh(geometry, material)
}

function front(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ side: THREE.FrontSide })
}

function backsOf(root: THREE.Object3D): THREE.Mesh[] {
  return root.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.name === BACK_FACE_NAME)
}

const noTighten = () => {}

describe('buildBackFaces', () => {
  it('une surface de structure a son envers : mêmes sommets et index, de dos, reculé, sans ombre ni rayon', () => {
    const root = new THREE.Group()
    const node = new THREE.Group()
    node.position.set(3, 2, -1)
    root.add(node)
    const position = new THREE.BufferAttribute(POSITIONS, 3)
    const slab = surface(position, [4, 6, 5, 4, 7, 6], front())
    node.add(slab)
    const backs = buildBackFaces(root, [slab], noTighten)

    expect(backs.covered).toBe(1)
    expect(backsOf(root)).toEqual(backs.meshes)
    expect(backs.meshes).toHaveLength(1)
    const back = backs.meshes[0]
    expect(back.geometry.getAttribute('position')).toBe(position)
    expect(Array.from(back.geometry.index?.array ?? [])).toEqual([4, 6, 5, 4, 7, 6])
    const m = back.material as THREE.MeshBasicMaterial
    expect(m).toBeInstanceOf(THREE.MeshBasicMaterial)
    expect(m.side).toBe(THREE.BackSide)
    expect(m.polygonOffset).toBe(true)
    expect(m.polygonOffsetFactor).toBeGreaterThan(0)
    expect(m.polygonOffsetUnits).toBeGreaterThan(0)
    expect(m.fog).toBe(true)
    expect(m.color.getHex(THREE.LinearSRGBColorSpace)).toBe(BACK_FACE_TINT)
    expect(back.castShadow).toBe(false)
    expect(back.receiveShadow).toBe(false)
    // Les autres passes l'écartent : contour d'équipe, étiquette de surface (inspecteur, corps inertes), rayons.
    expect(back.userData.noOutline).toBe(true)
    expect(surfaceFamily(back)).toBeNull()
    root.updateMatrixWorld(true)
    expect(back.matrixWorld.equals(slab.matrixWorld)).toBe(true)
    const ray = new THREE.Raycaster(new THREE.Vector3(3.5, 5, -1.5), new THREE.Vector3(0, -1, 0))
    expect(ray.intersectObject(back)).toHaveLength(0)
    expect(ray.intersectObject(slab)).toHaveLength(1)
    backs.dispose()
  })

  it('les surfaces de même tampon et même transformation partagent un maillage, les autres en ont un à elles', () => {
    const root = new THREE.Group()
    const position = new THREE.BufferAttribute(POSITIONS, 3)
    const other = new THREE.BufferAttribute(POSITIONS.slice(), 3)
    const floor = surface(position, [0, 2, 1, 0, 3, 2], front())
    const ceiling = surface(position, [4, 6, 5, 4, 7, 6], front())
    const apart = surface(other, [0, 2, 1], front())
    root.add(floor, ceiling, apart)
    const backs = buildBackFaces(root, [floor, ceiling, apart], noTighten)

    expect(backs.covered).toBe(3)
    expect(backs.meshes).toHaveLength(2)
    const shared = backs.meshes.find((b) => b.geometry.getAttribute('position') === position)
    expect(Array.from(shared?.geometry.index?.array ?? [])).toEqual([0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6])
    expect(backs.meshes[0].material).toBe(backs.meshes[1].material)
    backs.dispose()
  })

  it('a geometry placed in several spots (shared by copies of a mesh) gets one back geometry, each copy its own transform', () => {
    const root = new THREE.Group()
    const position = new THREE.BufferAttribute(POSITIONS, 3)
    const slab = surface(position, [4, 6, 5, 4, 7, 6], front())
    const copy = slab.clone()
    copy.position.set(10, 0, 0)
    root.add(slab, copy)
    let tightened = 0
    const backs = buildBackFaces(root, [slab, copy], () => tightened++)

    expect(backs.covered).toBe(2)
    expect(backs.meshes).toHaveLength(2)
    expect(backs.meshes[0].geometry).toBe(backs.meshes[1].geometry)
    expect(tightened).toBe(1)
    root.updateMatrixWorld(true)
    expect(backs.meshes[1].matrixWorld.equals(copy.matrixWorld)).toBe(true)
    backs.dispose()
    expect(slab.geometry.getAttribute('position')).toBe(position)
  })

  it('sans envers : découpe, translucide, double face, cachée, sans index', () => {
    const root = new THREE.Group()
    const position = new THREE.BufferAttribute(POSITIONS, 3)
    const cutout = surface(position, [0, 2, 1], new THREE.MeshStandardMaterial({ alphaTest: 0.5 }))
    const glass = surface(position, [0, 2, 1], new THREE.MeshStandardMaterial({ transparent: true }))
    const both = surface(position, [0, 2, 1], new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }))
    const hidden = surface(position, [0, 2, 1], front())
    hidden.visible = false
    const loose = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', position), front())
    root.add(cutout, glass, both, hidden, loose)
    const backs = buildBackFaces(root, [cutout, glass, both, hidden, loose], noTighten)
    expect(backs.covered).toBe(0)
    expect(backs.meshes).toHaveLength(0)
    expect(backsOf(root)).toHaveLength(0)
    backs.dispose()
  })

  it('la libération retire les envers, libère leur matériau une fois et laisse les sommets aux surfaces', () => {
    const root = new THREE.Group()
    const position = new THREE.BufferAttribute(POSITIONS, 3)
    const other = new THREE.BufferAttribute(POSITIONS.slice(), 3)
    const a = surface(position, [0, 2, 1], front())
    const b = surface(other, [4, 6, 5], front())
    root.add(a, b)
    const backs = buildBackFaces(root, [a, b], noTighten)
    const material = backs.meshes[0].material as THREE.Material
    let released = 0
    material.addEventListener('dispose', () => released++)
    const geometries = backs.meshes.map((m) => m.geometry)
    backs.dispose()
    expect(backsOf(root)).toHaveLength(0)
    expect(released).toBe(1)
    for (const g of geometries) expect(g.getAttribute('position')).toBeUndefined()
    expect(a.geometry.getAttribute('position')).toBe(position)
  })
})
