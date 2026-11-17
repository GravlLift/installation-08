// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * layeredMerge3d.ts — THE MAP'S LAYERED MATERIALS MERGE, AT LOAD TIME.
 *
 * Changing material from one draw call to the next costs more, on a map, than the draws
 * themselves: a thousand layered materials, thirteen maps and a hundred-thirty constants each.
 * The merge happens in two steps, without changing the GLB:
 * 1. `convertLayered`, at load time and before any render: the map's opaque layered materials
 *    give way to a handful of merged materials (one per drawn face and coordinate sets); their
 *    maps go into texture arrays, their constants into one row of a parameter texture, each
 *    vertex's row into the `cRow` attribute (a vertex shared by two compositions is
 *    duplicated). Each surface stays a mesh: probes capture and get assigned as before, one
 *    material copy per probe.
 * 2. `batchLayered` (layeredBatch3d), after probe assignment: surfaces of the same node and
 *    the same material (probe included) are drawn as a single mesh.
 * A composition that WebGL 2's limits do not allow to merge keeps its own material.
 */
import * as THREE from 'three'

import { IMAGE_LIBEREE, LayeredAtlas, mergedMaterial } from './layeredArrays3d'
import { layeredComposition, usesMaskSet, UV_NAMES, type LayeredComposition } from './layeredMaterial'
import {
  MASK_SLOT, ROW_TEXELS, WEBGL2_LIMITS, assignVertexRows, colorSlot, controlSlot, foldMaskSets, normalSlot, packRow, planArrays,
  type ArrayLimits, type Slot, type TextureFacts,
} from './layeredPlan3d'

/**
 * Comparison switch for the merge (read only by `loadMapModel`): false, the map keeps one
 * material per composition. On by default since 2026-11-10; remove by 2026-12-10, once the
 * merged view is judged identical to the other one on Recharge (same captures, draw calls
 * counted).
 */
export const MERGE_LAYERED = true

/** The merge's counts, for the load's log line. */
export interface MergeStats {
  /** Layered materials replaced, then merged materials placed. */
  materialsBefore: number
  materialsAfter: number
  /** Surfaces moved to merged materials. */
  meshes: number
  /** Compositions (parameter texture rows), and compositions left apart. */
  rows: number
  rejected: number
  /** Arrays built: width x height x layers. */
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

/** collect: the surfaces to merge (opaque layered material, indexed) and their distinct compositions. */
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
 * textureFacts: the decoded image's size and the settings that bucket it, null with no readable
 * image. A compressed (KTX2) map has no decoded image: its size is its first level's, and it only
 * shares an array with maps of the same compressed format (in `format`) and level count (they are
 * copied as they are); one whose levels were already released is not readable.
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

/** extendAttribute: `attribute` followed by copies of the `sources` vertices. */
function extendAttribute(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, sources: Uint32Array): THREE.BufferAttribute {
  const { count, itemSize } = attribute
  const Ctor = (attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.array : attribute.array).constructor as new (n: number) => THREE.TypedArray
  const out = new THREE.BufferAttribute(new Ctor((count + sources.length) * itemSize), itemSize, attribute.normalized)
  // A flat attribute is copied as one block; an interleaved one, vertex by vertex.
  const first = attribute instanceof THREE.BufferAttribute ? count : 0
  if (first > 0) out.array.set((attribute as THREE.BufferAttribute).array)
  for (let v = first; v < count + sources.length; v++) {
    const from = v < count ? v : sources[v - count]
    for (let c = 0; c < itemSize; c++) out.setComponent(v, c, attribute.getComponent(from, c))
  }
  return out
}

/**
 * applyVertexRows sets `cRow` on the merged surfaces, per shared vertex buffer. A buffer that
 * receives copies is replaced, for every surface that reads it (`all`), by its extended
 * version: the original indices stay valid. Returns the number of vertices copied.
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
 * assignMaterials sets on each surface the merged material for its drawn face and its
 * coordinate sets. A composition with no mask takes its neighbors' mask set (same buffer, same
 * layer set) when its geometry carries it.
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

/** texturesOf: the textures a material holds (fields and the layers' maps). */
function texturesOf(m: THREE.Material): THREE.Texture[] {
  const layers = (m.userData.textures ?? []) as THREE.Texture[]
  return [...Object.values(m), ...layers].filter((v): v is THREE.Texture => v instanceof THREE.Texture)
}

/**
 * retire releases the layered materials no surface draws anymore (they leave `owned`) and
 * their maps that no material in `owned` holds anymore. Nothing has been sent to the GPU yet.
 * A released map carries `IMAGE_LIBEREE`: the array's upload (the last reader of its image)
 * closes the image, not here, since the first render still reads it.
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
 * convertLayered moves `drawn` surfaces with an opaque layered material to merged materials
 * (see header). `all`: every surface of the model (they share vertex buffers with the merged
 * ones). Updates `owned` (replaced materials removed, merged ones added). Returns null if
 * nothing could be merged.
 */
export function convertLayered(drawn: readonly THREE.Mesh[], all: readonly THREE.Mesh[], owned: THREE.Material[], limits: ArrayLimits = WEBGL2_LIMITS): LayeredMerge | null {
  const start = performance.now()
  const { rows, members } = collect(drawn)
  if (rows.length === 0) return null
  const plan = planArrays(rows.map((r) => r.slots), textureFacts, limits)
  if (plan.rejected.length > 0) {
    console.warn('3D replay: layered compositions beyond the arrays\' limits, left to their own material', plan.rejected.length)
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
