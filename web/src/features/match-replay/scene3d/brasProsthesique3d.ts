/**
 * brasProsthesique3d.ts — LE MEMBRE PROSTHÉTIQUE DES BRAS EN PREMIÈRE PERSONNE : le revêtement
 * d'armure du joueur ne le peint jamais — dans le jeu il n'est pas couvert par l'armure (mains,
 * poignets, avant-bras) et se montre en gunmetal. L'identification est par les données : un
 * matériau de bras est prosthétique si la région de son style appartient au manifeste du joueur à
 * une source de membre prosthétique (`source` commençant par `prosthetic`), jamais par un joueur
 * nommé. Sa peinture (`peintureProsthesique`) porte les deux teintes du gunmetal, séparées par le
 * masque de la pièce : la teinte claire en base (zone 0) et la teinte sombre (`DARK_METAL`) là où
 * porte le rouge du masque 0 (zone 1) ; les autres zones restent éteintes, sans salissure ni
 * rayures.
 */
import * as THREE from 'three'

import { ZONES, type CoatingSwatch, type MaterialPaint, type MaterialStyle } from './armorCoating3d'
import { DARK_METAL, LIGHT_METAL } from './fallbackMetal3d'

/** sourceProsthesique : la source d'une région du manifeste est-elle un membre prosthétique. */
export function sourceProsthesique(source: string | undefined): boolean {
  return source?.startsWith('prosthetic') ?? false
}

/**
 * regionsProsthetiques : les clés de région des membres prosthétiques du choix du joueur ; l'ensemble
 * vide sans manifeste ni région prosthétique.
 */
export function regionsProsthetiques(regions: readonly { region_key: string; source: string }[] | null): ReadonlySet<string> {
  const out = new Set<string>()
  if (regions) for (const r of regions) if (sourceProsthesique(r.source)) out.add(r.region_key)
  return out
}

/** materiauProsthesique : le matériau d'une pièce de bras est-il un membre prosthétique, par la région de son style. */
export function materiauProsthesique(materiau: THREE.Material, regions: ReadonlySet<string>): boolean {
  const region = (materiau.userData.style as MaterialStyle | undefined)?.region
  return region !== undefined && regions.has(region)
}

/** swatchUni : un nuancier uni (deux extrémités égales, sans dégradé ni usure). */
function swatchUni(index: number, teinte: { r: number; g: number; b: number }, metal: number, rugosite: number): CoatingSwatch {
  return {
    index,
    gradient_scale: [0, 0],
    roughness: rugosite * 4,
    roughness_white: 1,
    roughness_black: 1,
    metallic: metal,
    emissive: 0,
    top: [teinte.r, teinte.g, teinte.b],
    mid: [teinte.r, teinte.g, teinte.b],
    bot: [teinte.r, teinte.g, teinte.b],
    scratch_color: [0, 0, 0],
    scratch_roughness: 0,
    scratch_metallic: 0,
  }
}

/** peintureProsthesique : la peinture gunmetal d'un membre prosthétique (base claire, sombre au masque 0). */
export function peintureProsthesique(): MaterialPaint {
  const zones = Array.from({ length: ZONES }, () => null as CoatingSwatch | null)
  zones[0] = swatchUni(0, LIGHT_METAL, LIGHT_METAL.metalness, LIGHT_METAL.roughness)
  zones[1] = swatchUni(1, DARK_METAL, DARK_METAL.metalness, DARK_METAL.roughness)
  return { zones, grime: null, grimeAmount: 0, scratchAmount: 0, density: [1, 1], offset: [0, 0] }
}
