/**
 * playerProbe3d.ts — LA SONDE D'ENVIRONNEMENT DES JOUEURS : l'armure d'un joueur porte la sonde de
 * la carte la plus proche de sa position, comme la surface où il se tient (`lighting.assignProbes`)
 * — reflets éteints, `envMap` nulle, comme la carte.
 *
 * L'attribution est répétée à chaque image, sans écriture quand la sonde est déjà portée : un
 * changement entre deux sondes de même nature ne recompile pas le matériau ; seule la bascule
 * sonde ↔ sans sonde la fait (`needsUpdate`).
 */
import * as THREE from 'three'

import { ENV_INTENSITY } from './lighting'

/**
 * assignPlayerProbe donne à `material` la sonde `probe` (nulle : reflets éteints), sans réécrire
 * un matériau qui la porte déjà.
 */
export function assignPlayerProbe(material: THREE.Material, probe: THREE.Texture | null): void {
  if (!(material instanceof THREE.MeshStandardMaterial)) return
  if (material.envMap === probe) return
  const bascule = material.envMap === null ? probe !== null : probe === null
  material.envMap = probe
  if (probe) material.envMapIntensity = ENV_INTENSITY
  if (bascule) material.needsUpdate = true
}

/** assignPlayerProbes : `assignPlayerProbe` sur chaque matériau de `materials`. */
export function assignPlayerProbes(materials: readonly THREE.Material[], probe: THREE.Texture | null): void {
  for (const material of materials) assignPlayerProbe(material, probe)
}
