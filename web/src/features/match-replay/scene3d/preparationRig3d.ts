/**
 * preparationRig3d.ts — LA PRÉPARATION EN FOND DES RIGS DE PREMIÈRE PERSONNE DU JOUEUR SUIVI.
 *
 * Les pièces de bras du joueur (`BrasPieces3d`) et les revêtements des rigs se préparent en fond,
 * un lot à la fois. Chaque revêtement est propre à son fichier et peut être posé seulement s'il
 * couvre tous les matériaux du rig habillé. Un changement de joueur vide la préparation.
 */
import type * as THREE from 'three'

import type { Coat } from './armorCoat3d'
import type { SpartanArmory } from './armory3d'
import { planBras, type BrasIndex } from './brasPieces3d'

/** Les accès que la préparation demande à `BrasPremierePersonne3d`. */
export interface SourcePreparation {
  /** Les fichiers des rigs chargés. */
  fichiersCharges(): string[]
  /** Les matériaux de bras d'un rig chargé. */
  materiauxDe(fichier: string): THREE.Material[]
  indexPieces(): Promise<BrasIndex | null>
  /** La scène d'une pièce de bras, par le cache de `BrasPieces3d`. */
  piece(fichier: string): Promise<THREE.Object3D | null>
  armurerie(): SpartanArmory | null
  xuid(): string | null
}

/**
 * PreparationRig3d : prépare en fond les rigs du joueur suivi. Les pièces se préchargent une fois
 * par lot (elles sont les mêmes pour tous les rigs) ; la peinture se précalcule par fichier de
 * rig, pour être posée sans attente à la bascule.
 */
export class PreparationRig3d {
  private readonly source: SourcePreparation
  private readonly coats = new Map<string, Coat>()
  private fil: string[] = []
  private enCours = false
  private generation = 0

  constructor(source: SourcePreparation) { this.source = source }

  /** Le revêtement préparé pour un fichier de rig, null sinon (la peinture se calcule à la bascule). */
  coat(fichier: string): Coat | null { return this.coats.get(fichier) ?? null }

  /** Le joueur suivi change : prépare ses rigs chargés, et ceux qui chargeront après. */
  changerJoueur(): void {
    this.generation++
    this.coats.clear()
    this.fil = this.source.fichiersCharges()
    this.poursuivre()
  }

  /** Un rig vient de charger : il entre dans la file, s'il n'y est pas déjà. */
  rigCharge(fichier: string): void {
    if (!this.fil.includes(fichier)) this.fil.push(fichier)
    this.poursuivre()
  }

  /** Un lot à la fois ; sans joueur suivi, rien ne se prépare (la file attend). */
  private poursuivre(): void {
    if (this.enCours || !this.fil.length || !this.source.xuid()) return
    this.enCours = true
    const lot = this.fil.splice(0)
    const finir = () => { this.enCours = false; this.poursuivre() }
    void this.preparer(lot).then(finir, finir)
  }

  private async preparer(lot: string[]): Promise<void> {
    const generation = this.generation
    const armurerie = this.source.armurerie()
    const xuid = this.source.xuid()
    if (!armurerie || !xuid) return
    const index = await this.source.indexPieces()
    if (index) await Promise.all(planBras(index, armurerie.regions(xuid)).map((p) => this.source.piece(p.file)))
    const habit = armurerie.dress(xuid)
    if (!habit) return
    for (const fichier of lot) {
      const coat = await armurerie.peindreBras(xuid, habit, this.source.materiauxDe(fichier))
      if (coat && generation === this.generation && this.source.xuid() === xuid) this.coats.set(fichier, coat)
    }
  }
}
