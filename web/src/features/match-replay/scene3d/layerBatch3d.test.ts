import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { BACK_FACE_NAME } from './backFaces3d'
import { batchLayer, compactGeometry, kindOf, LAYER_BATCH_NAME } from './layerBatch3d'
import { drawnBy } from './surfaceProbe3d'

/** A geometry reading `count` triangles out of a shared vertex buffer of 100 vertices, from `first`. */
function sharedGeometry(position: THREE.BufferAttribute, uv: THREE.BufferAttribute, first: number, count: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', position)
  g.setAttribute('uv', uv)
  g.setIndex(Array.from({ length: count * 3 }, (_, i) => first + i))
  return g
}

function buffers() {
  const position = new THREE.BufferAttribute(new Float32Array(Array.from({ length: 300 }, (_, i) => i)), 3)
  const uv = new THREE.BufferAttribute(new Float32Array(Array.from({ length: 200 }, (_, i) => i / 200)), 2)
  return { position, uv }
}

function place(root: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, name = 'structure'): THREE.Mesh {
  const node = new THREE.Group()
  node.name = name
  node.position.set(x, 0, 0)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  node.add(mesh)
  root.add(node)
  return mesh
}

describe('layerBatch3d', () => {
  it('compacts a surface to the vertices its index reads', () => {
    const { position, uv } = buffers()
    const g = sharedGeometry(position, uv, 30, 2) // vertices 30..35 of 100
    const c = compactGeometry(g, ['position', 'uv'])
    expect(c.getAttribute('position').count).toBe(6)
    expect(Array.from(c.index!.array)).toEqual([0, 1, 2, 3, 4, 5])
    expect(c.getAttribute('position').getX(0)).toBe(90)
    expect(c.getAttribute('uv').getX(5)).toBeCloseTo(70 / 200)
    expect(c.getAttribute('normal')).toBeUndefined()
  })

  it('tells batches from instanced meshes by the material', () => {
    expect(kindOf(new THREE.MeshStandardMaterial(), false)).toBe('batch')
    const classic = new THREE.MeshStandardMaterial()
    classic.userData.textures = [new THREE.Texture()]
    expect(kindOf(classic, false)).toBe('instance')
    expect(kindOf(classic, true)).toBe('batch')
  })

  it('draws placements of one material in one batch, hides them and keeps their rays', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      const root = new THREE.Group()
      const { position, uv } = buffers()
      const a = sharedGeometry(position, uv, 0, 4)
      const b = sharedGeometry(position, uv, 12, 2)
      const plain = new THREE.MeshStandardMaterial()
      const classic = new THREE.MeshStandardMaterial()
      classic.userData.textures = [new THREE.Texture()]
      const glass = new THREE.MeshStandardMaterial({ transparent: true })
      const placed = [place(root, a, plain, 0), place(root, a, plain, 10), place(root, b, plain, 20)]
      const leaves = [place(root, a, classic, 30), place(root, a, classic, 40)]
      const back = place(root, b, new THREE.MeshBasicMaterial({ side: THREE.BackSide }), 50)
      back.name = BACK_FACE_NAME
      const kept = place(root, a, glass, 60)
      const shadow = place(root, a, plain, 70, 'ombre')
      shadow.parent!.visible = false

      const result = batchLayer(root)
      expect(result.batched).toBe(6)
      const batches = result.meshes.filter((m) => (m as THREE.BatchedMesh).isBatchedMesh) as THREE.BatchedMesh[]
      const instanced = result.meshes.filter((m) => (m as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh[]
      expect(batches).toHaveLength(2) // the plain material, the back faces
      expect(instanced).toHaveLength(1)
      expect(instanced[0].count).toBe(2)
      expect(batches.map((m) => m.name).sort()).toEqual([BACK_FACE_NAME, LAYER_BATCH_NAME].sort())
      for (const m of [...placed, ...leaves, back]) {
        expect(m.visible).toBe(false)
        expect(drawnBy(m)).not.toBeNull()
      }
      expect(kept.visible).toBe(true)
      expect(drawnBy(kept)).toBeNull()
      expect(drawnBy(shadow)).toBeNull()
      // The batch places each surface where it was.
      const plainBatch = batches.find((m) => m.name === LAYER_BATCH_NAME)!
      const at = new THREE.Matrix4()
      plainBatch.getMatrixAt(2, at)
      expect(new THREE.Vector3().setFromMatrixPosition(at).x).toBe(20)
      expect(plainBatch.castShadow).toBe(true)
      instanced[0].getMatrixAt(1, at)
      expect(new THREE.Vector3().setFromMatrixPosition(at).x).toBe(40)
      // Rays still find the hidden surfaces, never the batches.
      root.updateMatrixWorld(true)
      const ray = new THREE.Raycaster(new THREE.Vector3(5, 5, -100), new THREE.Vector3(0, 0, 1))
      const hits = ray.intersectObjects(root.children, true).map((h) => h.object)
      expect(hits.every((o) => !result.meshes.includes(o as THREE.Mesh))).toBe(true)

      result.dispose()
      expect(result.meshes.every((m) => m.parent === null)).toBe(true)
    } finally {
      info.mockRestore()
    }
  })
})
