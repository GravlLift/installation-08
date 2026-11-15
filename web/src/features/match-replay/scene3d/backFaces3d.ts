/**
 * backFaces3d.ts — L'ENVERS DE LA STRUCTURE D'UN MODÈLE DE LA VUE (la carte, un calque posé sur elle).
 *
 * Les surfaces de structure se dessinent de face seulement : deux surfaces coplanaires dos à dos (un
 * panneau et l'envers d'une autre) ne se disputent pas les mêmes pixels. L'envers écarté laisserait
 * pourtant voir le ciel là où la carte laisse un jour (une dalle de plafond vue d'en dessous à travers
 * un treillis). `buildBackFaces` dessine l'envers de ces surfaces d'un seul matériau sombre, sans
 * éclairage, pris dans la brume, et repoussé en profondeur : il ne passe jamais devant une face
 * coplanaire, il ne fait que boucher les jours.
 *
 * Les surfaces qui lisent le même attribut de sommets sous la même transformation se dessinent en UN
 * maillage d'envers (leurs index mis bout à bout) : quelques appels de dessin pour tout le modèle. Un
 * maillage d'envers ne figure dans aucune liste du modèle : il ne répond à aucun rayon (sol, inspecteur),
 * ne porte ni ne reçoit d'ombre, ne porte pas d'étiquette de surface (corps inertes, inspecteur), n'a pas
 * de matériau standard (sondes, lumière cuite, fusion) et le contour d'équipe l'ignore (`noOutline`).
 */
import * as THREE from 'three'

import { concatIndices } from './layeredPlan3d'

/** L'envers d'un mur ou d'une dalle, vu seulement là où la carte laisse un jour (RVB linéaire, pas une couleur d'interface). */
export const BACK_FACE_TINT = 0x07090b

/** Le nom des maillages d'envers posés sous la racine du modèle. */
export const BACK_FACE_NAME = 'envers-structure'

// Le recul en profondeur de l'envers (pente et pas de profondeur) : positif, une face coplanaire passe devant.
const BACK_OFFSET_FACTOR = 1
const BACK_OFFSET_UNITS = 1

export interface BackFaces {
  /** Les maillages d'envers, déjà enfants de la racine donnée. */
  meshes: THREE.Mesh[]
  /** Le nombre de surfaces dont l'envers est dessiné. */
  covered: number
  /** Retire les maillages d'envers et libère leurs index et le matériau commun (pas les sommets, qui sont aux surfaces). */
  dispose(): void
}

/**
 * hasBack : une surface simple, visible, indexée, opaque, sans découpe et dessinée de face seulement.
 * Une découpe (treillis, grille) garde ses trous vue de dos ; une surface déjà dessinée des deux côtés
 * n'a pas d'envers à boucher.
 */
function hasBack(mesh: THREE.Mesh): boolean {
  if (!mesh.visible || mesh instanceof THREE.SkinnedMesh || mesh instanceof THREE.InstancedMesh) return false
  const m = mesh.material
  if (Array.isArray(m) || m.side !== THREE.FrontSide || m.transparent || m.alphaTest > 0) return false
  return mesh.geometry.index !== null && mesh.geometry.getAttribute('position') !== undefined
}

/** backFaceMaterial : le matériau commun de l'envers (sans éclairage, face arrière, reculé en profondeur). */
function backFaceMaterial(): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    side: THREE.BackSide, fog: true,
    polygonOffset: true, polygonOffsetFactor: BACK_OFFSET_FACTOR, polygonOffsetUnits: BACK_OFFSET_UNITS,
  })
  material.color.setHex(BACK_FACE_TINT, THREE.LinearSRGBColorSpace)
  return material
}

/**
 * backGeometry rend la géométrie d'envers d'un groupe : ses index mis bout à bout sur son attribut de
 * sommets. Des groupes qui lisent les mêmes index (un objet posé à plusieurs endroits : des surfaces
 * qui partagent leur géométrie, sous des transformations différentes) partagent la leur, bâtie une
 * fois et gardée dans `shared`.
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

/** backMesh pose sous `root` le maillage d'envers d'un groupe (même attribut de sommets, même transformation). */
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
 * buildBackFaces pose sous `root` l'envers des surfaces de `meshes` qui en ont un (`hasBack`), un
 * maillage par attribut de sommets et transformation (relative à `root`, qu'il suit). `tighten` borne
 * un maillage sur les sommets que son index lit.
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
        // Seul l'index est à ce maillage : libérer la géométrie entière libérerait les sommets partagés.
        geometry.deleteAttribute('position')
        geometry.dispose()
      }
      material.dispose()
    },
  }
}
