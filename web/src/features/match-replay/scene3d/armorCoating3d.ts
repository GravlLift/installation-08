// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * armorCoating3d.ts — AN ARMOR MATERIAL'S PAINT, a pure function: the material's style
 * (`extras.style` from its GLB), the library's coating table, the player's coating and visor
 * give the swatch of each of its seven zones and the grime. Contract written at the top of
 * `meshproto/revetements.go` (server side); the rule for looking up an intention is that of
 * the Ekur Blender plugin (The Halo Archive, `layered_shader.py`, `get_intention`),
 * reimplemented here without reusing its code.
 *
 * Fallbacks, all named (`note`) and never silent:
 *   - unreadable coating table: neutral everywhere (`coatings_unavailable`, `armorCoat3d`);
 *   - material without a style: neutral (`material_without_style`);
 *   - coating missing from the library, or a list the coating does not name: the list's
 *     default style (`coating_unknown`, `style_not_in_list`);
 *   - list or style unknown to the table: neutral (`stylelist_unknown`);
 *   - intention not found: zone off (`intention_unknown`);
 *   - unknown visor pattern or color: the base zone keeps the coating (`visor_unknown`);
 *   - gradient image not loaded: neutral gradient (`gradient_missing`, `armorMaterial3d`).
 */

/** A coating layer (`meshproto.Nuancier`). Linear colors. */
export interface CoatingSwatch {
  index: number
  disabled?: boolean
  /** The gradient bitmap (`swatch-<id>.png`); absent: neutral gradient (mid, roughness mixed halfway). */
  gradient?: string
  gradient_scale: [number, number]
  roughness: number
  roughness_white: number
  roughness_black: number
  metallic: number
  emissive: number
  top: [number, number, number]
  mid: [number, number, number]
  bot: [number, number, number]
  scratch_color: [number, number, number]
  scratch_roughness: number
  scratch_metallic: number
}

/** A style (`meshproto.StyleRevetement`). */
export interface CoatingStyle {
  old_system?: boolean
  grime_amount: number
  scratch_amount: number
  grime_swatch?: CoatingSwatch
  regions: Record<string, Record<string, CoatingSwatch>>
}

/** The library's shared table (`coatings.json`, `meshproto.TableRevetements`). */
export interface CoatingTable {
  schema: number
  globals: Record<string, { fallback?: string; layer: CoatingSwatch }>
  default_styles: Record<string, string>
  styles: Record<string, CoatingStyle>
  visors: {
    patterns: Record<string, VisorPattern>
    colors: Record<string, { top: [number, number, number]; mid: [number, number, number]; bot: [number, number, number] }>
  }
}

export interface VisorPattern {
  gradient?: string
  gradient_scale: [number, number]
  roughness_white: number
  roughness_black: number
  metallic: number
  scratch_color: [number, number, number]
  scratch_roughness: number
  scratch_metallic: number
}

/** A coating (`coating-<style_key>.json`, `meshproto.Revetement`). */
export interface CoatingFile {
  style: string
  lists: Record<string, string>
  styles: Record<string, CoatingStyle>
}

/** A material's style (`extras.style`, `meshproto.ExtrasStyleMateriau`). */
export interface MaterialStyle {
  stylelist: string
  region: string
  intentions: string[]
  layers: number
  texel_density: [number, number]
  offset: [number, number]
}

/** A material's paint: seven zones (null: off), the grime, the global amounts. */
export interface MaterialPaint {
  zones: (CoatingSwatch | null)[]
  grime: CoatingSwatch | null
  grimeAmount: number
  scratchAmount: number
  density: [number, number]
  offset: [number, number]
}

export type PaintIssueKind =
  | 'coatings_unavailable'
  | 'material_without_style'
  | 'coating_unknown'
  | 'style_not_in_list'
  | 'stylelist_unknown'
  | 'intention_unknown'
  | 'visor_unknown'
  | 'gradient_missing'

export type PaintNote = (kind: PaintIssueKind, what: string) => void

/** The reference regions and intentions (`meshproto.RegionCommune`, `RegionVisiere`). */
export const ANY_REGION = '0b7e328b'
export const VISOR_REGION = '54ad0a58'
const NO_INTENTION = '00000000'
export const ZONES = 7
/** At most this many chained global fallbacks (the table never chains more than two). */
const MAX_FALLBACKS = 4

/** What paints a player: the table, their coating (null: absent) and their visor (null: none). */
export interface PaintSource {
  table: CoatingTable
  coating: CoatingFile | null
  visor: CoatingSwatch | null
}

/** hexId: the hexadecimal key (8 digits, unsigned 32 bits) of a signed API identifier. */
export function hexId(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0')
}

/** neutralPaint: a styleless material's paint, seven zones off, no wear. */
export function neutralPaint(): MaterialPaint {
  return { zones: Array.from({ length: ZONES }, () => null), grime: null, grimeAmount: 0, scratchAmount: 0, density: [1, 1], offset: [0, 0] }
}

/** paintOf: the paint of a material styled `style` for the player of `src`. */
export function paintOf(style: MaterialStyle | null, src: PaintSource, note: PaintNote): MaterialPaint {
  if (!style) {
    note('material_without_style', '')
    return neutralPaint()
  }
  const coated = src.coating?.lists[style.stylelist]
  if (src.coating && !coated) note('style_not_in_list', style.stylelist)
  const ref = coated ?? src.table.default_styles[style.stylelist]
  const data = ref ? (src.coating?.styles[ref] ?? src.table.styles[ref]) : undefined
  if (!data) {
    note('stylelist_unknown', style.stylelist)
    return neutralPaint()
  }
  const region = data.regions[style.region]
  const count = data.old_system && region && Object.keys(region).length > style.layers ? ZONES : style.layers
  const zones = Array.from({ length: ZONES }, (_, k): CoatingSwatch | null => {
    const intention = style.intentions[k] ?? NO_INTENTION
    if (k >= count || intention === NO_INTENTION) return null
    const s = intentionOf(intention, data, style.region, src.table, k, 0)
    if (!s) note('intention_unknown', intention)
    return s && !s.disabled ? s : null
  })
  if (style.region === VISOR_REGION && src.visor) zones[0] = src.visor
  return {
    zones,
    grime: data.grime_swatch && !data.grime_swatch.disabled ? data.grime_swatch : null,
    grimeAmount: data.grime_amount,
    scratchAmount: data.scratch_amount,
    density: style.texel_density,
    offset: style.offset,
  }
}

/**
 * intentionOf: the intention's swatch in the material's region, then the shared region, then
 * the globals (their fallback first, outside the old system; old system: the layer at rank
 * `k` of the material's region).
 */
function intentionOf(intention: string, data: CoatingStyle, region: string, table: CoatingTable, k: number, depth: number): CoatingSwatch | null {
  const own = data.regions[region]
  const found = own?.[intention] ?? data.regions[ANY_REGION]?.[intention]
  if (found) return found
  const g = table.globals[intention]
  if (!g) return null
  if (g.fallback && !data.old_system && depth < MAX_FALLBACKS) return intentionOf(g.fallback, data, region, table, 0, depth + 1)
  if (data.old_system && own) {
    const same = Object.values(own).find((s) => s.index === k)
    if (same) return same
  }
  return g.layer
}

/**
 * visorSwatch: the player's visor (pattern `visor_id`, colors `color_variant`, signed API
 * keys) as a base-zone swatch; null without a visor, or if it names an unknown one.
 */
export function visorSwatch(table: CoatingTable, visor: { visor_id?: number; color_variant?: number } | undefined, note: PaintNote): CoatingSwatch | null {
  if (!visor || visor.visor_id === undefined || visor.color_variant === undefined) return null
  const pattern = table.visors.patterns[hexId(visor.visor_id)]
  const color = table.visors.colors[hexId(visor.color_variant)]
  if (!pattern || !color) {
    note('visor_unknown', `${hexId(visor.visor_id)}/${hexId(visor.color_variant)}`)
    return null
  }
  return {
    index: 0,
    gradient: pattern.gradient,
    gradient_scale: pattern.gradient_scale,
    roughness: 4,
    roughness_white: pattern.roughness_white,
    roughness_black: pattern.roughness_black,
    metallic: pattern.metallic,
    emissive: 0,
    top: color.top,
    mid: color.mid,
    bot: color.bot,
    scratch_color: pattern.scratch_color,
    scratch_roughness: pattern.scratch_roughness,
    scratch_metallic: pattern.scratch_metallic,
  }
}
