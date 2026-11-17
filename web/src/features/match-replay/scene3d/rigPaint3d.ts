// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * rigPaint3d.ts — PAINTING THE FOLLOWED PLAYER'S FIRST-PERSON RIG ARMS.
 *
 * The loaded rig is neutral; `RigPaint3d` applies the player's paint (coating and visor,
 * `SpartanArmory.peindreBras`) by material COPY, onto the rig's arm materials and those of
 * pieces placed by `RigDressing3d`: the original stays the loader's. The (rig file, outfit)
 * pair avoids repainting every frame; each rig keeps its copies, and a generation counter
 * abandons a late-arriving paint when the player changes. A background-prepared coating
 * (`RigPreparation3d`) applies with no wait when it's ready; otherwise painting is computed in
 * the background. `invalider` forces a repaint: pieces that just arrived carry materials the
 * applied paint doesn't cover. The rig's weapon paints from its own coating: `cleArmeDe` names
 * its model key to `peindreBras`. The applied coating stays on the rig WHILE the next one is
 * computed: the held weapon is never shown unpainted (the rig is often hidden — scope — when
 * repainting starts, and shows again before the new one arrives). Only the absence of an outfit
 * (or a player change) clears the previous one.
 */
import * as THREE from 'three'
import type { LoadGate } from './loadGate3d'

import { armorMaterial } from './armorMaterial3d'
import type { Dress, SpartanArmory } from './armory3d'
import { estMateriauPeint, memePeinture } from './firstPersonArms3d'
import type { BakedLight } from './bakedLightShader'
import type { Coat } from './armorCoat3d'
import { energyCopy, energyTintOf, isEnergized } from './energyField3d'
import type { RigPreparation3d } from './rigPreparation3d'

/** What painting reads from `FirstPersonArms3d`. */
export interface SourcePeinture {
  armurerie(): SpartanArmory | null
  xuid(): string | null
  /** The weapon model key of the rig with file `fichier`, null with no model loaded for it. */
  cleArmeDe(fichier: string): string | null
  /** The background preparation: the ready coating, by rig file. */
  preparation: RigPreparation3d
  gate?: LoadGate
  /** The map's baked light, grafted onto painted copies (it composes with the painted material's patch). */
  baked?: BakedLight | null
}

/**
 * RigPaint3d: applies the followed player's paint onto the first-person rigs; `changerJoueur`
 * abandons an in-progress paint and restores the original materials. `invalider` marks the rig
 * to redo WITHOUT clearing the applied coating: the next one replaces it on arrival.
 */
export class RigPaint3d {
  private readonly rigs = new Map<string, { racine: THREE.Object3D; habit: Dress | null; enCours: boolean; stale: boolean; copies: Map<THREE.Material, THREE.Material> }>()
  private generation = 0
  private readonly copies = new Map<THREE.Material, THREE.Material>()
  private readonly source: SourcePeinture

  constructor(source: SourcePeinture) {
    this.source = source
  }

  /** Is the paint currently being computed (a switch must wait)? */
  enCours(fichier?: string): boolean { return fichier ? !!this.rigs.get(fichier)?.enCours : [...this.rigs.values()].some((rig) => rig.enCours) }

  /** A painted material's source material (its copy), itself if it isn't a copy. */
  materiauSource(materiau: THREE.Material): THREE.Material { return this.copies.get(materiau) ?? materiau }

  /** The applied painted copies (nothing with no paint): the environment probe attaches to them. */
  materiauxPeints(): THREE.Material[] { return [...this.copies.keys()] }

  /**
   * Arm pieces just arrived: the applied paint no longer covers them, it is redone on the next
   * `actualiser`. The applied coating stays in place until the next one arrives: the rig's
   * weapon (often hidden by the scope here) is never shown with the neutral material.
   */
  invalider(fichier: string): void {
    const rig = this.rigs.get(fichier)
    if (rig) rig.stale = true
  }

  /** The player changes (or the view is released): abandons an in-progress paint and restores materials. */
  changerJoueur(): void {
    this.generation++
    for (const rig of this.rigs.values()) this.retirer(rig)
    this.rigs.clear()
  }

  /**
   * actualiser applies the followed player's paint onto rig `fichier`: nothing if the (file,
   * outfit) pair is already applied and the rig isn't invalid, or with no outfit. A prepared
   * coating applies with no wait; otherwise paint is computed in the background, abandoned if
   * the player changes before it lands. The previously applied coating stays on the rig during
   * this computation: it is replaced when the next one arrives, never cleared beforehand (the
   * held weapon is never shown unpainted).
   */
  actualiser(fichier: string, racine: THREE.Object3D): void {
    const xuid = this.source.xuid()
    const habit = xuid ? this.source.armurerie()?.dress(xuid) ?? null : null
    const precedent = this.rigs.get(fichier)
    if (precedent && !precedent.stale && memePeinture(fichier, fichier, habit, precedent.habit)) return
    const armurerie = this.source.armurerie()
    const repeindre = !!habit && !!armurerie && !!xuid
    if (precedent) {
      // With no new coating to apply, the rig returns to neutral; otherwise the applied coating
      // waits for its replacement (inherited copies are disposed when it arrives).
      if (!repeindre) this.retirer(precedent)
      this.rigs.delete(fichier)
    }
    const rig = { racine, habit, enCours: false, stale: false, copies: new Map<THREE.Material, THREE.Material>(precedent && repeindre ? precedent.copies : []) }
    this.rigs.set(fichier, rig)
    if (!repeindre) return
    const materiaux = materiauxPeinturables(racine, (m) => this.materiauSource(m))
    if (!materiaux.length) return
    const coatPreparé = this.source.preparation.coat(fichier)
    // A prepared coating is only used if it covers EXACTLY the materials to paint: pieces
    // placed after it was prepared carry their own materials (the coating doesn't know them),
    // or a rig already painted made them invisible (the coating still carries them). Either
    // way it's stale: the paint is recomputed.
    if (coatPreparé && materiaux.length > 0 && materiaux.every((m) => coatPreparé.has(m)) && [...coatPreparé.keys()].every((m) => materiaux.includes(m))) {
      this.appliquer(rig, coatPreparé)
      return
    }
    if (coatPreparé) this.source.preparation.abandonner(fichier)
    const generation = this.generation
    rig.enCours = true
    const chargement = armurerie
      .peindreBras(xuid, habit, materiaux, this.source.cleArmeDe(fichier))
      .then((coat) => {
        // A computed coat lands only if it still covers EVERY paintable material of the rig: the
        // piece that arrived while it was in flight replaced the materials it was computed on,
        // and landing the stale coat would paint the old materials and leave the new ones
        // neutral. The guard keeps the last known-good coat on the rig meanwhile.
        if (!coat || generation !== this.generation || this.rigs.get(fichier) !== rig) return
        const materiaux = materiauxPeinturables(racine, (m) => this.materiauSource(m))
        if (!materiaux.every((m) => coat.has(m))) return
        rig.stale = false
        this.appliquer(rig, coat)
      })
      .catch((error: unknown) => console.warn('3D replay: arm paint unavailable', error))
      .finally(() => {
        if (generation === this.generation && this.rigs.get(fichier) === rig) rig.enCours = false
      })
    void (this.source.gate?.track(chargement) ?? chargement)
  }

  /** retirer restores a rig's original materials and disposes of its painted copies. */
  private retirer(rig: { racine: THREE.Object3D; copies: Map<THREE.Material, THREE.Material> }): void {
    const original = (m: THREE.Material) => rig.copies.get(m) ?? m
    rig.racine.traverse((objet) => {
      if (!(objet instanceof THREE.Mesh)) return
      objet.material = Array.isArray(objet.material) ? objet.material.map(original) : original(objet.material)
    })
    for (const copie of rig.copies.keys()) { this.copies.delete(copie); copie.dispose() }
    rig.copies.clear()
  }

  /**
   * appliquer applies the painted copies onto meshes whose material is in `coat`. Copies applied
   * before (inherited, the coating that was waiting for its replacement) stop being referenced:
   * they are disposed.
   */
  private appliquer(rig: { racine: THREE.Object3D; copies: Map<THREE.Material, THREE.Material> }, coat: Coat): void {
    const précédentes = [...rig.copies.keys()]
    // The weapon's energy fields (the sword's blade) glow in the emissive swatch of the weapon's
    // own paint, never the armor's (`energyField3d`).
    const teinte = energyTintOf(coat, (m) => !!m.userData.rigWeapon)
    rig.racine.traverse((objet) => {
      if (!(objet instanceof THREE.Mesh)) return
      const peindre = (m: THREE.Material) => {
        // The rig may carry the previous coating: the coating is read against the original
        // material (the coat's keys are the originals).
        const original = this.materiauSource(m)
        const peinture = coat.get(original)
        if (!peinture && teinte && isEnergized(original)) {
          const champ = energyCopy(original, teinte)
          this.copies.set(champ, original)
          rig.copies.set(champ, original)
          return champ
        }
        if (!peinture || !(original instanceof THREE.MeshStandardMaterial)) return m
        const copie = armorMaterial(original, peinture)
        this.source.baked?.apply(copie)
        this.copies.set(copie, original)
        rig.copies.set(copie, original)
        return copie
      }
      objet.material = Array.isArray(objet.material) ? objet.material.map(peindre) : peindre(objet.material)
    })
    // Replaced copies are no longer on the rig: they are disposed. Those remaining on an
    // invisible mesh (default arms hidden by a piece, outside the coating) are kept: their
    // source material is painted, they're disposed when the rig is removed.
    for (const ancienne of précédentes) {
      let enUsage = false
      rig.racine.traverse((objet) => {
        if (enUsage || !(objet instanceof THREE.Mesh)) return
        for (const m of Array.isArray(objet.material) ? objet.material : [objet.material]) if (m === ancienne) { enUsage = true; return }
      })
      if (!enUsage) { this.copies.delete(ancienne); rig.copies.delete(ancienne); ancienne.dispose() }
    }
  }
}

/**
 * materiauxPeinturables: the root's visible arm materials (raw masks, style), each once: the
 * rig's and those of placed pieces. `source` maps an applied copy back to its original material
 * (the coating is computed on originals, even if the rig still carries the previous coating).
 */
function materiauxPeinturables(racine: THREE.Object3D, source: (m: THREE.Material) => THREE.Material = (m) => m): THREE.Material[] {
  const result: THREE.Material[] = []
  racine.traverse((objet) => {
    if (!(objet instanceof THREE.Mesh) || !objet.visible) return
    for (const m of Array.isArray(objet.material) ? objet.material : [objet.material]) {
      const original = source(m)
      if (estMateriauPeint(original) && original.userData.style && !result.includes(original)) result.push(original)
    }
  })
  return result
}
