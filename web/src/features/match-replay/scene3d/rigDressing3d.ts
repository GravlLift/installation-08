// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * rigDressing3d.ts — THE TRACKED PLAYER'S ARM PIECES ON THE FIRST-PERSON RIG.
 *
 * The rig carries its default arms; `RigDressing3d` replaces them with the player's own
 * pieces: the scenes (`ArmPieces3d`) are bound to the rig's bones (`lierPiece`) and placed on
 * its root, the default arms (arm material, read through `RigPaint3d`'s copies) are hidden.
 * The key (rig, player, manifest) avoids re-placing; a generation abandons a late load when the
 * player changes. Each rig keeps its pieces until the player changes.
 */
import * as THREE from 'three'
import type { LoadGate } from './loadGate3d'

import { ArmPieces3d, lierPiece, planBras, type BrasIndex } from './armPieces3d'
import { estMateriauBras } from './firstPersonArms3d'
import type { SpartanArmory } from './armory3d'

/** What the dressing reads from `FirstPersonArms3d`. */
export interface SourceHabillage {
  /** The arm piece catalog, fetched once. */
  indexPieces: Promise<BrasIndex | null>
  chargeur: ArmPieces3d
  /** The view's abort signal: a load in progress is abandoned. */
  signal: AbortSignal
  armurerie(): SpartanArmory | null
  xuid(): string | null
  /** A placed material's source material (paint copies). */
  materiauSource(materiau: THREE.Material): THREE.Material
  /** The pieces are placed: the rig's paint must be redone. */
  invaliderPeinture(fichier: string): void
  termine?(fichier: string, racine: THREE.Object3D): void
  gate?: LoadGate
}

/**
 * RigDressing3d: places the tracked player's arm pieces on the first-person rigs;
 * `changerJoueur` abandons the load in progress, removes the placed pieces, and restores the
 * default arms.
 */
export class RigDressing3d {
  private readonly rigs = new Map<string, { key: string; loading: boolean; loaded: THREE.SkinnedMesh[]; hidden: THREE.Object3D[] }>()
  private generation = 0
  private readonly source: SourceHabillage

  constructor(source: SourceHabillage) {
    this.source = source
  }

  /** Is the dressing currently loading (a switch must wait)? */
  enCours(fichier?: string): boolean { return fichier ? !!this.rigs.get(fichier)?.loading : [...this.rigs.values()].some((rig) => rig.loading) }

  /** The player changes (or the view is released): abandon the load in progress and remove the pieces. */
  changerJoueur(): void {
    this.generation++
    for (const rig of this.rigs.values()) this.retirer(rig)
    this.rigs.clear()
  }

  /**
   * actualiser places the tracked player's pieces on rig `fichier`: nothing if the key (rig,
   * player, manifest) is already placed. The default arms hide before placement (same
   * materials).
   */
  actualiser(fichier: string, racine: THREE.Object3D): void {
    const xuid = this.source.xuid()
    const regions = xuid ? this.source.armurerie()?.regions(xuid) ?? null : null
    const key = `${fichier}|${xuid ?? ''}|${regions ? 'manifest' : 'default'}`
    const previous = this.rigs.get(fichier)
    if (key === previous?.key) return
    if (previous) this.retirer(previous)
    const rig = { key, loading: true, loaded: [] as THREE.SkinnedMesh[], hidden: [] as THREE.Object3D[] }
    this.rigs.set(fichier, rig)
    const generation = this.generation
    const loading = this.source.indexPieces.then(async (index) => {
      if (!index || generation !== this.generation || this.rigs.get(fichier) !== rig) return
      const scenes = await Promise.all(planBras(index, regions).map((piece) => this.source.chargeur.piece(piece.file)))
      if (generation !== this.generation || this.rigs.get(fichier) !== rig || this.source.signal.aborted) return
      const meshes: THREE.SkinnedMesh[] = []
      for (const scene of scenes) if (scene) meshes.push(...lierPiece(scene, racine))
      if (!meshes.length) return
      // The default arms hide BEFORE placement: the pieces carry the same materials.
      this.cacherBrasIntegres(racine, rig.hidden)
      for (const mesh of meshes) racine.add(mesh)
      rig.loaded = meshes
      // The pieces add materials the paint must cover.
      this.source.invaliderPeinture(fichier)
    }).catch((error: unknown) => console.warn('3D replay: arm pieces unavailable', error))
      .finally(() => {
        if (generation === this.generation && this.rigs.get(fichier) === rig) {
          rig.loading = false
          this.source.termine?.(fichier, racine)
        }
      })
    void (this.source.gate?.track(loading) ?? loading)
  }

  /** retirer removes the placed pieces (their skeletons are released) and restores their default arms. */
  private retirer(rig: { loaded: THREE.SkinnedMesh[]; hidden: THREE.Object3D[] }): void {
    for (const mesh of rig.loaded) {
      mesh.removeFromParent()
      mesh.skeleton.dispose()
    }
    for (const object of rig.hidden) object.visible = true
  }

  /** cacherBrasIntegres hides the rig's default arm meshes (arm material). */
  private cacherBrasIntegres(racine: THREE.Object3D, hidden: THREE.Object3D[]): void {
    racine.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.visible) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      if (!materials.some((m) => estMateriauBras(this.source.materiauSource(m)))) return
      object.visible = false
      hidden.push(object)
    })
  }
}
