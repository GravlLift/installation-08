/**
 * weaponCoat3d.ts — LA PEINTURE D'UNE ARME POUR UN JOUEUR : le même noyau que l'armure
 * (`armorCoat3d.paintMaterials`), sur les matériaux peints du modèle de l'arme
 * (masques bruts en `userData.armorMaps`, style en `userData.style`, chargés par
 * `weaponModels3d`), avec la table et les revêtements de la BIBLIOTHÈQUE DES ARMES
 * (`ArmorLibrary` sur le dossier servi : même contrat de fichiers, `coatings.json`,
 * `coating-<key>.json`, `swatch-<id>.png`), sans visière.
 *
 * Replis nommés, rapportés UNE fois à la console (`reportArme`) : table illisible (tout neutre),
 * revêtement absent de la bibliothèque (style par défaut de chaque liste), dégradé non chargé
 * (neutre), et ceux de `armorCoating3d`.
 */
import * as THREE from 'three'

import { paintMaterials, type Coat, type CoatIssue, type CoatSource } from './armorCoat3d'
import type { PaintNote } from './armorCoating3d'

/**
 * construirePeintureArme peint les matériaux `materiaux` de l'arme du joueur : `styleKey` null —
 * le joueur ne porte pas de revêtement pour cette arme (pas de peinture, tout neutre) ;
 * `styleKey` lue — le revêtement de sa clé, ou le style par défaut de chaque liste du matériau
 * s'il est absent de la bibliothèque.
 */
export async function construirePeintureArme(
  materiaux: readonly THREE.Material[],
  styleKey: string | null,
  lib: CoatSource,
): Promise<{ coat: Coat; issues: CoatIssue[] }> {
  if (styleKey === null) return { coat: new Map(), issues: [] }
  const counts = new Map<string, CoatIssue>()
  const note: PaintNote = (kind, what) => {
    const k = `${kind} ${what}`
    const e = counts.get(k)
    if (e) e.count++
    else counts.set(k, { kind, what, count: 1 })
  }
  const table = await lib.coatings()
  const coating = table && styleKey ? await lib.coating(styleKey) : null
  if (!table) note('coatings_unavailable', '')
  else if (!coating) note('coating_unknown', styleKey)
  const coat = await paintMaterials(materiaux, table, { coating, visor: null }, lib, note)
  return { coat, issues: [...counts.values()] }
}

/** reportArme écrit la peinture d'une arme du joueur une fois : revêtement et chaque repli compté. */
export function reportArme(xuid: string, modelKey: string, coat: Coat, issues: readonly CoatIssue[]): void {
  const log = issues.length > 0 ? console.warn : console.info
  log(`rejeu 3D : arme ${xuid} (${modelKey}) : ${coat.size} matériaux peints, ${issues.length} replis`,
    issues.map((i) => `${i.kind} ${i.what} ×${i.count}`),
  )
}
