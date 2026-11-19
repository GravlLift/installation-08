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
 * A surface split between probes (`probeParts`) that no merged mesh draws is drawn the same way,
 * one mesh per part (`drawParts`), so every surface reflects its nearest probes.
 */
import * as THREE from 'three'

import { isMergedMaterial } from './layeredArrays3d'
import type { LayeredMerge } from './layeredMerge3d'
import { concatIndices } from './layeredPlan3d'
import { probeParts, type ProbePart } from './probes3d'
import { clearDrawnBy, markDrawnBy } from './surfaceProbe3d'

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

/** A share of a surface drawn by a merged mesh: the whole surface, or one probe's part of it (`probeParts`). */
interface Drawn {
  mesh: THREE.Mesh
  material: THREE.Material
  index: ArrayLike<number>
  /** The surface is split between probes: every part is drawn by a merged mesh, even alone in its group. */
  split: boolean
}

function groupKey(mesh: THREE.Mesh, material: THREE.Material, idOf: (o: object) => number): string | null {
  const g = mesh.geometry
  const parts: number[] = [idOf(mesh.parent as object), idOf(material)]
  for (const name of DRAWN_ATTRIBUTES) {
    const a = g.getAttribute(name)
    if (!a) return null
    parts.push(idOf(a))
  }
  return `${parts.join(',')}|${mesh.castShadow}|${mesh.receiveShadow}|${mesh.matrix.elements.join(',')}`
}

/** drawOnce places under their node the mesh that draws `group` (same buffer, same material) and hides its members. */
function drawOnce(group: readonly Drawn[], tighten: (g: THREE.BufferGeometry) => void, hidden: Set<THREE.Mesh>): THREE.Mesh {
  const first = group[0].mesh
  const geometry = new THREE.BufferGeometry()
  for (const name of DRAWN_ATTRIBUTES) geometry.setAttribute(name, first.geometry.getAttribute(name))
  const parts = group.map((d) => d.index)
  geometry.setIndex(new THREE.BufferAttribute(concatIndices(parts, first.geometry.getAttribute('position').count), 1))
  tighten(geometry)
  const mesh = new THREE.Mesh(geometry, group[0].material)
  mesh.name = 'merged-map'
  mesh.position.copy(first.position)
  mesh.quaternion.copy(first.quaternion)
  mesh.scale.copy(first.scale)
  mesh.castShadow = first.castShadow
  mesh.receiveShadow = first.receiveShadow
  mesh.raycast = () => {}
  first.parent?.add(mesh)
  for (const { mesh: m } of group) {
    markDrawnBy(m, mesh)
    if (hidden.has(m)) continue
    hidden.add(m)
    m.visible = false
    releaseGpuIndex(m.geometry)
  }
  return mesh
}

/**
 * drawParts draws a split surface that no merged mesh draws (its material is not merged, or it
 * cannot be grouped): one mesh per probe part, on the surface's own vertices, under its node.
 * The surface is hidden like a batched one. Returns the placed meshes.
 */
function drawParts(surface: THREE.Mesh, parts: readonly ProbePart[], tighten: (g: THREE.BufferGeometry) => void, hidden: Set<THREE.Mesh>): THREE.Mesh[] {
  const placed = parts.map((p) => {
    const geometry = new THREE.BufferGeometry()
    for (const [name, a] of Object.entries(surface.geometry.attributes)) geometry.setAttribute(name, a)
    geometry.setIndex(new THREE.BufferAttribute(p.index, 1))
    tighten(geometry)
    const mesh = new THREE.Mesh(geometry, p.material)
    // The surface's name: the knobs that find surfaces by name (back faces) find its parts.
    mesh.name = surface.name
    mesh.position.copy(surface.position)
    mesh.quaternion.copy(surface.quaternion)
    mesh.scale.copy(surface.scale)
    mesh.castShadow = surface.castShadow
    mesh.receiveShadow = surface.receiveShadow
    mesh.renderOrder = surface.renderOrder
    mesh.raycast = () => {}
    surface.parent?.add(mesh)
    return mesh
  })
  hidden.add(surface)
  surface.visible = false
  for (const mesh of placed) markDrawnBy(surface, mesh)
  releaseGpuIndex(surface.geometry)
  return placed
}

/**
 * batchLayered groups the surfaces of `meshes` that have a merged material (see header), draws
 * each other surface split between probes one mesh per part (`drawParts`), writes the line to
 * the console (the merge's, when the map has one), and returns the release of the placed meshes
 * (their index only: the vertices belong to the surfaces). `tighten` bounds a mesh to the
 * vertices its index reads.
 */
export function batchLayered(merge: LayeredMerge | null, meshes: readonly THREE.Mesh[], tighten: (g: THREE.BufferGeometry) => void): () => void {
  const start = performance.now()
  const ids = new Map<object, number>()
  const idOf = (o: object) => ids.get(o) ?? (ids.set(o, ids.size), ids.size - 1)
  const groups = new Map<string, Drawn[]>()
  const apart: THREE.Mesh[] = []
  let alone = 0
  for (const mesh of meshes) {
    if (!mesh.visible || !mesh.geometry.index) continue
    const parts = probeParts.get(mesh)
    if (!isMergedMaterial(mesh.material)) {
      if (parts) apart.push(mesh)
      continue
    }
    const drawn: Drawn[] = parts
      ? parts.map((p) => ({ mesh, material: p.material, index: p.index, split: true }))
      : [{ mesh, material: mesh.material, index: mesh.geometry.index.array, split: false }]
    const keys = drawn.map((d) => groupKey(mesh, d.material, idOf))
    // A surface that cannot be grouped draws itself, split between its probes if it is.
    if (keys.includes(null)) {
      if (parts) apart.push(mesh)
      else alone++
      continue
    }
    drawn.forEach((d, i) => {
      const group = groups.get(keys[i] as string)
      if (group) group.push(d)
      else groups.set(keys[i] as string, [d])
    })
  }
  const batches: THREE.Mesh[] = []
  const hidden = new Set<THREE.Mesh>()
  for (const group of groups.values()) {
    if (group.length < 2 && !group[0].split) alone++
    else batches.push(drawOnce(group, tighten, hidden))
  }
  const merged = batches.length
  for (const mesh of apart) batches.push(...drawParts(mesh, probeParts.get(mesh)!, tighten, hidden))
  const split = `${apart.length} other surfaces split between probes in ${batches.length - merged} meshes`
  if (merge) {
    const s = merge.stats
    const upload = merge.atlas.uploadMs
    const probed = new Set([...groups.values()].map((g) => g[0].material)).size
    console.info(
      `3D replay: layers merge, materials ${s.materialsBefore} -> ${s.materialsAfter} (${probed} with probes), ` +
        `meshes ${s.meshes} -> ${merged + alone}, arrays ${s.arrays.join(' ')}, rows ${s.rows} (${s.rejected} left apart), ` +
        `duplicated vertices ${s.duplicated}, ${Math.round(s.ms + performance.now() - start)} ms, image transfer ` +
        (upload === null ? 'at first render' : `in ${Math.round(upload)} ms`) + `; ${split}`,
    )
  } else if (apart.length > 0) {
    console.info(`3D replay: ${split}`)
  }
  return () => {
    for (const mesh of batches) {
      mesh.removeFromParent()
      // The vertices are the surfaces' own: removed before `dispose` so their GPU copies stay.
      for (const name of Object.keys(mesh.geometry.attributes)) mesh.geometry.deleteAttribute(name)
      mesh.geometry.dispose()
    }
    // The surfaces draw themselves again, so a new capture's probes can batch them anew.
    for (const m of hidden) {
      m.visible = true
      clearDrawnBy(m)
    }
  }
}
