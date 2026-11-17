// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it, vi } from 'vitest'

import {
  ANY_REGION,
  VISOR_REGION,
  hexId,
  paintOf,
  visorSwatch,
  type CoatingFile,
  type CoatingSwatch,
  type CoatingTable,
  type MaterialStyle,
} from './armorCoating3d'

function swatch(index: number, top: number, extra: Partial<CoatingSwatch> = {}): CoatingSwatch {
  return {
    index, gradient_scale: [1, 1], roughness: 4, roughness_white: 0.3, roughness_black: 0.6, metallic: 0, emissive: 0,
    top: [top, top, top], mid: [0.5, 0.5, 0.5], bot: [0, 0, 0], scratch_color: [0, 0, 0], scratch_roughness: 0, scratch_metallic: 0,
    ...extra,
  }
}

const OWN = 'd37e845f'
const BASE = '229d91fa'
const RED = 'ee77d118'
const GLOBAL = '11111111'
const CHAINED = '22222222'

/** The table: a default style, a global that falls back to `BASE`, another without a fallback, a visor. */
function table(): CoatingTable {
  return {
    schema: 1,
    globals: { [GLOBAL]: { fallback: BASE, layer: swatch(0, 0.11) }, [CHAINED]: { layer: swatch(0, 0.22) } },
    default_styles: { b0799de3: 'dddddddd', aaaaaaaa: 'eeeeeeee' },
    styles: {
      dddddddd: { grime_amount: 0.1, scratch_amount: 0.2, regions: { [ANY_REGION]: { [BASE]: swatch(0, 0.9) } } },
      eeeeeeee: { old_system: true, grime_amount: 0, scratch_amount: 0, regions: { [OWN]: { a: swatch(0, 0.31), b: swatch(1, 0.32), c: swatch(2, 0.33) } } },
    },
    visors: {
      patterns: { [hexId(936780723)]: { gradient: 'f37a7146', gradient_scale: [6, 6], roughness_white: 0.1, roughness_black: 0.2, metallic: 1, scratch_color: [0, 0, 0], scratch_roughness: 0, scratch_metallic: 0 } },
      colors: { [hexId(-382869120)]: { top: [0.497, 0, 0], mid: [0.133, 0.133, 0.133], bot: [0.133, 0.133, 0.133] } },
    },
  }
}

/** The coating: list `b0799de3` takes `cccccccc`, own region then shared, red zone off. */
function coating(): CoatingFile {
  return {
    style: '2c5251bc',
    lists: { b0799de3: 'cccccccc' },
    styles: {
      cccccccc: {
        grime_amount: 0.55, scratch_amount: 0.5, grime_swatch: swatch(0, 0.05),
        regions: { [OWN]: { [BASE]: swatch(0, 0.7) }, [ANY_REGION]: { [RED]: swatch(1, 0.8, { disabled: true }), [BASE]: swatch(0, 0.6) } },
      },
    },
  }
}

function style(over: Partial<MaterialStyle> = {}): MaterialStyle {
  return { stylelist: 'b0799de3', region: OWN, intentions: [BASE, RED, '00000000', '00000000', '00000000', '00000000', '00000000'], layers: 7, texel_density: [2, 3], offset: [0.1, 0.2], ...over }
}

const tops = (zones: (CoatingSwatch | null)[]) => zones.map((z) => z?.top[0] ?? null)

describe('paintOf', () => {
  it("the coating's style for the material's list: own region before the shared one, an off zone is null", () => {
    const note = vi.fn()
    const p = paintOf(style(), { table: table(), coating: coating(), visor: null }, note)
    expect(tops(p.zones)).toEqual([0.7, null, null, null, null, null, null])
    expect([p.grimeAmount, p.scratchAmount, p.grime?.top[0], p.density, p.offset]).toEqual([0.55, 0.5, 0.05, [2, 3], [0.1, 0.2]])
    expect(note).not.toHaveBeenCalled()
  })

  it("a list the coating does not name: the list's default style, named", () => {
    const note = vi.fn()
    const p = paintOf(style({ region: 'ffffffff' }), { table: table(), coating: { ...coating(), lists: {} }, visor: null }, note)
    expect(tops(p.zones)[0]).toBe(0.9)
    expect(note).toHaveBeenCalledWith('style_not_in_list', 'b0799de3')
  })

  it('without a coating: the default style, with no list fallback', () => {
    const note = vi.fn()
    expect(tops(paintOf(style(), { table: table(), coating: null, visor: null }, note).zones)[0]).toBe(0.9)
    expect(note).toHaveBeenCalledWith('intention_unknown', RED)
    expect(note).not.toHaveBeenCalledWith('style_not_in_list', expect.anything())
  })

  it('a list unknown to the table, material without a style: neutral, named', () => {
    const note = vi.fn()
    expect(tops(paintOf(style({ stylelist: '99999999' }), { table: table(), coating: null, visor: null }, note).zones).every((z) => z === null)).toBe(true)
    expect(note).toHaveBeenCalledWith('stylelist_unknown', '99999999')
    expect(paintOf(null, { table: table(), coating: null, visor: null }, note).grime).toBeNull()
    expect(note).toHaveBeenCalledWith('material_without_style', '')
  })

  it("globals: the fallback first (new system), the fallback-less global's own layer", () => {
    const note = vi.fn()
    const p = paintOf(style({ intentions: [GLOBAL, CHAINED] , layers: 2 }), { table: table(), coating: coating(), visor: null }, note)
    expect(tops(p.zones).slice(0, 2)).toEqual([0.7, 0.22])
  })

  it("old system: the region's same-rank layer, beyond the declared zones", () => {
    const note = vi.fn()
    const p = paintOf(style({ stylelist: 'aaaaaaaa', intentions: [GLOBAL, CHAINED, GLOBAL], layers: 2 }), { table: table(), coating: null, visor: null }, note)
    expect(tops(p.zones).slice(0, 3)).toEqual([0.31, 0.32, 0.33])
  })

  it("visor: only the visor material's base zone takes its swatch", () => {
    const note = vi.fn()
    const visor = visorSwatch(table(), { visor_id: 936780723, color_variant: -382869120 }, note)
    expect(visor?.top).toEqual([0.497, 0, 0])
    expect([visor?.gradient, visor?.metallic, visor?.roughness]).toEqual(['f37a7146', 1, 4])
    const src = { table: table(), coating: coating(), visor }
    expect(paintOf(style({ region: VISOR_REGION }), src, note).zones[0]).toBe(visor)
    expect(paintOf(style(), src, note).zones[0]).not.toBe(visor)
    expect(note).not.toHaveBeenCalled()
  })

  it('unknown or absent visor: null, unknown named', () => {
    const note = vi.fn()
    expect(visorSwatch(table(), { visor_id: 1, color_variant: 2 }, note)).toBeNull()
    expect(note).toHaveBeenCalledWith('visor_unknown', '00000001/00000002')
    expect(visorSwatch(table(), undefined, note)).toBeNull()
    expect(note).toHaveBeenCalledTimes(1)
  })
})

describe('hexId', () => {
  it('signed API identifiers as an 8-digit key', () => {
    expect([hexId(743592380), hexId(-382869120), hexId(1)]).toEqual(['2c5251bc', 'e92de180', '00000001'])
  })
})
