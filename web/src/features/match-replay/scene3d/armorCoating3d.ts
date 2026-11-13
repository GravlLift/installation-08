/**
 * armorCoating3d.ts — LA PEINTURE D'UN MATÉRIAU D'ARMURE, fonction pure : le style du matériau
 * (`extras.style` de son GLB), la table des revêtements de la bibliothèque, le revêtement du joueur
 * et sa visière donnent le nuancier de chacune de ses sept zones et de la salissure. Contrat écrit
 * en tête de `meshproto/revetements.go` (côté serveur) ; la règle de recherche d'une intention est
 * celle du greffon Blender Ekur (The Halo Archive, `layered_shader.py`, `get_intention`),
 * réimplémentée ici sans en reprendre le code.
 *
 * Replis, tous nommés (`note`) et jamais silencieux :
 *   - table des revêtements illisible : neutre partout (`coatings_unavailable`, `armorCoat3d`) ;
 *   - matériau sans style : neutre (`material_without_style`) ;
 *   - revêtement absent de la bibliothèque, ou liste que le revêtement ne nomme pas : style par
 *     défaut de la liste (`coating_unknown`, `style_not_in_list`) ;
 *   - liste ou style inconnus de la table : neutre (`stylelist_unknown`) ;
 *   - intention introuvable : zone éteinte (`intention_unknown`) ;
 *   - motif ou couleur de visière inconnus : la zone de base garde le revêtement (`visor_unknown`) ;
 *   - image d'un dégradé non chargée : dégradé neutre (`gradient_missing`, `armorMaterial3d`).
 */

/** Une couche de revêtement (`meshproto.Nuancier`). Couleurs linéaires. */
export interface CoatingSwatch {
  index: number
  disabled?: boolean
  /** Le bitmap du dégradé (`swatch-<id>.png`) ; absent : dégradé neutre (milieu, rugosité mêlée à moitié). */
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

/** Un style (`meshproto.StyleRevetement`). */
export interface CoatingStyle {
  old_system?: boolean
  grime_amount: number
  scratch_amount: number
  grime_swatch?: CoatingSwatch
  regions: Record<string, Record<string, CoatingSwatch>>
}

/** La table commune de la bibliothèque (`coatings.json`, `meshproto.TableRevetements`). */
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

/** Un revêtement (`coating-<style_key>.json`, `meshproto.Revetement`). */
export interface CoatingFile {
  style: string
  lists: Record<string, string>
  styles: Record<string, CoatingStyle>
}

/** Le style d'un matériau (`extras.style`, `meshproto.ExtrasStyleMateriau`). */
export interface MaterialStyle {
  stylelist: string
  region: string
  intentions: string[]
  layers: number
  texel_density: [number, number]
  offset: [number, number]
}

/** La peinture d'un matériau : sept zones (null : éteinte), la salissure, les quantités globales. */
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

/** Les régions et intentions de la référence (`meshproto.RegionCommune`, `RegionVisiere`). */
export const ANY_REGION = '0b7e328b'
export const VISOR_REGION = '54ad0a58'
const NO_INTENTION = '00000000'
export const ZONES = 7
/** Au plus autant de replis de globales enchaînés (la table n'en enchaîne pas plus de deux). */
const MAX_FALLBACKS = 4

/** Ce qui peint un joueur : la table, son revêtement (null : absent) et sa visière (null : aucune). */
export interface PaintSource {
  table: CoatingTable
  coating: CoatingFile | null
  visor: CoatingSwatch | null
}

/** hexId : la clé hexadécimale (8 chiffres, 32 bits non signés) d'un identifiant signé de l'API. */
export function hexId(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0')
}

/** neutralPaint : la peinture d'un matériau sans style, sept zones éteintes, sans usure. */
export function neutralPaint(): MaterialPaint {
  return { zones: Array.from({ length: ZONES }, () => null), grime: null, grimeAmount: 0, scratchAmount: 0, density: [1, 1], offset: [0, 0] }
}

/** paintOf : la peinture d'un matériau de style `style` pour le joueur de `src`. */
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
 * intentionOf : le nuancier de l'intention dans la région du matériau, puis la région commune, puis
 * les globales (leur repli d'abord, hors ancien système ; ancien système : la couche de rang `k` de
 * la région du matériau).
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
 * visorSwatch : la visière du joueur (motif `visor_id`, couleurs `color_variant`, clés de l'API
 * signées) en nuancier de zone de base ; null sans visière, ou nommée inconnue.
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
