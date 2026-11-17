// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CoatingFile, CoatingTable } from './armorCoating3d'
import { LAYER_BYTES } from './armorGradients3d'
import { ArmorLibrary, type ArmorLibraryIO } from './armorLibrary3d'
import { construirePeintureArme, reportArme } from './weaponCoat3d'

const SWATCH = {
  index: 0, gradient_scale: [1, 1] as [number, number], roughness: 4, roughness_white: 0.3, roughness_black: 0.5, metallic: 0.2, emissive: 0,
  top: [0.9, 0.9, 0.9] as [number, number, number], mid: [0.5, 0.5, 0.5] as [number, number, number], bot: [0.1, 0.1, 0.1] as [number, number, number],
  scratch_color: [0.3, 0.3, 0.3] as [number, number, number], scratch_roughness: 0.2, scratch_metallic: 1,
}

/** La table des revêtements de la bibliothèque des armes : la liste `b0799de3` a pour défaut `036e9dd8`, sans dégradé. */
function table(): CoatingTable {
  return {
    schema: 1, globals: {}, default_styles: { b0799de3: '036e9dd8' },
    styles: { '036e9dd8': { grime_amount: 0, scratch_amount: 0, regions: { '0b7e328b': { '229d91fa': SWATCH } } } },
    visors: { patterns: {}, colors: {} },
  }
}

/** Le revêtement `2c5251bc` : la liste `b0799de3` prend le style `f56eda13`, une zone à dégradé `c5e192fb`. */
function coatingFile(): CoatingFile {
  return {
    style: '2c5251bc', lists: { b0799de3: 'f56eda13' },
    styles: { f56eda13: { grime_amount: 0, scratch_amount: 0.5, regions: { '0b7e328b': { '229d91fa': { ...SWATCH, gradient: 'c5e192fb', top: [0.2, 0.3, 0.4] } } } } },
  }
}

/** Un matériau peint d'un modèle d'arme (masques bruts, style de la liste `b0799de3`). */
function paintedMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial()
  m.userData = {
    armorMaps: { asg: null, mask0: null, mask1: null },
    style: { stylelist: 'b0799de3', region: '0b7e328b', intentions: ['229d91fa'], layers: 1, texel_density: [1, 1], offset: [0, 0] },
  }
  return m
}

/** Un réseau factice : documents des revêtements, `fail` les fichiers en échec. */
function fakeIO(fail: Set<string> = new Set()) {
  const nameOf = (url: string) => url.slice(url.lastIndexOf('/') + 1)
  const documents: Record<string, () => unknown> = { 'coatings.json': table, 'coating-2c5251bc.json': coatingFile }
  const fetchJson = vi.fn(async (url: string) => {
    const name = nameOf(url)
    if (fail.has(name)) throw new Error('404')
    const doc = documents[name]
    if (!doc) throw new Error('404')
    return doc()
  })
  const loadSwatch = vi.fn(async (url: string) => {
    if (fail.has(nameOf(url))) throw new Error('404')
    return new Uint8Array(LAYER_BYTES)
  })
  return { io: { fetchJson, loadSwatch, loadGlb: vi.fn() } satisfies ArmorLibraryIO, fetchJson, loadSwatch }
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('construirePeintureArme', () => {
  it('styleKey null (no coating for this weapon): the default style of each list, no fallback named', async () => {
    const { io, fetchJson } = fakeIO()
    const m = paintedMaterial()
    const { coat, issues } = await construirePeintureArme([m], null, new ArmorLibrary('/armes', io))
    expect(issues).toEqual([])
    // The list's default style has no gradient: zone on, no layer (-1), its own top color.
    expect(Array.from(coat.get(m)!.paint.data.slice(0, 2))).toEqual([1, -1])
    expect(Array.from(coat.get(m)!.paint.data.slice(4, 7))).toEqual([expect.closeTo(0.9, 6), expect.closeTo(0.9, 6), expect.closeTo(0.9, 6)])
    // Only the table is read, never a coating file.
    expect(fetchJson.mock.calls.map(([url]) => String(url).slice(String(url).lastIndexOf('/') + 1))).toEqual(['coatings.json'])
  })

  it('peint les matériaux du revêtement de l’arme, dégradés chargés', async () => {
    const { io, loadSwatch } = fakeIO()
    const m = paintedMaterial()
    const { coat, issues } = await construirePeintureArme([m], '2c5251bc', new ArmorLibrary('/armes', io))
    expect(issues).toEqual([])
    expect(coat.size).toBe(1)
    const paint = coat.get(m)!
    // Zone de base : allumée, couche 0 (le seul dégradé chargé), couleur haute du revêtement.
    expect(Array.from(paint.paint.data.slice(0, 2))).toEqual([1, 0])
    expect(Array.from(paint.paint.data.slice(4, 7))).toEqual([expect.closeTo(0.2, 6), expect.closeTo(0.3, 6), expect.closeTo(0.4, 6)])
    expect(loadSwatch).toHaveBeenCalledTimes(1)
  })

  it('revêtement absent : le style par défaut de chaque liste, l’écart nommé', async () => {
    const { io } = fakeIO()
    const m = paintedMaterial()
    const { coat, issues } = await construirePeintureArme([m], '00000000', new ArmorLibrary('/armes', io))
    expect(issues).toEqual([{ kind: 'coating_unknown', what: '00000000', count: 1 }])
    // Le style par défaut de la liste n’a pas de dégradé : zone allumée, couche absente (-1).
    expect(Array.from(coat.get(m)!.paint.data.slice(0, 2))).toEqual([1, -1])
  })

  it('table illisible : tout neutre, nommé une fois par matériau', async () => {
    const { io } = fakeIO(new Set(['coatings.json']))
    const { coat, issues } = await construirePeintureArme([paintedMaterial(), paintedMaterial()], '2c5251bc', new ArmorLibrary('/armes', io))
    expect(issues).toEqual([{ kind: 'coatings_unavailable', what: '', count: 1 }])
    expect(coat.size).toBe(2)
    expect([...coat.values()].every((p) => p.paint.data[0] === 0)).toBe(true)
  })
})

describe('reportArme', () => {
  it('rapporte la peinture une fois : info sans repli, warning sinon', () => {
    reportArme('1', '11111111', new Map(), [])
    expect(console.info).toHaveBeenCalledTimes(1)
    expect(console.info).toHaveBeenCalledWith('rejeu 3D : arme 1 (11111111) : 0 matériaux peints, 0 replis', [])
    expect(console.warn).not.toHaveBeenCalled()
    reportArme('1', '22222222', new Map(), [{ kind: 'coating_unknown', what: '2c5251bc', count: 2 }])
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledWith('rejeu 3D : arme 1 (22222222) : 0 matériaux peints, 1 replis', ['coating_unknown 2c5251bc ×2'])
  })
})
