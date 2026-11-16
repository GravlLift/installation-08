/**
 * layeredMerge3d.ts — LA FUSION DES MATÉRIAUX EN COUCHES DE LA CARTE, AU CHARGEMENT.
 *
 * Changer de matériau d'un appel de dessin à l'autre coûte plus, sur une carte, que les dessins
 * eux-mêmes : un millier de matériaux en couches, treize cartes et cent trente constantes chacun. La
 * fusion se fait en deux temps, sans changer le GLB :
 * 1. `convertLayered`, au chargement et avant tout rendu : les matériaux en couches opaques de la carte
 *    cèdent la place à quelques matériaux fusionnés (un par face dessinée et jeux de coordonnées) ;
 *    leurs cartes vont dans des tableaux de textures, leurs constantes dans une ligne d'une texture de
 *    paramètres, la ligne de chaque sommet dans l'attribut `cRow` (un sommet partagé par deux
 *    compositions est dédoublé). Chaque surface reste un maillage : les sondes se capturent et
 *    s'attribuent comme avant, une copie de matériau par sonde.
 * 2. `batchLayered` (layeredBatch3d), après l'attribution des sondes : les surfaces d'un même nœud et
 *    d'un même matériau (sonde comprise) se dessinent en un seul maillage.
 * Une composition que les limites de WebGL 2 ne laissent pas fusionner garde son matériau propre.
 */
import * as THREE from 'three'

import { IMAGE_LIBEREE, LayeredAtlas, mergedMaterial } from './layeredArrays3d'
import { layeredComposition, usesMaskSet, UV_NAMES, type LayeredComposition } from './layeredMaterial'
import {
  MASK_SLOT, ROW_TEXELS, WEBGL2_LIMITS, assignVertexRows, colorSlot, controlSlot, foldMaskSets, normalSlot, packRow, planArrays,
  type ArrayLimits, type Slot, type TextureFacts,
} from './layeredPlan3d'

/**
 * Interrupteur de comparaison de la fusion (lu par `loadMapModel` seul) : faux, la carte garde un
 * matériau par composition. Actif par défaut depuis le 2026-11-10 ; à retirer au 2026-12-10, une fois
 * la vue fusionnée jugée identique à l'autre sur Recharge (mêmes captures, appels de dessin comptés).
 */
export const MERGE_LAYERED = true

/** Les comptes de la fusion, pour la ligne du chargement. */
export interface MergeStats {
  /** Matériaux en couches remplacés, puis matériaux fusionnés posés. */
  materialsBefore: number
  materialsAfter: number
  /** Surfaces passées aux matériaux fusionnés. */
  meshes: number
  /** Compositions (lignes de la texture de paramètres), et compositions laissées à part. */
  rows: number
  rejected: number
  /** Tableaux bâtis : largeur x hauteur x couches. */
  arrays: string[]
  duplicated: number
  ms: number
}

export interface LayeredMerge {
  atlas: LayeredAtlas
  materials: THREE.MeshStandardMaterial[]
  stats: MergeStats
}

interface Row {
  composition: LayeredComposition
  slots: (THREE.Texture | null)[]
  glow: [number, number, number]
}

interface Member {
  mesh: THREE.Mesh
  classic: THREE.MeshStandardMaterial
  row: number
}

function slotsOf(c: LayeredComposition): (THREE.Texture | null)[] {
  const slots: (THREE.Texture | null)[] = []
  c.layers.forEach((_, k) => {
    slots[colorSlot(k)] = c.maps[k] ?? null
    slots[normalSlot(k)] = c.normals[k] ?? null
    slots[controlSlot(k)] = c.controls[k] ?? null
  })
  slots[MASK_SLOT] = c.mask
  return Array.from({ length: MASK_SLOT + 1 }, (_, i) => slots[i] ?? null)
}

/** collect : les surfaces à fusionner (matériau en couches opaque, indexées) et leurs compositions distinctes. */
function collect(meshes: readonly THREE.Mesh[]): { rows: Row[]; members: Member[] } {
  const rows: Row[] = []
  const bySignature = new Map<string, number>()
  const members: Member[] = []
  for (const mesh of meshes) {
    const classic = mesh.material
    if (Array.isArray(classic) || !(classic instanceof THREE.MeshStandardMaterial)) continue
    const composition = layeredComposition(classic)
    if (!composition || classic.transparent || classic.alphaTest > 0 || !mesh.geometry.index) continue
    const e = classic.emissive
    const glow: [number, number, number] = [e.r * classic.emissiveIntensity, e.g * classic.emissiveIntensity, e.b * classic.emissiveIntensity]
    const signature = `${glow.join(',')}|${JSON.stringify(composition.info)}`
    let row = bySignature.get(signature)
    if (row === undefined) {
      row = rows.length
      bySignature.set(signature, row)
      rows.push({ composition, slots: slotsOf(composition), glow })
    }
    members.push({ mesh, classic, row })
  }
  return { rows, members }
}

/**
 * textureFacts : la taille de l'image décodée et les réglages qui la rangent, null sans image lisible.
 * A compressed (KTX2) map has no decoded image: its size is its first level's, and it only shares
 * an array with maps of the same compressed format (in `format`) and level count (they are copied
 * as they are); one whose levels were already released is not readable.
 */
export function textureFacts(t: THREE.Texture): TextureFacts | null {
  const image = t.image as { width?: number; height?: number } | undefined
  if (!image?.width || !image.height) return null
  const compressed = (t as THREE.CompressedTexture).isCompressedTexture === true
  const levels = t.mipmaps?.length ?? 0
  if (compressed && levels === 0) return null
  const settings = [
    t.colorSpace, t.wrapS, t.wrapT, t.magFilter, t.minFilter, t.anisotropy, t.generateMipmaps, t.flipY, t.premultiplyAlpha,
    t.unpackAlignment, t.format, t.type, compressed ? `compressed${levels}` : 'decoded',
  ].join('|')
  return { width: image.width, height: image.height, settings }
}

/** extendAttribute : `attribute` suivi des copies des sommets `sources`. */
function extendAttribute(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, sources: Uint32Array): THREE.BufferAttribute {
  const { count, itemSize } = attribute
  const Ctor = (attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.array : attribute.array).constructor as new (n: number) => THREE.TypedArray
  const out = new THREE.BufferAttribute(new Ctor((count + sources.length) * itemSize), itemSize, attribute.normalized)
  // Un attribut à plat se recopie d'un bloc ; un attribut entrelacé, sommet par sommet.
  const first = attribute instanceof THREE.BufferAttribute ? count : 0
  if (first > 0) out.array.set((attribute as THREE.BufferAttribute).array)
  for (let v = first; v < count + sources.length; v++) {
    const from = v < count ? v : sources[v - count]
    for (let c = 0; c < itemSize; c++) out.setComponent(v, c, attribute.getComponent(from, c))
  }
  return out
}

/**
 * applyVertexRows pose `cRow` sur les surfaces fusionnées, par tampon de sommets partagé. Un tampon
 * qui reçoit des copies est remplacé, pour toutes les surfaces qui le lisent (`all`), par sa version
 * prolongée : les index d'origine restent valides. Rend le nombre de sommets copiés.
 */
function applyVertexRows(members: readonly Member[], rowOf: readonly number[], all: readonly THREE.Mesh[]): number {
  const byBuffer = new Map<THREE.BufferAttribute | THREE.InterleavedBufferAttribute, Member[]>()
  for (const m of members) {
    const position = m.mesh.geometry.getAttribute('position')
    const list = byBuffer.get(position) ?? []
    list.push(m)
    byBuffer.set(position, list)
  }
  let duplicated = 0
  for (const [position, list] of byBuffer) {
    const split = assignVertexRows(position.count, list.map((m) => ({ index: (m.mesh.geometry.index as THREE.BufferAttribute).array, row: rowOf[m.row] })))
    duplicated += split.duplicated
    if (split.duplicated > 0) {
      const extended = new Map<unknown, THREE.BufferAttribute>()
      for (const mesh of all) {
        const g = mesh.geometry
        if (g.getAttribute('position') !== position) continue
        for (const [name, a] of Object.entries(g.attributes)) {
          if (!extended.has(a)) extended.set(a, extendAttribute(a, split.sources))
          g.setAttribute(name, extended.get(a) as THREE.BufferAttribute)
        }
      }
    }
    const rows = new THREE.BufferAttribute(split.rows, 1)
    list.forEach((m, i) => {
      const index = split.indices[i]
      if (index) m.mesh.geometry.setIndex(new THREE.BufferAttribute(index, 1))
      m.mesh.geometry.setAttribute('cRow', rows)
    })
  }
  return duplicated
}

/**
 * assignMaterials pose sur chaque surface le matériau fusionné de sa face dessinée et de ses jeux de
 * coordonnées. Une composition sans masque prend le jeu de masque de ses voisines (même tampon, même
 * jeu de couches) quand sa géométrie le porte.
 */
function assignMaterials(members: readonly Member[], rows: readonly Row[], atlas: LayeredAtlas): THREE.MeshStandardMaterial[] {
  const fold = new Map<unknown, Map<number, number>>()
  const setsOf = (m: Member) => {
    const info = rows[m.row].composition.info
    return { layer: info.jeuCouches, mask: usesMaskSet(info) ? info.jeuMasque : null }
  }
  for (const m of members) {
    const position = m.mesh.geometry.getAttribute('position')
    if (fold.has(position)) continue
    fold.set(position, foldMaskSets(members.filter((o) => o.mesh.geometry.getAttribute('position') === position).map(setsOf)))
  }
  const materials = new Map<string, THREE.MeshStandardMaterial>()
  for (const m of members) {
    const g = m.mesh.geometry
    const { layer } = setsOf(m)
    let { mask } = setsOf(m)
    const folded = mask === null ? fold.get(g.getAttribute('position'))?.get(layer) : undefined
    const macro = folded === undefined ? undefined : g.getAttribute(UV_NAMES[folded] ?? '')
    if (folded !== undefined && macro) {
      g.setAttribute('cMacro', macro)
      mask = folded
    }
    const key = `${m.classic.side}|${layer}|${mask ?? '-'}`
    let material = materials.get(key)
    if (!material) materials.set(key, (material = mergedMaterial(m.classic, atlas)))
    m.mesh.material = material
  }
  return [...materials.values()]
}

/** texturesOf : les textures qu'un matériau tient (champs et cartes des couches). */
function texturesOf(m: THREE.Material): THREE.Texture[] {
  const layers = (m.userData.textures ?? []) as THREE.Texture[]
  return [...Object.values(m), ...layers].filter((v): v is THREE.Texture => v instanceof THREE.Texture)
}

/**
 * retire libère les matériaux en couches que plus aucune surface ne dessine (ils sortent de `owned`)
 * et leurs cartes que plus aucun matériau de `owned` ne tient. Rien n'a encore été envoyé au GPU.
 * Une carte libérée porte `IMAGE_LIBEREE` : l'upload du tableau (le dernier lecteur de son image)
 * ferme l'image, pas l'ici, car le premier rendu la lit encore.
 */
function retire(replaced: ReadonlySet<THREE.Material>, owned: THREE.Material[], all: readonly THREE.Mesh[]): number {
  const still = new Set(all.map((m) => m.material))
  const gone = [...replaced].filter((m) => !still.has(m))
  const goneSet = new Set<THREE.Material>(gone)
  const kept = new Set(owned.filter((m) => !goneSet.has(m)).flatMap(texturesOf))
  for (const t of new Set(gone.flatMap(texturesOf))) if (!kept.has(t)) {
    t.userData[IMAGE_LIBEREE] = true
    t.dispose()
  }
  for (const m of gone) m.dispose()
  const remaining = owned.filter((m) => !goneSet.has(m))
  owned.splice(0, owned.length, ...remaining)
  return gone.length
}

/**
 * convertLayered passe les surfaces `drawn` à matériau en couches opaque aux matériaux fusionnés
 * (cf. en-tête). `all` : toutes les surfaces du modèle (elles partagent des tampons de sommets avec
 * les fusionnées). Met à jour `owned` (matériaux remplacés retirés, fusionnés ajoutés). Rend null si
 * rien n'a pu fusionner.
 */
export function convertLayered(drawn: readonly THREE.Mesh[], all: readonly THREE.Mesh[], owned: THREE.Material[], limits: ArrayLimits = WEBGL2_LIMITS): LayeredMerge | null {
  const start = performance.now()
  const { rows, members } = collect(drawn)
  if (rows.length === 0) return null
  const plan = planArrays(rows.map((r) => r.slots), textureFacts, limits)
  if (plan.rejected.length > 0) {
    console.warn('rejeu 3D : compositions en couches hors des limites des tableaux, laissées à leur matériau', plan.rejected.length)
  }
  if (plan.accepted.length === 0) return null
  const rowOf: number[] = rows.map(() => -1)
  const data = new Float32Array(plan.accepted.length * ROW_TEXELS * 4)
  plan.accepted.forEach((r, i) => {
    rowOf[r] = i
    const slots: Slot[] = rows[r].slots.map((t) => (t ? (plan.slotOf.get(t) ?? null) : null))
    data.set(packRow(rows[r].composition.layers, slots, rows[r].glow), i * ROW_TEXELS * 4)
  })
  const atlas = new LayeredAtlas(plan.arrays, data, plan.accepted.length)
  const merged = members.filter((m) => rowOf[m.row] >= 0)
  const duplicated = applyVertexRows(merged, rowOf, all)
  const materials = assignMaterials(merged, rows, atlas)
  const replaced = retire(new Set(merged.map((m) => m.classic)), owned, all)
  owned.push(...materials)
  const stats: MergeStats = {
    materialsBefore: replaced,
    materialsAfter: materials.length,
    meshes: merged.length,
    rows: plan.accepted.length,
    rejected: plan.rejected.length,
    arrays: plan.arrays.map((a) => `${a.width}x${a.height}x${a.members.length}`),
    duplicated,
    ms: performance.now() - start,
  }
  return { atlas, materials, stats }
}
