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
 * Le revêtement posé reste sur le rig PENDANT le calcul du suivant : l'arme en main n'est jamais
 * montrée sans revêtement (le rig est souvent caché — lunette — quand le repeintage démarre, et se
 * remontre avant l'arrivée du nouveau). Seule l'absence d'habit (ou le changement de joueur) efface
 * le précédent.
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
 * abandonne la peinture en cours et restaure les matériaux d'origine. `invalider` marque le rig à
 * refaire SANS effacer le revêtement posé : le suivant le remplace à son arrivée.
 */
export class PeintureRig3d {
  private readonly rigs = new Map<string, { racine: THREE.Object3D; habit: Dress | null; enCours: boolean; stale: boolean; copies: Map<THREE.Material, THREE.Material> }>()
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

  /**
   * Les pièces de bras viennent d'arriver : la peinture posée ne les couvre plus, elle se refait au
   * prochain `actualiser`. Le revêtement posé reste en place jusqu'à l'arrivée du suivant : l'arme
   * du rig (souvent cachée par la lunette ici) n'est jamais montrée au matériau neutre.
   */
  invalider(fichier: string): void {
    const rig = this.rigs.get(fichier)
    if (rig) rig.stale = true
  }

  /** Le joueur change (ou la vue se libère) : abandonne la peinture en cours et restaure les matériaux. */
  changerJoueur(): void {
    this.generation++
    for (const rig of this.rigs.values()) this.retirer(rig)
    this.rigs.clear()
  }

  /**
   * actualiser pose la peinture du joueur suivi sur le rig `fichier` : rien si le couple (fichier,
   * habit) est déjà posé et le rig non invalide, ou sans habit. Le revêtement préparé se pose sans
   * attente ; sinon la peinture se calcule en fond, abandonnée si le joueur change avant. Le
   * revêtement posé auparavant reste sur le rig pendant ce calcul : il est remplacé à l'arrivée
   * du suivant, jamais effacé avant (l'arme en main ne se montre jamais sans revêtement).
   */
  actualiser(fichier: string, racine: THREE.Object3D): void {
    const xuid = this.source.xuid()
    const habit = xuid ? this.source.armurerie()?.dress(xuid) ?? null : null
    const precedent = this.rigs.get(fichier)
    if (precedent && !precedent.stale && memePeinture(fichier, fichier, habit, precedent.habit)) return
    const armurerie = this.source.armurerie()
    const repeindre = !!habit && !!armurerie && !!xuid
    if (precedent) {
      // Sans nouveau revêtement à poser, le rig revient au neutre ; sinon le revêtement posé
      // attend son remplaçant (les copies héritées sont disposées quand celui-ci arrive).
      if (!repeindre) this.retirer(precedent)
      this.rigs.delete(fichier)
    }
    const rig = { racine, habit, enCours: false, stale: false, copies: new Map<THREE.Material, THREE.Material>(precedent && repeindre ? precedent.copies : []) }
    this.rigs.set(fichier, rig)
    if (!repeindre) return
    const materiaux = materiauxPeinturables(racine, (m) => this.materiauSource(m))
    if (!materiaux.length) return
    const coatPreparé = this.source.preparation.coat(fichier)
    // Le revêtement préparé ne sert que s'il couvre EXACTEMENT les matériaux à peindre : les
    // pièces posées après sa préparation portent leurs propres matériaux (le revêtement ne les
    // connaît pas), ou un rig déjà peint les a rendus invisibles (le revêtement les porte encore).
    // Dans les deux cas il est obsolète : la peinture se recalcule.
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

  /**
   * appliquer pose les copies peintes sur les maillages dont le matériau est dans `coat`. Les copies
   * posées auparavant (héritées, le revêtement qui attendait son remplaçant) cessent d'être
   * référencées : elles sont disposées.
   */
  private appliquer(rig: { racine: THREE.Object3D; copies: Map<THREE.Material, THREE.Material> }, coat: Coat): void {
    const précédentes = [...rig.copies.keys()]
    // The weapon's energy fields (the sword's blade) glow in the emissive swatch of the weapon's
    // own paint, never the armor's (`energyField3d`).
    const teinte = energyTintOf(coat, (m) => !!m.userData.rigWeapon)
    rig.racine.traverse((objet) => {
      if (!(objet instanceof THREE.Mesh)) return
      const peindre = (m: THREE.Material) => {
        // Le rig peut porter le revêtement précédent : le revêtement se lit sur le matériau
        // d'origine (les clés du coat sont les originaux).
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
    // Les copies remplacées ne sont plus sur le rig : elles sont disposées. Celles qui restent sur
    // un maillage invisible (bras embarqués masqués par une pièce, hors du revêtement) sont
    // gardées : leur matériau source est peint, elles se disposent au retrait du rig.
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
 * materiauxPeinturables : les matériaux de bras de la racine (masques bruts, style) visibles, une
 * fois chacun : ceux du rig et ceux des pièces posées. `source` ramène une copie posée à son
 * matériau d'origine (le revêtement se calcule sur les originaux, même si le rig porte encore le
 * revêtement précédent).
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
