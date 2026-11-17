// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * backFaces3d.ts — the BACK SIDE OF A VIEW MODEL'S STRUCTURE (the map, a layer placed on it).
 *
 * Structure surfaces are drawn front-facing only: two coplanar back-to-back surfaces (a panel and
 * another one's back face) don't fight for the same pixels. But dropping the back face would let
 * the sky show through wherever the map has a gap (a ceiling slab seen from below through a
 * lattice). `buildBackFaces` draws the back of these surfaces with a single dark material, unlit,
 * caught in fog, and pushed back in depth: it never draws in front of a coplanar face, it only
 * plugs the gaps.
 *
 * Surfaces that read the same vertex attribute under the same transform are drawn as ONE back
 * mesh (their indices concatenated): a handful of draw calls for the whole model. A back mesh
 * appears in no model list: it answers no ray (ground, inspector), casts or receives no shadow,
 * carries no surface label (ragdolls, inspector), has no standard material (probes, baked light,
 * fusion), and the team outline ignores it (`noOutline`).
 */
import * as THREE from 'three'

import { concatIndices } from './layeredPlan3d'

/** The back of a wall or slab, seen only where the map has a gap (linear RGB, not a UI color). */
export const BACK_FACE_TINT = 0x07090b

/** The name of the back meshes placed under the model's root. */
export const BACK_FACE_NAME = 'structure-back'

// The back face's depth bias (slope and depth step): positive, a coplanar face draws in front.
const BACK_OFFSET_FACTOR = 1
const BACK_OFFSET_UNITS = 1

export interface BackFaces {
  /** The back meshes, already children of the given root. */
  meshes: THREE.Mesh[]
  /** The number of surfaces whose back is drawn. */
  covered: number
  /** Removes the back meshes and frees their indices and the shared material (not the vertices, which belong to the surfaces). */
  dispose(): void
}

/**
 * hasBack: a simple surface, visible, indexed, opaque, uncut, and drawn front-facing only. A
 * cutout (lattice, grille) keeps its holes seen from behind; a surface already drawn on both
 * sides has no back to plug.
 */
function hasBack(mesh: THREE.Mesh): boolean {
  if (!mesh.visible || mesh instanceof THREE.SkinnedMesh || mesh instanceof THREE.InstancedMesh) return false
  const m = mesh.material
  if (Array.isArray(m) || m.side !== THREE.FrontSide || m.transparent || m.alphaTest > 0) return false
  return mesh.geometry.index !== null && mesh.geometry.getAttribute('position') !== undefined
}

/** backFaceMaterial: the shared back-face material (unlit, back-facing, pushed back in depth). */
function backFaceMaterial(): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    side: THREE.BackSide, fog: true,
    polygonOffset: true, polygonOffsetFactor: BACK_OFFSET_FACTOR, polygonOffsetUnits: BACK_OFFSET_UNITS,
  })
  material.color.setHex(BACK_FACE_TINT, THREE.LinearSRGBColorSpace)
  return material
}

/**
 * backGeometry builds a group's back geometry: its indices concatenated over its vertex
 * attribute. Groups that read the same indices (an object placed in several spots: surfaces
 * sharing their geometry under different transforms) share theirs, built once and kept in
 * `shared`.
 */
function backGeometry(group: readonly THREE.Mesh[], shared: Map<string, THREE.BufferGeometry>, idOf: (o: object) => number, tighten: (g: THREE.BufferGeometry) => void): THREE.BufferGeometry {
  const position = group[0].geometry.getAttribute('position')
  const indices = group.map((m) => m.geometry.index as THREE.BufferAttribute)
  const key = `${idOf(position)}|${indices.map(idOf).join(',')}`
  let geometry = shared.get(key)
  if (!geometry) {
    geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', position)
    geometry.setIndex(new THREE.BufferAttribute(concatIndices(indices.map((i) => i.array), position.count), 1))
    tighten(geometry)
    shared.set(key, geometry)
  }
  return geometry
}

/** backMesh places a group's back mesh under `root` (same vertex attribute, same transform). */
function backMesh(group: readonly THREE.Mesh[], geometry: THREE.BufferGeometry, material: THREE.Material, toRoot: THREE.Matrix4): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = BACK_FACE_NAME
  mesh.matrixAutoUpdate = false
  mesh.matrix.multiplyMatrices(toRoot, group[0].matrixWorld)
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.raycast = () => {}
  mesh.userData.noOutline = true
  return mesh
}

/**
 * buildBackFaces places under `root` the back of surfaces in `meshes` that have one (`hasBack`),
 * one mesh per vertex attribute and transform (relative to `root`, which it follows). `tighten`
 * bounds a mesh on the vertices its index reads.
 */
export function buildBackFaces(root: THREE.Object3D, meshes: readonly THREE.Mesh[], tighten: (g: THREE.BufferGeometry) => void): BackFaces {
  root.updateMatrixWorld(true)
  const ids = new Map<object, number>()
  const idOf = (o: object) => ids.get(o) ?? (ids.set(o, ids.size), ids.size - 1)
  const groups = new Map<string, THREE.Mesh[]>()
  let covered = 0
  for (const mesh of meshes) {
    if (!hasBack(mesh)) continue
    covered++
    const key = `${idOf(mesh.geometry.getAttribute('position'))}|${mesh.matrixWorld.elements.map((v) => v.toFixed(5)).join(',')}`
    const group = groups.get(key)
    if (group) group.push(mesh)
    else groups.set(key, [mesh])
  }
  const material = backFaceMaterial()
  const toRoot = root.matrixWorld.clone().invert()
  const shared = new Map<string, THREE.BufferGeometry>()
  const backs = [...groups.values()].map((group) => backMesh(group, backGeometry(group, shared, idOf, tighten), material, toRoot))
  for (const mesh of backs) root.add(mesh)
  return {
    meshes: backs,
    covered,
    dispose() {
      for (const mesh of backs) mesh.removeFromParent()
      for (const geometry of shared.values()) {
        // Only the index belongs to this mesh: disposing the whole geometry would free the shared vertices.
        geometry.deleteAttribute('position')
        geometry.dispose()
      }
      material.dispose()
    },
  }
}
