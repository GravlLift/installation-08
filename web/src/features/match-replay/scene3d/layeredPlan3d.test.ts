import { describe, expect, it } from 'vitest'

import { LAYER_ROWS, packLayers, type LayerInfo } from './layeredMaterial'
import {
  GLOW_TEXEL, HEAD_TEXEL, MASK_SLOT, ROW_TEXELS, SLOT_COUNT, SLOT_TEXEL, assignVertexRows, colorSlot, concatIndices, controlSlot,
  foldMaskSets, normalSlot, packRow, planArrays, type Slot, type TextureFacts,
} from './layeredPlan3d'

const limits = { maxLayers: 256, maxArrays: 12, maxRows: 2048 }

/** Une composition dont les cartes sont `textures` aux premiers emplacements. */
const row = (...textures: string[]) => Array.from({ length: SLOT_COUNT }, (_, i) => textures[i] ?? null)

const facts = (table: Record<string, TextureFacts | null>) => (t: string) => table[t] ?? null
const srgb = (w: number, h = w): TextureFacts => ({ width: w, height: h, settings: 'srgb' })
const lin = (w: number, h = w): TextureFacts => ({ width: w, height: h, settings: 'lin' })

const texel = (data: Float32Array, i: number) => Array.from(data.slice(i * 4, i * 4 + 4))

describe('planArrays', () => {
  it('range les cartes par taille et par réglages, une couche par carte distincte', () => {
    const table = { a: srgb(512), b: srgb(512), c: lin(512), d: srgb(64) }
    const plan = planArrays([row('a', 'c'), row('b', 'a', 'd')], facts(table), limits)
    expect(plan.arrays.map((a) => [a.width, a.height, a.settings, a.members])).toEqual([
      [512, 512, 'srgb', ['a', 'b']],
      [512, 512, 'lin', ['c']],
      [64, 64, 'srgb', ['d']],
    ])
    expect([plan.slotOf.get('a'), plan.slotOf.get('b'), plan.slotOf.get('c'), plan.slotOf.get('d')]).toEqual([[0, 0], [0, 1], [1, 0], [2, 0]])
    expect([plan.accepted, plan.rejected]).toEqual([[0, 1], []])
  })

  it('coupe un groupe plus grand que le nombre de couches d’un tableau', () => {
    const table = { a: lin(8), b: lin(8), c: lin(8) }
    const plan = planArrays([row('a', 'b', 'c')], facts(table), { ...limits, maxLayers: 2 })
    expect(plan.arrays.map((a) => a.members)).toEqual([['a', 'b'], ['c']])
    expect(plan.slotOf.get('c')).toEqual([1, 0])
  })

  it('refuse une composition dont une carte est illisible', () => {
    const plan = planArrays([row('a'), row('a', 'x')], facts({ a: lin(4), x: null }), limits)
    expect([plan.accepted, plan.rejected]).toEqual([[0], [1]])
  })

  it('écarte les tableaux les moins utilisés au-delà des unités de texture', () => {
    const table = { a: lin(4), b: lin(8), c: lin(16) }
    const rows = [row('a'), row('a', 'b'), row('a'), row('c')]
    const plan = planArrays(rows, facts(table), { ...limits, maxArrays: 1 })
    expect(plan.arrays.map((a) => a.members)).toEqual([['a']])
    expect([plan.accepted, plan.rejected]).toEqual([[0, 2], [1, 3]])
  })

  it('ne garde pas plus de compositions que de lignes de la texture de paramètres', () => {
    const plan = planArrays([row('a'), row('b'), row('c')], facts({ a: lin(4), b: lin(4), c: lin(8) }), { ...limits, maxRows: 2 })
    expect([plan.accepted, plan.rejected]).toEqual([[0, 1], [2]])
    expect(plan.arrays.map((a) => a.members)).toEqual([['a', 'b']])
  })
})

describe('packRow', () => {
  const layers: LayerInfo[] = [
    { sorte: 'couleur', echelle: [2, 3], teinte: [0.25, 0.5, 1] },
    { sorte: 'degrade', opacite: 0.75, melangeNormale: 1, intensiteNormale: 2 },
  ]

  it('porte les constantes que uLayer aurait, la tête, la lumière propre et les emplacements', () => {
    const slots: Slot[] = Array.from({ length: SLOT_COUNT }, () => null)
    slots[colorSlot(0)] = [0, 3]
    slots[normalSlot(1)] = [1, 7]
    slots[controlSlot(0)] = [2, 1]
    slots[MASK_SLOT] = [1, 4]
    const data = packRow(layers, slots, [0.5, 0.25, 0])
    expect(data.length).toBe(ROW_TEXELS * 4)
    expect(data.slice(0, HEAD_TEXEL * 4)).toEqual(packLayers(layers, [false, true], [true, false]))
    expect(texel(data, HEAD_TEXEL)).toEqual([2, 1, 1, 4])
    expect(texel(data, GLOW_TEXEL)).toEqual([0.5, 0.25, 0, 0])
    expect(texel(data, SLOT_TEXEL)).toEqual([0, 3, -1, 0])
    expect(texel(data, SLOT_TEXEL + 1)).toEqual([2, 1, 0, 0])
    expect(texel(data, SLOT_TEXEL + 2)).toEqual([-1, 0, 1, 7])
    expect(texel(data, SLOT_TEXEL + 3)).toEqual([-1, 0, 0, 0])
    // Une couche absente : aucune carte.
    expect(texel(data, SLOT_TEXEL + 6)).toEqual([-1, 0, -1, 0])
  })

  it('n’a pas de masque sans carte de masque, et ne lit que quatre couches', () => {
    const five = Array.from({ length: 5 }, (): LayerInfo => ({ sorte: 'couleur' }))
    const data = packRow(five, Array.from({ length: SLOT_COUNT }, () => null), [0, 0, 0])
    expect(texel(data, HEAD_TEXEL)).toEqual([4, 0, -1, 0])
    expect(HEAD_TEXEL).toBe(4 * LAYER_ROWS)
  })
})

describe('assignVertexRows', () => {
  it('dédouble un sommet partagé par deux lignes, une copie par ligne', () => {
    // Sommets 0..4 ; le sommet 2 est lu par les lignes 7 et 9, le sommet 3 par 7, 9 et encore 9.
    const split = assignVertexRows(5, [
      { index: [0, 1, 2, 2, 3, 1], row: 7 },
      { index: [2, 3, 4], row: 9 },
      { index: [3, 4, 2], row: 9 },
    ])
    expect(split.duplicated).toBe(2)
    expect(Array.from(split.sources)).toEqual([2, 3])
    expect(Array.from(split.rows)).toEqual([7, 7, 7, 7, 9, 9, 9])
    expect(split.indices[0]).toBeNull()
    expect(Array.from(split.indices[1] as Uint32Array)).toEqual([5, 6, 4])
    expect(Array.from(split.indices[2] as Uint32Array)).toEqual([6, 4, 5])
  })

  it('ne copie rien quand deux membres de même ligne partagent un sommet', () => {
    const split = assignVertexRows(3, [{ index: [0, 1, 2], row: 1 }, { index: [2, 1, 0], row: 1 }])
    expect([split.duplicated, split.indices]).toEqual([0, [null, null]])
    expect(Array.from(split.rows)).toEqual([1, 1, 1])
  })
})

describe('concatIndices', () => {
  it('met les index bout à bout, en 16 bits tant que les sommets y tiennent', () => {
    const small = concatIndices([[0, 1, 2], [2, 3, 0]], 4)
    expect(small).toBeInstanceOf(Uint16Array)
    expect(Array.from(small)).toEqual([0, 1, 2, 2, 3, 0])
    expect(concatIndices([[70000, 1, 2]], 70001)).toBeInstanceOf(Uint32Array)
  })
})

describe('foldMaskSets', () => {
  it('donne à chaque jeu de couches le jeu de masque le plus fréquent', () => {
    const fold = foldMaskSets([
      { layer: 2, mask: 1 }, { layer: 2, mask: 0 }, { layer: 2, mask: 1 }, { layer: 2, mask: null }, { layer: 0, mask: null },
    ])
    expect([...fold]).toEqual([[2, 1]])
  })
})
