// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * rigPreparation3d.ts — THE BACKGROUND PREPARATION OF THE TRACKED PLAYER'S FIRST-PERSON RIGS.
 *
 * The player's arm pieces (`ArmPieces3d`) and the rigs' coats prepare in the background, one
 * batch at a time. Each coat is specific to its file and can only be applied once it covers all
 * of the dressed rig's materials. A player change clears the preparation.
 */
import type * as THREE from 'three'

import type { Coat } from './armorCoat3d'
import type { SpartanArmory } from './armory3d'
import { planBras, type BrasIndex } from './armPieces3d'

/** The accesses the preparation asks of `FirstPersonArms3d`. */
export interface SourcePreparation {
  /** The loaded rigs' files. */
  fichiersCharges(): string[]
  /** A loaded rig's arm materials. */
  materiauxDe(fichier: string): THREE.Material[]
  indexPieces(): Promise<BrasIndex | null>
  /** An arm piece's scene, through `ArmPieces3d`'s cache. */
  piece(fichier: string): Promise<THREE.Object3D | null>
  armurerie(): SpartanArmory | null
  xuid(): string | null
  /** The weapon model key for file `fichier`'s rig, null with no loaded model for it. */
  cleArmeDe(fichier: string): string | null
}

/**
 * RigPreparation3d: prepares the tracked player's rigs in the background. Pieces preload once
 * per batch (they are the same for every rig); the coat precomputes per rig file, so it can be
 * applied with no wait at the switch.
 */
export class RigPreparation3d {
  private readonly source: SourcePreparation
  private readonly coats = new Map<string, Coat>()
  private queue: string[] = []
  private running = false
  private generation = 0

  constructor(source: SourcePreparation) { this.source = source }

  /** The coat prepared for a rig file, null otherwise (the coat computes at the switch). */
  coat(fichier: string): Coat | null { return this.coats.get(fichier) ?? null }

  /**
   * abandonner: the prepared coat no longer covers the rig's materials (a piece was placed onto
   * it since it was prepared) — it no longer applies, the coat recomputes at the switch.
   */
  abandonner(fichier: string): void { this.coats.delete(fichier) }

  /** The tracked player changes: prepares their loaded rigs, and those that will load after. */
  changerJoueur(): void {
    this.generation++
    this.coats.clear()
    this.queue = this.source.fichiersCharges()
    this.advance()
  }

  /** A rig just loaded: it enters the queue, if not already in it. */
  rigCharge(fichier: string): void {
    if (!this.queue.includes(fichier)) this.queue.push(fichier)
    this.advance()
  }

  /** One batch at a time; with no tracked player, nothing prepares (the queue waits). */
  private advance(): void {
    if (this.running || !this.queue.length || !this.source.xuid()) return
    this.running = true
    const batch = this.queue.splice(0)
    const finish = () => { this.running = false; this.advance() }
    void this.prepare(batch).then(finish, finish)
  }

  private async prepare(batch: string[]): Promise<void> {
    const generation = this.generation
    const armory = this.source.armurerie()
    const xuid = this.source.xuid()
    if (!armory || !xuid) return
    const index = await this.source.indexPieces()
    if (index) await Promise.all(planBras(index, armory.regions(xuid)).map((p) => this.source.piece(p.file)))
    const dress = armory.dress(xuid)
    if (!dress) return
    for (const fichier of batch) {
      const coat = await armory.peindreBras(xuid, dress, this.source.materiauxDe(fichier), this.source.cleArmeDe(fichier))
      if (coat && generation === this.generation && this.source.xuid() === xuid) this.coats.set(fichier, coat)
    }
  }
}
