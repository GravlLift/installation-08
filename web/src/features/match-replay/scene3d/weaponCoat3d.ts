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
 *
 * A WEAPON THE PLAYER HAS NO COATING FOR WEARS ITS DEFAULT STYLES. The game gives no weapon core to
 * the Fuel Rod, the Skewer or the Energy Sword (none of the 9 local films' 73 customizations
 * carries one), so `weapon_coatings` never names them; the game still draws them in their own
 * look, the default style of each of their style lists (the same style the Standard Issue coating
 * picks: `4fd2e5a1` for the BR75's list, `983ef04a` for the SPNKr's). Leaving them unpainted drew
 * the raw model, dark metal with no texture.
 */
import * as THREE from 'three'

import { paintMaterials, type Coat, type CoatIssue, type CoatSource } from './armorCoat3d'
import type { PaintNote } from './armorCoating3d'

/**
 * construirePeintureArme peint les matériaux `materiaux` de l'arme du joueur : `styleKey` null —
 * le joueur ne porte pas de revêtement pour cette arme (le style par défaut de chaque liste, sans
 * repli nommé) ; `styleKey` lue — le revêtement de sa clé, ou le style par défaut de chaque liste
 * du matériau s'il est absent de la bibliothèque.
 */
export async function construirePeintureArme(
  materiaux: readonly THREE.Material[],
  styleKey: string | null,
  lib: CoatSource,
): Promise<{ coat: Coat; issues: CoatIssue[] }> {
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
  else if (!coating && styleKey) note('coating_unknown', styleKey)
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
