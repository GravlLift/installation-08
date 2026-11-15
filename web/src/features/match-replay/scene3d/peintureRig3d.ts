/**
 * peintureRig3d.ts — LA PEINTURE DES BRAS DU RIG DE PREMIÈRE PERSONNE DU JOUEUR SUIVI.
 *
 * Le rig chargé est neutre ; `PeintureRig3d` y pose la peinture du joueur (revêtement et visière,
 * `SpartanArmory.peindreBras`) par COPIE de matériau, sur les matériaux de bras du rig et ceux des
 * pièces posées par `habillageRig3d` : l'original reste celui du chargeur. Le couple (fichier de
 * rig, habit) évite de repeindre à chaque image ; chaque rig conserve ses copies et une génération abandonne une peinture en retard
 * quand le joueur change. Le revêtement préparé en fond (`PreparationRig3d`) se pose sans attente
 * quand il est prêt ; sinon la peinture se calcule en fond. `invalider` force un repeintage : les
 * pièces venues d'arriver portent des matériaux que la peinture posée ne couvre pas. L'arme du rig
 * se peint de son propre revêtement : `cleArmeDe` nomme sa clé de modèle à `peindreBras`.
 */
import * as THREE from 'three'
import type { LoadGate } from './loadGate3d'

import { armorMaterial } from './armorMaterial3d'
import type { Dress, SpartanArmory } from './armory3d'
import { estMateriauPeint, memePeinture } from './brasPremierePersonne3d'
import type { BakedLight } from './bakedLightShader'
import type { Coat } from './armorCoat3d'
import { energyCopy, energyTintOf, isEnergized } from './energyField3d'
import type { PreparationRig3d } from './preparationRig3d'

/** Ce que la peinture lit dans `BrasPremierePersonne3d`. */
export interface SourcePeinture {
  armurerie(): SpartanArmory | null
  xuid(): string | null
  /** La clé du modèle de l'arme du rig de fichier `fichier`, null sans modèle chargé pour lui. */
  cleArmeDe(fichier: string): string | null
  /** La préparation en fond : le revêtement prêt, par fichier de rig. */
  preparation: PreparationRig3d
  gate?: LoadGate
  /** La lumière cuite de la carte, greffée sur les copies peintes (elle compose avec le patch du matériau peint). */
  baked?: BakedLight | null
}

/**
 * PeintureRig3d : pose la peinture du joueur suivi sur les rigs de première personne ; `changerJoueur`
 * abandonne la peinture en cours et restaure les matériaux d'origine.
 */
export class PeintureRig3d {
  private readonly rigs = new Map<string, { racine: THREE.Object3D; habit: Dress | null; enCours: boolean; copies: Map<THREE.Material, THREE.Material> }>()
  private generation = 0
  private readonly copies = new Map<THREE.Material, THREE.Material>()
  private readonly source: SourcePeinture

  constructor(source: SourcePeinture) {
    this.source = source
  }

  /** La peinture est-elle en cours de calcul (une bascule doit attendre) ? */
  enCours(fichier?: string): boolean { return fichier ? !!this.rigs.get(fichier)?.enCours : [...this.rigs.values()].some((rig) => rig.enCours) }

  /** Le matériau source d'un matériau posé (sa copie), lui-même s'il n'est pas une copie. */
  materiauSource(materiau: THREE.Material): THREE.Material { return this.copies.get(materiau) ?? materiau }

  /** Les copies peintes posées (rien sans peinture) : la sonde d'environnement s'y attache. */
  materiauxPeints(): THREE.Material[] { return [...this.copies.keys()] }

  /** Les pièces de bras viennent d'arriver : la peinture posée ne les couvre plus, elle se refait. */
  invalider(fichier: string): void {
    const rig = this.rigs.get(fichier)
    if (rig) { this.retirer(rig); this.rigs.delete(fichier) }
  }

  /** Le joueur change (ou la vue se libère) : abandonne la peinture en cours et restaure les matériaux. */
  changerJoueur(): void {
    this.generation++
    for (const rig of this.rigs.values()) this.retirer(rig)
    this.rigs.clear()
  }

  /**
   * actualiser pose la peinture du joueur suivi sur le rig `fichier` : rien si le couple (fichier,
   * habit) est déjà posé, ou sans habit. Le revêtement préparé se pose sans attente ; sinon la
   * peinture se calcule en fond, abandonnée si le joueur change avant.
   */
  actualiser(fichier: string, racine: THREE.Object3D): void {
    const xuid = this.source.xuid()
    const habit = xuid ? this.source.armurerie()?.dress(xuid) ?? null : null
    const precedent = this.rigs.get(fichier)
    if (precedent && memePeinture(fichier, fichier, habit, precedent.habit)) return
    if (precedent) this.retirer(precedent)
    const rig = { racine, habit, enCours: false, copies: new Map<THREE.Material, THREE.Material>() }
    this.rigs.set(fichier, rig)
    const armurerie = this.source.armurerie()
    if (!habit || !armurerie || !xuid) return
    const materiaux = materiauxPeinturables(racine)
    if (!materiaux.length) return
    const coatPreparé = this.source.preparation.coat(fichier)
    // Le revêtement préparé ne sert que s'il couvre tous les matériaux à peindre : les pièces de
    // bras posées après sa préparation portent leurs propres matériaux, qu'il ne connaît pas.
    if (coatPreparé && materiaux.every((m) => coatPreparé.has(m))) {
      this.appliquer(rig, coatPreparé)
      return
    }
    const generation = this.generation
    rig.enCours = true
    const chargement = armurerie
      .peindreBras(xuid, habit, materiaux, this.source.cleArmeDe(fichier))
      .then((coat) => {
        if (!coat || generation !== this.generation || this.rigs.get(fichier) !== rig) return
        this.appliquer(rig, coat)
      })
      .catch((erreur: unknown) => console.warn('rejeu 3D : peinture des bras indisponible', erreur))
      .finally(() => {
        if (generation === this.generation && this.rigs.get(fichier) === rig) rig.enCours = false
      })
    void (this.source.gate?.track(chargement) ?? chargement)
  }

  /** retirer restaure les matériaux d'origine d'un rig et dispose de ses copies peintes. */
  private retirer(rig: { racine: THREE.Object3D; copies: Map<THREE.Material, THREE.Material> }): void {
    const original = (m: THREE.Material) => rig.copies.get(m) ?? m
    rig.racine.traverse((objet) => {
      if (!(objet instanceof THREE.Mesh)) return
      objet.material = Array.isArray(objet.material) ? objet.material.map(original) : original(objet.material)
    })
    for (const copie of rig.copies.keys()) { this.copies.delete(copie); copie.dispose() }
    rig.copies.clear()
  }

  /** appliquer pose les copies peintes sur les maillages dont le matériau est dans `coat`. */
  private appliquer(rig: { racine: THREE.Object3D; copies: Map<THREE.Material, THREE.Material> }, coat: Coat): void {
    // The weapon's energy fields (the sword's blade) glow in the emissive swatch of the weapon's
    // own paint, never the armor's (`energyField3d`).
    const teinte = energyTintOf(coat, (m) => !!m.userData.rigWeapon)
    rig.racine.traverse((objet) => {
      if (!(objet instanceof THREE.Mesh)) return
      const peindre = (m: THREE.Material) => {
        const peinture = coat.get(m)
        if (!peinture && teinte && isEnergized(m)) {
          const champ = energyCopy(m, teinte)
          this.copies.set(champ, m)
          rig.copies.set(champ, m)
          return champ
        }
        if (!peinture || !(m instanceof THREE.MeshStandardMaterial)) return m
        const copie = armorMaterial(m, peinture)
        this.source.baked?.apply(copie)
        this.copies.set(copie, m)
        rig.copies.set(copie, m)
        return copie
      }
      objet.material = Array.isArray(objet.material) ? objet.material.map(peindre) : peindre(objet.material)
    })
  }
}

/**
 * materiauxPeinturables : les matériaux de bras de la racine (masques bruts, style) visibles, une
 * fois chacun : ceux du rig et ceux des pièces posées.
 */
function materiauxPeinturables(racine: THREE.Object3D): THREE.Material[] {
  const result: THREE.Material[] = []
  racine.traverse((objet) => {
    if (!(objet instanceof THREE.Mesh) || !objet.visible) return
    for (const m of Array.isArray(objet.material) ? objet.material : [objet.material]) {
      if (estMateriauPeint(m) && m.userData.style && !result.includes(m)) result.push(m)
    }
  })
  return result
}
