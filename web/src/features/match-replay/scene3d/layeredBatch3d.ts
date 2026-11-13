/**
 * layeredBatch3d.ts — LES SURFACES FUSIONNÉES DE LA CARTE EN QUELQUES APPELS DE DESSIN.
 *
 * Après la fusion des matériaux (`convertLayered`) et l'attribution des sondes (`Lighting`), les
 * surfaces d'un même nœud qui partagent tampons de sommets, matériau (sonde comprise) et ombre portée
 * ne diffèrent plus que par leur index : `batchLayered` met ces index bout à bout et pose UN maillage
 * par groupe. Les surfaces d'origine restent dans la scène, cachées : elles portent l'index de rayons
 * (sol, corps inertes), l'étiquette de l'inspecteur (`markDrawnBy`) et les ombres déjà regroupées
 * (`shadowProxy3d`). Le maillage fusionné ne répond à aucun rayon. Sa matière est celle des surfaces :
 * les réglages du tiroir (reflets, lumière du jeu, ombres) s'y appliquent sans rien de plus.
 */
import * as THREE from 'three'

import { isMergedMaterial } from './layeredArrays3d'
import type { LayeredMerge } from './layeredMerge3d'
import { concatIndices } from './layeredPlan3d'
import { markDrawnBy } from './surfaceProbe3d'

// Les attributs que lit un matériau fusionné ; les autres restent aux surfaces d'origine.
const DRAWN_ATTRIBUTES = ['position', 'cMacro', 'cUv', 'cRow'] as const

/**
 * releaseGpuIndex libère la copie GPU de l'index d'une surface cachée, sans toucher aux sommets
 * qu'elle partage avec son maillage fusionné : three libère, à `dispose`, l'index et les attributs de
 * la géométrie, qu'on lui retire le temps de l'appel. L'index reste en mémoire pour les rayons ; si la
 * surface se redessinait, three le renverrait.
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

/** drawOnce pose sous leur nœud le maillage qui dessine `group` (même tampon, même matériau) et cache ses membres. */
function drawOnce(group: readonly THREE.Mesh[], tighten: (g: THREE.BufferGeometry) => void): THREE.Mesh {
  const first = group[0]
  const geometry = new THREE.BufferGeometry()
  for (const name of DRAWN_ATTRIBUTES) geometry.setAttribute(name, first.geometry.getAttribute(name))
  const parts = group.map((m) => (m.geometry.index as THREE.BufferAttribute).array)
  geometry.setIndex(new THREE.BufferAttribute(concatIndices(parts, first.geometry.getAttribute('position').count), 1))
  tighten(geometry)
  const mesh = new THREE.Mesh(geometry, first.material)
  mesh.name = 'carte-fusion'
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
 * batchLayered regroupe les surfaces de `meshes` à matériau fusionné (cf. en-tête), écrit la ligne
 * de la fusion dans la console et rend la libération des maillages posés (leurs index seuls : les
 * sommets sont aux surfaces). `tighten` borne un maillage sur les sommets que son index lit.
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
    `rejeu 3D : fusion des couches, matériaux ${s.materialsBefore} -> ${s.materialsAfter} (${probed} avec les sondes), ` +
      `maillages ${s.meshes} -> ${batches.length + alone}, tableaux ${s.arrays.join(' ')}, lignes ${s.rows} (${s.rejected} à part), ` +
      `sommets dupliqués ${s.duplicated}, ${Math.round(s.ms + performance.now() - start)} ms, transfert des images ` +
      (upload === null ? 'au premier rendu' : `en ${Math.round(upload)} ms`),
  )
  return () => {
    for (const mesh of batches) {
      mesh.removeFromParent()
      for (const name of DRAWN_ATTRIBUTES) mesh.geometry.deleteAttribute(name)
      mesh.geometry.dispose()
    }
  }
}
