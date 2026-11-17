// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * weaponCoat3d.ts — A WEAPON'S PAINT FOR A PLAYER: the same core as armor's
 * (`armorCoat3d.paintMaterials`), on the weapon model's painted materials
 * (raw masks in `userData.armorMaps`, style in `userData.style`, loaded by
 * `weaponModels3d`), with the WEAPON LIBRARY's table and coatings
 * (`ArmorLibrary` over the served folder: the same file contract, `coatings.json`,
 * `coating-<key>.json`, `swatch-<id>.png`), with no visor.
 *
 * Named fallbacks, reported ONCE to the console (`reportArme`): unreadable table (all neutral),
 * coating absent from the library (each list's default style), gradient not loaded
 * (neutral), and those of `armorCoating3d`.
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
 * construirePeintureArme paints the player weapon's `materiaux` materials: `styleKey` null —
 * the player wears no coating for this weapon (each list's default style, with no named
 * fallback); `styleKey` read — its key's coating, or each material's list default style if it
 * is absent from the library.
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

/** reportArme logs a player weapon's paint once: coating and each counted fallback. */
export function reportArme(xuid: string, modelKey: string, coat: Coat, issues: readonly CoatIssue[]): void {
  const log = issues.length > 0 ? console.warn : console.info
  log(`3D replay: weapon ${xuid} (${modelKey}): ${coat.size} materials painted, ${issues.length} fallbacks`,
    issues.map((i) => `${i.kind} ${i.what} ×${i.count}`),
  )
}
