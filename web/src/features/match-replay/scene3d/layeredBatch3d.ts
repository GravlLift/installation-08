// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * layeredBatch3d.ts — THE MAP'S MERGED SURFACES IN A HANDFUL OF DRAW CALLS.
 *
 * After the materials merge (`convertLayered`) and probe assignment (`Lighting`), surfaces of
 * the same node that share vertex buffers, material (probe included) and cast shadow differ
 * only by their index: `batchLayered` concatenates those indices end to end and places ONE
 * mesh per group. The original surfaces stay in the scene, hidden: they carry the raycast
 * index (ground, static bodies), the inspector's tag (`markDrawnBy`), and the shadows already
 * grouped (`shadowProxy3d`). The merged mesh answers no raycast. Its material is the surfaces'
 * own: the drawer's settings (reflections, game light, shadows) apply to it with nothing more.
 */
import * as THREE from 'three'

import { isMergedMaterial } from './layeredArrays3d'
import type { LayeredMerge } from './layeredMerge3d'
import { concatIndices } from './layeredPlan3d'
import { markDrawnBy } from './surfaceProbe3d'

// The attributes a merged material reads; the others stay with the original surfaces.
const DRAWN_ATTRIBUTES = ['position', 'cMacro', 'cUv', 'cRow'] as const

/**
 * releaseGpuIndex releases a hidden surface's GPU index copy, without touching the vertices it
 * shares with its merged mesh: three releases the geometry's index and attributes on
 * `dispose`, which are removed from it for the length of the call. The index stays in memory
 * for raycasts; if the surface were drawn again, three would re-upload it.
 */
function releaseGpuIndex(geometry: THREE.BufferGeometry): void {
  const attributes = { ...geometry.attributes }
  for (const name of Object.keys(attributes)) geometry.deleteAttribute(name)
  geometry.dispose()
  for (const [name, a] of Object.entries(attributes)) geometry.setAttribute(name, a)
}

function groupKey(mesh: THREE.Mesh, idOf: (o: object) => number): string | null {
  const g = mesh.geometry
  const parts: number[] = [idOf(mesh.parent as object), idOf(mesh.material as object)]
  for (const name of DRAWN_ATTRIBUTES) {
    const a = g.getAttribute(name)
    if (!a) return null
    parts.push(idOf(a))
  }
  return `${parts.join(',')}|${mesh.castShadow}|${mesh.receiveShadow}|${mesh.matrix.elements.join(',')}`
}

/** drawOnce places under their node the mesh that draws `group` (same buffer, same material) and hides its members. */
function drawOnce(group: readonly THREE.Mesh[], tighten: (g: THREE.BufferGeometry) => void): THREE.Mesh {
  const first = group[0]
  const geometry = new THREE.BufferGeometry()
  for (const name of DRAWN_ATTRIBUTES) geometry.setAttribute(name, first.geometry.getAttribute(name))
  const parts = group.map((m) => (m.geometry.index as THREE.BufferAttribute).array)
  geometry.setIndex(new THREE.BufferAttribute(concatIndices(parts, first.geometry.getAttribute('position').count), 1))
  tighten(geometry)
  const mesh = new THREE.Mesh(geometry, first.material)
  mesh.name = 'merged-map'
  mesh.position.copy(first.position)
  mesh.quaternion.copy(first.quaternion)
  mesh.scale.copy(first.scale)
  mesh.castShadow = first.castShadow
  mesh.receiveShadow = first.receiveShadow
  mesh.raycast = () => {}
  first.parent?.add(mesh)
  for (const m of group) {
    m.visible = false
    markDrawnBy(m, mesh)
    releaseGpuIndex(m.geometry)
  }
  return mesh
}

/**
 * batchLayered groups the surfaces of `meshes` that have a merged material (see header),
 * writes the merge's line to the console, and returns the release of the placed meshes (their
 * index only: the vertices belong to the surfaces). `tighten` bounds a mesh to the vertices
 * its index reads.
 */
export function batchLayered(merge: LayeredMerge, meshes: readonly THREE.Mesh[], tighten: (g: THREE.BufferGeometry) => void): () => void {
  const start = performance.now()
  const ids = new Map<object, number>()
  const idOf = (o: object) => ids.get(o) ?? (ids.set(o, ids.size), ids.size - 1)
  const groups = new Map<string, THREE.Mesh[]>()
  let alone = 0
  for (const mesh of meshes) {
    if (!mesh.visible || !mesh.geometry.index || !isMergedMaterial(mesh.material)) continue
    const key = groupKey(mesh, idOf)
    if (key === null) {
      alone++
      continue
    }
    const group = groups.get(key)
    if (group) group.push(mesh)
    else groups.set(key, [mesh])
  }
  const batches: THREE.Mesh[] = []
  for (const group of groups.values()) {
    if (group.length < 2) alone += group.length
    else batches.push(drawOnce(group, tighten))
  }
  const s = merge.stats
  const upload = merge.atlas.uploadMs
  const probed = new Set([...groups.values()].map((g) => g[0].material)).size
  console.info(
    `3D replay: layers merge, materials ${s.materialsBefore} -> ${s.materialsAfter} (${probed} with probes), ` +
      `meshes ${s.meshes} -> ${batches.length + alone}, arrays ${s.arrays.join(' ')}, rows ${s.rows} (${s.rejected} left apart), ` +
      `duplicated vertices ${s.duplicated}, ${Math.round(s.ms + performance.now() - start)} ms, image transfer ` +
      (upload === null ? 'at first render' : `in ${Math.round(upload)} ms`),
  )
  return () => {
    for (const mesh of batches) {
      mesh.removeFromParent()
      for (const name of DRAWN_ATTRIBUTES) mesh.geometry.deleteAttribute(name)
      mesh.geometry.dispose()
    }
  }
}
