/**
 * armorCoat3d.ts — LA PEINTURE D'UNE TENUE POUR UN JOUEUR : pour chaque matériau peint de sa tenue
 * (masques bruts en `userData.armorMaps`, style en `userData.style`, `armorLibrary3d`), la peinture de
 * son revêtement et de sa visière (`armorCoating3d.paintOf`), rangée pour les uniformes
 * (`armorMaterial3d.packPaint`), ses dégradés chargés dans la texture à couches de la session
 * (`armorGradients3d`). `spartan3d` en peint ses copies.
 *
 * Le noyau (`paintMaterials`) peint des matériaux pour UNE table et UN revêtement donnés : la tenue
 * d'un joueur y passe avec sa visière, les armes (`weaponCoat3d`) avec la table de leur bibliothèque
 * et sans visière.
 *
 * Replis nommés, rapportés UNE fois par joueur à la console : table illisible (tout neutre),
 * revêtement absent de la bibliothèque (style par défaut de chaque liste), dégradé non chargé (neutre),
 * et ceux de `armorCoating3d`.
 */
import * as THREE from 'three'

import type { SpartanArmorManifest } from '@/lib/replay/spartanArmor'

import {
  neutralPaint,
  paintOf,
  visorSwatch,
  type CoatingFile,
  type CoatingSwatch,
  type CoatingTable,
  type MaterialStyle,
  type PaintIssueKind,
  type PaintNote,
} from './armorCoating3d'
import type { GradientAtlas } from './armorGradients3d'
import { gradientsOf, packPaint, type ArmorMaps, type PackedPaint } from './armorMaterial3d'
import type { Outfit } from './armory3d'

/** La peinture d'un matériau source de la tenue, pour un joueur. */
export interface CoatPaint {
  maps: ArmorMaps
  paint: PackedPaint
  /** L'uniforme commun des dégradés de la session. */
  gradients: THREE.IUniform<THREE.Texture>
}

/** La peinture de la tenue d'un joueur, par matériau source (ceux que la bibliothèque possède). */
export type Coat = ReadonlyMap<THREE.Material, CoatPaint>

/** Un repli de la peinture d'un joueur, compté. */
export interface CoatIssue {
  kind: PaintIssueKind
  what: string
  count: number
}

/** Ce que la peinture lit dans la bibliothèque (`ArmorLibrary`). */
export interface CoatSource {
  coatings(): Promise<CoatingTable | null>
  coating(key: string): Promise<CoatingFile | null>
  /** swatch charge le dégradé `id` dans `gradients` ; rend sa couche, null s'il ne se charge pas. */
  swatch(id: string): Promise<number | null>
  readonly gradients: GradientAtlas
}

/** paintedMaterials : les matériaux de la tenue que la vue peint (masques bruts chargés), une fois chacun. */
export function paintedMaterials(outfit: Outfit): THREE.Material[] {
  const out = new Set<THREE.Material>()
  const add = (m: THREE.Material | THREE.Material[]) => {
    for (const x of Array.isArray(m) ? m : [m]) if (x.userData.armorMaps) out.add(x)
  }
  for (const s of outfit.skinned) add(s.material)
  for (const r of outfit.rigid) for (const { mesh } of r.meshes) add(mesh.material)
  return [...out]
}

/**
 * buildCoat peint la tenue `outfit` du joueur de manifeste `m` ; rend la peinture et ses replis
 * (comptés par genre et objet).
 */
export async function buildCoat(outfit: Outfit, m: SpartanArmorManifest, lib: CoatSource): Promise<{ coat: Coat; issues: CoatIssue[] }> {
  return construirePeintureMateriaux(paintedMaterials(outfit), m, lib)
}

export async function construirePeintureMateriaux(materiaux: readonly THREE.Material[], m: SpartanArmorManifest, lib: CoatSource): Promise<{ coat: Coat; issues: CoatIssue[] }> {
  const counts = new Map<string, CoatIssue>()
  const note: PaintNote = (kind, what) => {
    const k = `${kind} ${what}`
    const e = counts.get(k)
    if (e) e.count++
    else counts.set(k, { kind, what, count: 1 })
  }
  const table = await lib.coatings()
  const key = m.coating?.style_key
  const coating = table && key ? await lib.coating(key) : null
  if (!table) note('coatings_unavailable', '')
  else if (!coating) note('coating_unknown', key ?? m.coating?.path ?? '')
  const visor = table ? visorSwatch(table, m.visor, note) : null
  const coat = await paintMaterials(materiaux, table, { coating, visor }, lib, note)
  return { coat, issues: [...counts.values()] }
}

/**
 * paintMaterials : le noyau de la peinture — `materiaux` peints pour la table `table` (null : tout
 * neutre) et la peinture du joueur (son revêtement, null absent, sa visière, null aucune).
 */
export async function paintMaterials(
  materiaux: readonly THREE.Material[],
  table: CoatingTable | null,
  peinture: { coating: CoatingFile | null; visor: CoatingSwatch | null },
  lib: Pick<CoatSource, 'swatch' | 'gradients'>,
  note: PaintNote,
): Promise<Coat> {
  const coat = new Map<THREE.Material, CoatPaint>()
  await Promise.all(
    materiaux.map(async (mat) => {
      const style = (mat.userData.style as MaterialStyle | undefined) ?? null
      const paint = table ? paintOf(style, { table, coating: peinture.coating, visor: peinture.visor }, note) : neutralPaint()
      await Promise.all(gradientsOf(paint).map((g) => lib.swatch(g)))
      const packed = packPaint(paint, (g) => lib.gradients.layer(g), note)
      coat.set(mat, { maps: mat.userData.armorMaps as ArmorMaps, paint: packed, gradients: lib.gradients.uniform })
    }),
  )
  return coat
}

/** reportCoat écrit la peinture d'un joueur une fois : revêtement, visière, et chaque repli compté. */
export function reportCoat(xuid: string, m: SpartanArmorManifest, coat: Coat, issues: readonly CoatIssue[]): void {
  const log = issues.length > 0 ? console.warn : console.info
  log(
    `rejeu 3D : revêtement ${xuid} (${m.coating?.style_key ?? 'aucun'}, visière ${m.visor?.visor_id ?? '-'}/${m.visor?.color_variant ?? '-'}) : ` +
      `${coat.size} matériaux peints, ${issues.length} replis`,
    issues.map((i) => `${i.kind} ${i.what} ×${i.count}`),
  )
}
