// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * rigDressing3d.ts — THE TRACKED PLAYER'S ARM PIECES ON THE FIRST-PERSON RIG.
 *
 * The rig carries its default arms; `RigDressing3d` replaces them with the player's own
 * pieces: the scenes (`ArmPieces3d`) are bound to the rig's bones (`attachPiece`) and placed on
 * its root, the default arms (arm material, read through `RigPaint3d`'s copies) are hidden.
 * The key (rig, player, manifest) avoids re-placing; a generation abandons a late load when the
 * player changes. Each rig keeps its pieces until the player changes.
 */
import * as THREE from 'three'
import type { LoadGate } from './loadGate3d'

import { ArmPieces3d, attachPiece, armPlan, type ArmIndex } from './armPieces3d'
import { isArmMaterial } from './firstPersonArms3d'
import type { SpartanArmory } from './armory3d'

/** What the dressing reads from `FirstPersonArms3d`. */
export interface SourceDressing {
  /** The arm piece catalog, fetched once. */
  pieceIndex: Promise<ArmIndex | null>
  loader: ArmPieces3d
  /** The view's abort signal: a load in progress is abandoned. */
  signal: AbortSignal
  armory(): SpartanArmory | null
  xuid(): string | null
  /** A placed material's source material (paint copies). */
  sourceMaterial(material: THREE.Material): THREE.Material
  /** The pieces are placed: the rig's paint must be redone. */
  invalidatePaint(file: string): void
  done?(file: string, root: THREE.Object3D): void
  gate?: LoadGate
}

/**
 * RigDressing3d: places the tracked player's arm pieces on the first-person rigs;
 * `changePlayer` abandons the load in progress, removes the placed pieces, and restores the
 * default arms.
 */
export class RigDressing3d {
  private readonly rigs = new Map<string, { key: string; loading: boolean; loaded: THREE.SkinnedMesh[]; hidden: THREE.Object3D[] }>()
  private generation = 0
  private readonly source: SourceDressing

  constructor(source: SourceDressing) {
    this.source = source
  }

  /** Is the dressing currently loading (a switch must wait)? */
  busy(file?: string): boolean { return file ? !!this.rigs.get(file)?.loading : [...this.rigs.values()].some((rig) => rig.loading) }

  /** The player changes (or the view is released): abandon the load in progress and remove the pieces. */
  changePlayer(): void {
    this.generation++
    for (const rig of this.rigs.values()) this.remove(rig)
    this.rigs.clear()
  }

  /**
   * refresh places the tracked player's pieces on rig `file`: nothing if the key (rig,
   * player, manifest) is already placed. The default arms hide before placement (same
   * materials).
   */
  refresh(file: string, root: THREE.Object3D): void {
    const xuid = this.source.xuid()
    const regions = xuid ? this.source.armory()?.regions(xuid) ?? null : null
    const key = `${file}|${xuid ?? ''}|${regions ? 'manifest' : 'default'}`
    const previous = this.rigs.get(file)
    if (key === previous?.key) return
    if (previous) this.remove(previous)
    const rig = { key, loading: true, loaded: [] as THREE.SkinnedMesh[], hidden: [] as THREE.Object3D[] }
    this.rigs.set(file, rig)
    const generation = this.generation
    const loading = this.source.pieceIndex.then(async (index) => {
      if (!index || generation !== this.generation || this.rigs.get(file) !== rig) return
      const scenes = await Promise.all(armPlan(index, regions).map((piece) => this.source.loader.piece(piece.file)))
      if (generation !== this.generation || this.rigs.get(file) !== rig || this.source.signal.aborted) return
      const meshes: THREE.SkinnedMesh[] = []
      for (const scene of scenes) if (scene) meshes.push(...attachPiece(scene, root))
      if (!meshes.length) return
      // The default arms hide BEFORE placement: the pieces carry the same materials.
      this.hideBuiltInArms(root, rig.hidden)
      for (const mesh of meshes) root.add(mesh)
      rig.loaded = meshes
      // The pieces add materials the paint must cover.
      this.source.invalidatePaint(file)
    }).catch((error: unknown) => console.warn('3D replay: arm pieces unavailable', error))
      .finally(() => {
        if (generation === this.generation && this.rigs.get(file) === rig) {
          rig.loading = false
          this.source.done?.(file, root)
        }
      })
    void (this.source.gate?.track(loading) ?? loading)
  }

  /** remove removes the placed pieces (their skeletons are released) and restores their default arms. */
  private remove(rig: { loaded: THREE.SkinnedMesh[]; hidden: THREE.Object3D[] }): void {
    for (const mesh of rig.loaded) {
      mesh.removeFromParent()
      mesh.skeleton.dispose()
    }
    for (const object of rig.hidden) object.visible = true
  }

  /** hideBuiltInArms hides the rig's default arm meshes (arm material). */
  private hideBuiltInArms(root: THREE.Object3D, hidden: THREE.Object3D[]): void {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.visible) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      if (!materials.some((m) => isArmMaterial(this.source.sourceMaterial(m)))) return
      object.visible = false
      hidden.push(object)
    })
  }
}
