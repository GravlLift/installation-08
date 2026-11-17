// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * habillageRig3d.ts — LES PIÈCES DE BRAS DU JOUEUR SUIVI SUR LE RIG DE PREMIÈRE PERSONNE.
 *
 * Le rig embarque ses bras par défaut ; `HabillageRig3d` les remplace par les pièces du joueur :
 * les scènes (`BrasPieces3d`) sont liées aux os du rig (`lierPiece`) et posées sur sa racine, les
 * bras embarqués (matériau de bras, lu à travers les copies de `peintureRig3d`) sont masqués. La
 * clé (rig, joueur, manifeste) évite de reposer ; une génération abandonne une charge en retard
 * quand le joueur change. Chaque rig conserve ses pièces jusqu'au changement de joueur.
 */
import * as THREE from 'three'
import type { LoadGate } from './loadGate3d'

import { BrasPieces3d, lierPiece, planBras, type BrasIndex } from './brasPieces3d'
import { estMateriauBras } from './brasPremierePersonne3d'
import type { SpartanArmory } from './armory3d'

/** Ce que l'habillage lit dans `BrasPremierePersonne3d`. */
export interface SourceHabillage {
  /** Le catalogue des pièces de bras, récupéré une fois. */
  indexPieces: Promise<BrasIndex | null>
  chargeur: BrasPieces3d
  /** L'interruption de la vue : une charge en cours s'abandonne. */
  signal: AbortSignal
  armurerie(): SpartanArmory | null
  xuid(): string | null
  /** Le matériau source d'un matériau posé (les copies de peinture). */
  materiauSource(materiau: THREE.Material): THREE.Material
  /** Les pièces sont posées : la peinture du rig doit se refaire. */
  invaliderPeinture(fichier: string): void
  termine?(fichier: string, racine: THREE.Object3D): void
  gate?: LoadGate
}

/**
 * HabillageRig3d : pose les pièces de bras du joueur suivi sur les rigs de première personne ;
 * `changerJoueur` abandonne la charge en cours, ôte les pièces posées et rend les bras embarqués.
 */
export class HabillageRig3d {
  private readonly rigs = new Map<string, { cle: string; enCours: boolean; chargees: THREE.SkinnedMesh[]; caches: THREE.Object3D[] }>()
  private generation = 0
  private readonly source: SourceHabillage

  constructor(source: SourceHabillage) {
    this.source = source
  }

  /** L'habillage est-il en cours de charge (une bascule doit attendre) ? */
  enCours(fichier?: string): boolean { return fichier ? !!this.rigs.get(fichier)?.enCours : [...this.rigs.values()].some((rig) => rig.enCours) }

  /** Le joueur change (ou la vue se libère) : abandonne la charge en cours et ôte les pièces. */
  changerJoueur(): void {
    this.generation++
    for (const rig of this.rigs.values()) this.retirer(rig)
    this.rigs.clear()
  }

  /**
   * actualiser pose les pièces du joueur suivi sur le rig `fichier` : rien si la clé (rig, joueur,
   * manifeste) est déjà posée. Les bras embarqués se cachent avant la pose (mêmes matériaux).
   */
  actualiser(fichier: string, racine: THREE.Object3D): void {
    const xuid = this.source.xuid()
    const regions = xuid ? this.source.armurerie()?.regions(xuid) ?? null : null
    const cle = `${fichier}|${xuid ?? ''}|${regions ? 'manifeste' : 'defaut'}`
    const precedent = this.rigs.get(fichier)
    if (cle === precedent?.cle) return
    if (precedent) this.retirer(precedent)
    const rig = { cle, enCours: true, chargees: [] as THREE.SkinnedMesh[], caches: [] as THREE.Object3D[] }
    this.rigs.set(fichier, rig)
    const generation = this.generation
    const chargement = this.source.indexPieces.then(async (index) => {
      if (!index || generation !== this.generation || this.rigs.get(fichier) !== rig) return
      const scenes = await Promise.all(planBras(index, regions).map((piece) => this.source.chargeur.piece(piece.file)))
      if (generation !== this.generation || this.rigs.get(fichier) !== rig || this.source.signal.aborted) return
      const maillages: THREE.SkinnedMesh[] = []
      for (const scene of scenes) if (scene) maillages.push(...lierPiece(scene, racine))
      if (!maillages.length) return
      // Les bras embarqués se cachent AVANT la pose : les pièces portent les mêmes matériaux.
      this.cacherBrasIntegres(racine, rig.caches)
      for (const maillage of maillages) racine.add(maillage)
      rig.chargees = maillages
      // Les pièces ajoutent des matériaux que la peinture doit couvrir.
      this.source.invaliderPeinture(fichier)
    }).catch((erreur: unknown) => console.warn('rejeu 3D : pièces de bras indisponibles', erreur))
      .finally(() => {
        if (generation === this.generation && this.rigs.get(fichier) === rig) {
          rig.enCours = false
          this.source.termine?.(fichier, racine)
        }
      })
    void (this.source.gate?.track(chargement) ?? chargement)
  }

  /** retirer ôte les pièces posées (leurs squelettes sont libérés) et rend leurs bras embarqués. */
  private retirer(rig: { chargees: THREE.SkinnedMesh[]; caches: THREE.Object3D[] }): void {
    for (const maillage of rig.chargees) {
      maillage.removeFromParent()
      maillage.skeleton.dispose()
    }
    for (const objet of rig.caches) objet.visible = true
  }

  /** cacherBrasIntegres masque les maillages de bras embarqués du rig (matériau de bras). */
  private cacherBrasIntegres(racine: THREE.Object3D, caches: THREE.Object3D[]): void {
    racine.traverse((objet) => {
      if (!(objet instanceof THREE.Mesh) || !objet.visible) return
      const materiaux = Array.isArray(objet.material) ? objet.material : [objet.material]
      if (!materiaux.some((m) => estMateriauBras(this.source.materiauSource(m)))) return
      objet.visible = false
      caches.push(objet)
    })
  }
}
