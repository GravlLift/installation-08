// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * layeredPlan3d.ts — THE PLAN FOR MERGING THE MAP'S LAYERED MATERIALS (pure logic).
 *
 * The merge (`layeredMerge3d`) packs layered materials' maps into a handful of texture arrays,
 * their constants into a parameter texture (one row per composition), and each vertex's row into
 * an attribute. This module decides, without three.js or the GPU:
 * - which map goes into which array (same size, same sampling settings), within the limits any
 *   WebGL 2 context guarantees; a composition that doesn't fit stays separate;
 * - what a composition's row contains (`packRow`);
 * - which vertices to duplicate: a vertex has only one row, the one two compositions share is
 *   copied for the second (`assignVertexRows`);
 * - a merged mesh's index (`concatIndices`) and the UV set to use for a composition's mask when
 *   it has none (`foldMaskSets`).
 */
import { LAYER_ROWS, MAX_LAYERS, packLayers, type LayerInfo } from './layeredMaterial'

/** A composition's map slots: color 0..3, normal 0..3, control 0..3, mask. */
export const SLOT_COUNT = 3 * MAX_LAYERS + 1
export const MASK_SLOT = 3 * MAX_LAYERS
export const colorSlot = (k: number) => k
export const normalSlot = (k: number) => MAX_LAYERS + k
export const controlSlot = (k: number) => 2 * MAX_LAYERS + k

/**
 * A composition's row in the parameter texture, in RGBA texels:
 * - 0 .. HEAD_TEXEL-1: the layers' constants, packed like `uLayer` (cf. `packLayers`);
 * - HEAD_TEXEL: layer count, has a mask, mask slot (array, layer);
 * - GLOW_TEXEL: self-light (linear RGB, strength included), 0;
 * - SLOT_TEXEL + 2k: layer k's color and normal slots; SLOT_TEXEL + 2k + 1: its control slot,
 *   0, 0.
 * A slot's value is (array, layer); a missing map has array -1.
 */
export const HEAD_TEXEL = MAX_LAYERS * LAYER_ROWS
export const GLOW_TEXEL = HEAD_TEXEL + 1
export const SLOT_TEXEL = GLOW_TEXEL + 1
export const ROW_TEXELS = SLOT_TEXEL + 2 * MAX_LAYERS
const ABSENT = -1

export interface ArrayLimits {
  /** Layers per array. */
  maxLayers: number
  /** Arrays per material (texture units left for arrays). */
  maxArrays: number
  /** Rows of the parameter texture (its height). */
  maxRows: number
}

/**
 * The guaranteed minimums of any WebGL 2 context: 256 layers per array, 16 texture units per
 * fragment shader (minus the reflection, the sun's shadow, baked light, and the parameter
 * texture), 2048 texels per side. A plan that respects them holds on any machine, with no need
 * to query the context.
 */
export const WEBGL2_LIMITS: ArrayLimits = { maxLayers: 256, maxArrays: 16 - 4, maxRows: 2048 }
/**
 * The limits of a model whose merged surfaces are drawn as batches (layerBatch3d, the variant layer):
 * a batched draw reads its instance matrices and draw ids from two more textures, so two arrays fewer.
 */
export const BATCHED_LIMITS: ArrayLimits = { ...WEBGL2_LIMITS, maxArrays: WEBGL2_LIMITS.maxArrays - 2 }

/** What files a map under: its size, and its settings (color space, filters, wrap...). */
export interface TextureFacts {
  width: number
  height: number
  settings: string
}

export interface PlannedArray<T> {
  width: number
  height: number
  settings: string
  /** The array's maps, in the order of its layers. */
  members: T[]
}

export interface LayeredPlan<T> {
  arrays: PlannedArray<T>[]
  /** The (array, layer) slot of each accepted map. */
  slotOf: Map<T, readonly [number, number]>
  /** The ranks (in the input) of accepted compositions: texture row i is `accepted[i]`. */
  accepted: number[]
  /** The ranks of compositions left on their own material. */
  rejected: number[]
}

type Slots<T> = readonly (T | null)[]

function groupArrays<T>(rows: readonly Slots<T>[], kept: readonly number[], facts: (t: T) => TextureFacts, maxLayers: number): PlannedArray<T>[] {
  const groups = new Map<string, PlannedArray<T>>()
  const seen = new Set<T>()
  for (const i of kept) {
    for (const t of rows[i]) {
      if (t === null || seen.has(t)) continue
      seen.add(t)
      const f = facts(t)
      const key = `${f.width}x${f.height}|${f.settings}`
      let g = groups.get(key)
      if (!g) groups.set(key, (g = { width: f.width, height: f.height, settings: f.settings, members: [] }))
      g.members.push(t)
    }
  }
  const out: PlannedArray<T>[] = []
  for (const g of groups.values()) {
    for (let o = 0; o < g.members.length; o += maxLayers) out.push({ ...g, members: g.members.slice(o, o + maxLayers) })
  }
  return out
}

/** usedArrays: the most-used arrays (by composition count) that fit within `max`, their maps. */
function usedArrays<T>(arrays: readonly PlannedArray<T>[], rows: readonly Slots<T>[], kept: readonly number[], max: number): Set<T> {
  const arrayOf = new Map<T, number>()
  arrays.forEach((a, i) => a.members.forEach((t) => arrayOf.set(t, i)))
  const usage = arrays.map(() => 0)
  for (const i of kept) {
    for (const a of new Set(rows[i].filter((t): t is T => t !== null).map((t) => arrayOf.get(t) as number))) usage[a]++
  }
  const ranked = arrays.map((_, i) => i).sort((a, b) => usage[b] - usage[a] || a - b)
  return new Set(ranked.slice(0, max).flatMap((i) => arrays[i].members))
}

/**
 * planArrays packs the maps of compositions `rows` (SLOT_COUNT slots each, null for a missing
 * map) into arrays. A composition is rejected if one of its maps is unreadable (`facts` returns
 * null), if its array no longer fits within `maxArrays` (the least-used arrays are dropped), or
 * past `maxRows` compositions.
 */
export function planArrays<T>(rows: readonly Slots<T>[], facts: (t: T) => TextureFacts | null, limits: ArrayLimits): LayeredPlan<T> {
  const known = new Map<T, TextureFacts | null>()
  const factsOf = (t: T) => {
    if (!known.has(t)) known.set(t, facts(t))
    return known.get(t) ?? null
  }
  const readable = (t: T) => factsOf(t) as TextureFacts
  let kept = rows.map((_, i) => i).filter((i) => rows[i].every((t) => t === null || factsOf(t) !== null))
  let arrays = groupArrays(rows, kept, readable, limits.maxLayers)
  // One pass is enough: arrays recomposed on the kept maps are never more numerous.
  if (arrays.length > limits.maxArrays) {
    const allowed = usedArrays(arrays, rows, kept, limits.maxArrays)
    kept = kept.filter((i) => rows[i].every((t) => t === null || allowed.has(t)))
  }
  kept = kept.slice(0, limits.maxRows)
  arrays = groupArrays(rows, kept, readable, limits.maxLayers)
  const slotOf = new Map<T, readonly [number, number]>()
  arrays.forEach((a, i) => a.members.forEach((t, layer) => slotOf.set(t, [i, layer])))
  const accepted = new Set(kept)
  return { arrays, slotOf, accepted: kept, rejected: rows.map((_, i) => i).filter((i) => !accepted.has(i)) }
}

export type Slot = readonly [number, number] | null

const pair = (s: Slot | undefined) => (s ? [s[0], s[1]] : [ABSENT, 0])

/**
 * packRow: a composition's row (ROW_TEXELS RGBA texels, cf. HEAD_TEXEL). Its layer constants are
 * what `packLayers` would give `uLayer` for the same material; `slots` carries each map's slot
 * (SLOT_COUNT, null if missing); `glow` is the self-light.
 */
export function packRow(layers: readonly LayerInfo[], slots: readonly Slot[], glow: readonly [number, number, number]): Float32Array {
  const out = new Float32Array(ROW_TEXELS * 4)
  const read = layers.slice(0, MAX_LAYERS)
  const ks = read.map((_, k) => k)
  out.set(packLayers(read, ks.map((k) => !!slots[normalSlot(k)]), ks.map((k) => !!slots[controlSlot(k)])))
  const mask = slots[MASK_SLOT]
  out.set([read.length, mask ? 1 : 0, ...pair(mask)], HEAD_TEXEL * 4)
  out.set([...glow, 0], GLOW_TEXEL * 4)
  for (let k = 0; k < MAX_LAYERS; k++) {
    out.set([...pair(slots[colorSlot(k)]), ...pair(slots[normalSlot(k)])], (SLOT_TEXEL + 2 * k) * 4)
    out.set([...pair(slots[controlSlot(k)]), 0, 0], (SLOT_TEXEL + 2 * k + 1) * 4)
  }
  return out
}

export interface VertexRows {
  /** Each vertex's row (the original `vertexCount`, then the copies). */
  rows: Uint16Array
  /** For each copy, the original vertex it repeats. */
  sources: Uint32Array
  /** Each member's index, null if unchanged (no copy made for it). */
  indices: (Uint32Array | null)[]
  duplicated: number
}

/**
 * assignVertexRows gives a row to every vertex of a buffer shared by `members` (their index and
 * their composition's row). The first member to read a vertex keeps it; a member on another row
 * reads a copy of the vertex, one per (vertex, row), shared by the members on that row.
 */
export function assignVertexRows(vertexCount: number, members: readonly { index: ArrayLike<number>; row: number }[]): VertexRows {
  const owner = new Int32Array(vertexCount).fill(-1)
  const copies = new Map<number, number>()
  const sources: number[] = []
  const copyRows: number[] = []
  const indices = members.map(({ index, row }) => {
    let out: Uint32Array | null = null
    for (let j = 0; j < index.length; j++) {
      const v = index[j]
      if (owner[v] === -1) owner[v] = row
      if (owner[v] === row) continue
      const key = v * 65536 + row
      let copy = copies.get(key)
      if (copy === undefined) {
        copy = vertexCount + sources.length
        copies.set(key, copy)
        sources.push(v)
        copyRows.push(row)
      }
      out ??= Uint32Array.from(index)
      out[j] = copy
    }
    return out
  })
  const rows = new Uint16Array(vertexCount + sources.length)
  for (let v = 0; v < vertexCount; v++) rows[v] = Math.max(owner[v], 0)
  rows.set(copyRows, vertexCount)
  return { rows, sources: Uint32Array.from(sources), indices, duplicated: sources.length }
}

/** concatIndices concatenates the indices of `parts`, in 16 bits if the `vertexCount` vertices fit. */
export function concatIndices(parts: readonly ArrayLike<number>[], vertexCount: number): Uint16Array | Uint32Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = vertexCount <= 65536 ? new Uint16Array(total) : new Uint32Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** A composition's UV sets: the layers' set, the mask's set (null with no mask). */
export interface UvSets {
  layer: number
  mask: number | null
}

/**
 * foldMaskSets: for each layer set, the most frequent mask set among `sets` (the smallest on a
 * tie). A composition with no mask doesn't read its mask set: it can take this one and share its
 * neighbors' merged material.
 */
export function foldMaskSets(sets: readonly UvSets[]): Map<number, number> {
  const counts = new Map<number, Map<number, number>>()
  for (const { layer, mask } of sets) {
    if (mask === null) continue
    const c = counts.get(layer) ?? new Map<number, number>()
    c.set(mask, (c.get(mask) ?? 0) + 1)
    counts.set(layer, c)
  }
  const out = new Map<number, number>()
  for (const [layer, c] of counts) {
    const [best] = [...c].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
    out.set(layer, best)
  }
  return out
}
