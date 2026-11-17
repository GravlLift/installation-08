// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shadowProxy3d.ts — THE MAP'S CAST SHADOWS IN A HANDFUL OF DRAW CALLS.
 *
 * The shadow pass redraws every surface that casts a shadow: one call per surface, over a
 * thousand on a map. Yet these surfaces share their vertex buffer and carry no transform of
 * their own: their indexes, concatenated, make ONE mesh per buffer and per drawn face.
 * `buildShadowProxies` builds these meshes, hands them the cast shadow and takes it away from
 * the original surfaces, which keep drawing and receiving shadow as before.
 *
 * A shadow mesh exists only for the shadow pass: when the scene draws (and any pass that goes
 * through `onBeforeRender`: ambient occlusion normals, probes), its draw range is empty. It
 * responds to no ray cast.
 */
import * as THREE from 'three'

export interface ShadowProxies {
  /** The shadow meshes, already children of the given root. */
  meshes: THREE.Mesh[]
  /** The number of surfaces whose shadow is now carried by a shadow mesh. */
  merged: number
  /** Releases the shadow meshes' index and materials (not the vertices, which belong to the surfaces). */
  dispose(): void
}

/** mergeable: a plain, indexed, opaque, cutout-free surface that casts a shadow. */
function mergeable(mesh: THREE.Mesh): mesh is THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  if (!mesh.castShadow || !mesh.visible) return false
  if (mesh instanceof THREE.SkinnedMesh || mesh instanceof THREE.InstancedMesh) return false
  const material = mesh.material
  if (Array.isArray(material) || material.alphaTest > 0 || material.transparent) return false
  return mesh.geometry.index !== null && mesh.geometry.getAttribute('position') !== undefined
}

/** The face the shadow pass draws for a material (three.js's own rule with no `shadowSide`). */
function shadowSideOf(material: THREE.Material): THREE.Side {
  if (material.shadowSide !== null) return material.shadowSide
  return material.side === THREE.FrontSide ? THREE.BackSide : material.side === THREE.BackSide ? THREE.FrontSide : THREE.DoubleSide
}

/**
 * buildShadowProxies groups `meshes`'s shadow-casting surfaces by vertex buffer, world transform
 * and shadow face, and places one shadow mesh per group under `root`. Grouped surfaces lose
 * `castShadow`; the others (cutouts, translucent) keep it.
 */
export function buildShadowProxies(root: THREE.Object3D, meshes: readonly THREE.Mesh[]): ShadowProxies {
  root.updateMatrixWorld(true)
  const groups = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.Material>[]>()
  const ids = new Map<object, number>()
  const idOf = (o: object) => ids.get(o) ?? (ids.set(o, ids.size), ids.size - 1)
  for (const mesh of meshes) {
    if (!mergeable(mesh)) continue
    const position = mesh.geometry.getAttribute('position')
    const buffer = position instanceof THREE.InterleavedBufferAttribute ? position.data : position
    const key = `${idOf(buffer)}|${shadowSideOf(mesh.material)}|${mesh.matrixWorld.elements.map((v) => v.toFixed(5)).join(',')}`
    const group = groups.get(key)
    if (group) group.push(mesh)
    else groups.set(key, [mesh])
  }
  const toRoot = root.matrixWorld.clone().invert()
  const proxies: THREE.Mesh[] = []
  let merged = 0
  for (const group of groups.values()) {
    if (group.length < 2) continue
    let count = 0
    for (const mesh of group) count += (mesh.geometry.index as THREE.BufferAttribute).count
    const index = new Uint32Array(count)
    let offset = 0
    for (const mesh of group) {
      const source = mesh.geometry.index as THREE.BufferAttribute
      for (let i = 0; i < source.count; i++) index[offset + i] = source.getX(i)
      offset += source.count
      mesh.castShadow = false
    }
    merged += group.length
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', group[0].geometry.getAttribute('position'))
    geometry.setIndex(new THREE.BufferAttribute(index, 1))
    // `shadowSide` fixes the face drawn in the shadow pass: the same as the original surfaces'.
    const material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, shadowSide: shadowSideOf(group[0].material) })
    const proxy = new THREE.Mesh(geometry, material)
    proxy.name = 'map-shadow'
    proxy.castShadow = true
    proxy.frustumCulled = false
    proxy.matrixAutoUpdate = false
    proxy.matrix.multiplyMatrices(toRoot, group[0].matrixWorld)
    proxy.raycast = () => {}
    proxy.onBeforeRender = () => geometry.setDrawRange(0, 0)
    proxy.onAfterRender = () => geometry.setDrawRange(0, Infinity)
    root.add(proxy)
    proxies.push(proxy)
  }
  return {
    meshes: proxies,
    merged,
    dispose() {
      for (const proxy of proxies) {
        proxy.removeFromParent()
        // Only the index belongs to this mesh: releasing the whole geometry would release the shared vertices.
        proxy.geometry.deleteAttribute('position')
        proxy.geometry.dispose()
        ;(proxy.material as THREE.Material).dispose()
      }
    },
  }
}
