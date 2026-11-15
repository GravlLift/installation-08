/**
 * layeredPlan3d.ts — LE PLAN DE LA FUSION DES MATÉRIAUX EN COUCHES DE LA CARTE (logique pure).
 *
 * La fusion (`layeredMerge3d`) range les cartes des matériaux en couches dans quelques tableaux de
 * textures, leurs constantes dans une texture de paramètres (une ligne par composition) et la ligne
 * de chaque sommet dans un attribut. Ce module décide, sans three ni GPU :
 * - quelle carte va dans quel tableau (même taille, mêmes réglages d'échantillonnage), dans les
 *   limites que tout contexte WebGL 2 garantit ; une composition qui n'y tient pas reste à part ;
 * - ce que contient la ligne d'une composition (`packRow`) ;
 * - quels sommets dédoubler : un sommet n'a qu'une ligne, celui que deux compositions se partagent
 *   est copié pour la seconde (`assignVertexRows`) ;
 * - l'index d'un maillage fusionné (`concatIndices`) et le jeu de coordonnées du masque d'une
 *   composition qui n'en a pas (`foldMaskSets`).
 */
import { LAYER_ROWS, MAX_LAYERS, packLayers, type LayerInfo } from './layeredMaterial'

/** Emplacements de cartes d'une composition : couleur 0..3, normale 0..3, contrôle 0..3, masque. */
export const SLOT_COUNT = 3 * MAX_LAYERS + 1
export const MASK_SLOT = 3 * MAX_LAYERS
export const colorSlot = (k: number) => k
export const normalSlot = (k: number) => MAX_LAYERS + k
export const controlSlot = (k: number) => 2 * MAX_LAYERS + k

/**
 * La ligne d'une composition dans la texture de paramètres, en texels RGBA :
 * - 0 .. HEAD_TEXEL-1 : les constantes des couches, rangées comme `uLayer` (cf. `packLayers`) ;
 * - HEAD_TEXEL : nombre de couches, a un masque, emplacement du masque (tableau, couche) ;
 * - GLOW_TEXEL : lumière propre (RVB linéaire, force comprise), 0 ;
 * - SLOT_TEXEL + 2k : emplacements couleur et normale de la couche k ; SLOT_TEXEL + 2k + 1 :
 *   emplacement du contrôle, 0, 0.
 * Un emplacement vaut (tableau, couche) ; une carte absente a le tableau -1.
 */
export const HEAD_TEXEL = MAX_LAYERS * LAYER_ROWS
export const GLOW_TEXEL = HEAD_TEXEL + 1
export const SLOT_TEXEL = GLOW_TEXEL + 1
export const ROW_TEXELS = SLOT_TEXEL + 2 * MAX_LAYERS
const ABSENT = -1

export interface ArrayLimits {
  /** Couches par tableau. */
  maxLayers: number
  /** Tableaux par matériau (unités de texture laissées aux tableaux). */
  maxArrays: number
  /** Lignes de la texture de paramètres (sa hauteur). */
  maxRows: number
}

/**
 * Les minimums de tout contexte WebGL 2 : 256 couches par tableau, 16 unités de texture par shader de
 * fragment (moins le reflet, l'ombre du soleil, la lumière cuite et la texture de paramètres), 2048
 * texels de côté. Le plan qui les tient vaut sur toute machine, sans interroger le contexte.
 */
export const WEBGL2_LIMITS: ArrayLimits = { maxLayers: 256, maxArrays: 16 - 4, maxRows: 2048 }
/**
 * The limits of a model whose merged surfaces are drawn as batches (layerBatch3d, the variant layer):
 * a batched draw reads its instance matrices and draw ids from two more textures, so two arrays fewer.
 */
export const BATCHED_LIMITS: ArrayLimits = { ...WEBGL2_LIMITS, maxArrays: WEBGL2_LIMITS.maxArrays - 2 }

/** Ce qui range une carte : sa taille, et ses réglages (espace de couleur, filtres, répétition...). */
export interface TextureFacts {
  width: number
  height: number
  settings: string
}

export interface PlannedArray<T> {
  width: number
  height: number
  settings: string
  /** Les cartes du tableau, dans l'ordre de ses couches. */
  members: T[]
}

export interface LayeredPlan<T> {
  arrays: PlannedArray<T>[]
  /** L'emplacement (tableau, couche) de chaque carte retenue. */
  slotOf: Map<T, readonly [number, number]>
  /** Les rangs (dans l'entrée) des compositions retenues : la ligne i de la texture est `accepted[i]`. */
  accepted: number[]
  /** Les rangs des compositions laissées à leur matériau propre. */
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

/** usedArrays : les tableaux les plus utilisés (en compositions) qui tiennent dans `max`, leurs cartes. */
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
 * planArrays range les cartes des compositions `rows` (SLOT_COUNT emplacements chacune, null pour
 * une carte absente) en tableaux. Une composition est refusée si une de ses cartes est illisible
 * (`facts` rend null), si son tableau ne tient plus dans `maxArrays` (les tableaux les moins utilisés
 * sont écartés), ou au-delà de `maxRows` compositions.
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
  // Une passe suffit : les tableaux recomposés sur les cartes retenues ne sont jamais plus nombreux.
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
 * packRow : la ligne d'une composition (ROW_TEXELS texels RGBA, cf. HEAD_TEXEL). Ses constantes de
 * couches sont celles que `packLayers` donnerait à `uLayer` pour le même matériau ; `slots` porte
 * l'emplacement de chaque carte (SLOT_COUNT, null absente) ; `glow` la lumière propre.
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
  /** La ligne de chaque sommet (les `vertexCount` d'origine, puis les copies). */
  rows: Uint16Array
  /** Pour chaque copie, le sommet d'origine qu'elle reprend. */
  sources: Uint32Array
  /** L'index de chaque membre, null s'il ne change pas (aucune copie à lui). */
  indices: (Uint32Array | null)[]
  duplicated: number
}

/**
 * assignVertexRows donne une ligne à chaque sommet d'un tampon partagé par `members` (leur index et
 * la ligne de leur composition). Le premier membre qui lit un sommet le garde ; un membre d'une autre
 * ligne lit une copie du sommet, une par (sommet, ligne), partagée par les membres de cette ligne.
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

/** concatIndices met bout à bout les index de `parts`, en 16 bits si les `vertexCount` sommets y tiennent. */
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

/** Les jeux de coordonnées d'une composition : celui des couches, celui du masque (null sans masque). */
export interface UvSets {
  layer: number
  mask: number | null
}

/**
 * foldMaskSets : pour chaque jeu de couches, le jeu de masque le plus fréquent parmi `sets` (le plus
 * petit à égalité). Une composition sans masque ne lit pas son jeu de masque : elle peut prendre
 * celui-là et partager le matériau fusionné de ses voisines.
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
