// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * rigPaint3d.ts — PAINTING THE FOLLOWED PLAYER'S FIRST-PERSON RIG ARMS.
 *
 * The loaded rig is neutral; `RigPaint3d` applies the player's paint (coating and visor,
 * `SpartanArmory.paintArms`) by material COPY, onto the rig's arm materials and those of
 * pieces placed by `RigDressing3d`: the original stays the loader's. The (rig file, outfit)
 * pair avoids repainting every frame; each rig keeps its copies, and a generation counter
 * abandons a late-arriving paint when the player changes. A background-prepared coating
 * (`RigPreparation3d`) applies with no wait when it's ready; otherwise painting is computed in
 * the background. `invalidate` forces a repaint: pieces that just arrived carry materials the
 * applied paint doesn't cover. The rig's weapon paints from its own coating: `weaponKeyFor` names
 * its model key to `paintArms`. The applied coating stays on the rig WHILE the next one is
 * computed: the held weapon is never shown unpainted (the rig is often hidden — scope — when
 * repainting starts, and shows again before the new one arrives). Only the absence of an outfit
 * (or a player change) clears the previous one.
 */
import * as THREE from 'three'
import type { LoadGate } from './loadGate3d'

import { armorMaterial } from './armorMaterial3d'
import type { Dress, SpartanArmory } from './armory3d'
import { isPaintedMaterial, samePaint } from './firstPersonArms3d'
import type { BakedLight } from './bakedLightShader'
import type { Coat } from './armorCoat3d'
import { energyCopy, energyTintOf, isEnergized } from './energyField3d'
import type { RigPreparation3d } from './rigPreparation3d'

/** What painting reads from `FirstPersonArms3d`. */
export interface SourcePaint {
  armory(): SpartanArmory | null
  xuid(): string | null
  /** The weapon model key of the rig with file `file`, null with no model loaded for it. */
  weaponKeyFor(file: string): string | null
  /** The background preparation: the ready coating, by rig file. */
  preparation: RigPreparation3d
  gate?: LoadGate
  /** The map's baked light, grafted onto painted copies (it composes with the painted material's patch). */
  baked?: BakedLight | null
}

/**
 * RigPaint3d: applies the followed player's paint onto the first-person rigs; `changePlayer`
 * abandons an in-progress paint and restores the original materials. `invalidate` marks the rig
 * to redo WITHOUT clearing the applied coating: the next one replaces it on arrival.
 */
export class RigPaint3d {
  private readonly rigs = new Map<string, { root: THREE.Object3D; outfit: Dress | null; busy: boolean; stale: boolean; copies: Map<THREE.Material, THREE.Material> }>()
  private generation = 0
  private readonly copies = new Map<THREE.Material, THREE.Material>()
  private readonly source: SourcePaint

  constructor(source: SourcePaint) {
    this.source = source
  }

  /** Is the paint currently being computed (a switch must wait)? */
  busy(file?: string): boolean { return file ? !!this.rigs.get(file)?.busy : [...this.rigs.values()].some((rig) => rig.busy) }

  /** A painted material's source material (its copy), itself if it isn't a copy. */
  sourceMaterial(material: THREE.Material): THREE.Material { return this.copies.get(material) ?? material }

  /** The applied painted copies (nothing with no paint): the environment probe attaches to them. */
  paintedMaterials(): THREE.Material[] { return [...this.copies.keys()] }

  /**
   * Arm pieces just arrived: the applied paint no longer covers them, it is redone on the next
   * `refresh`. The applied coating stays in place until the next one arrives: the rig's
   * weapon (often hidden by the scope here) is never shown with the neutral material.
   */
  invalidate(file: string): void {
    const rig = this.rigs.get(file)
    if (rig) rig.stale = true
  }

  /** The player changes (or the view is released): abandons an in-progress paint and restores materials. */
  changePlayer(): void {
    this.generation++
    for (const rig of this.rigs.values()) this.remove(rig)
    this.rigs.clear()
  }

  /**
   * refresh applies the followed player's paint onto rig `file`: nothing if the (file,
   * outfit) pair is already applied and the rig isn't invalid, or with no outfit. A prepared
   * coating applies with no wait; otherwise paint is computed in the background, abandoned if
   * the player changes before it lands. The previously applied coating stays on the rig during
   * this computation: it is replaced when the next one arrives, never cleared beforehand (the
   * held weapon is never shown unpainted).
   */
  refresh(file: string, root: THREE.Object3D): void {
    const xuid = this.source.xuid()
    const outfit = xuid ? this.source.armory()?.dress(xuid) ?? null : null
    const previous = this.rigs.get(file)
    if (previous && !previous.stale && samePaint(file, file, outfit, previous.outfit)) return
    const armory = this.source.armory()
    const repaint = !!outfit && !!armory && !!xuid
    if (previous) {
      // With no new coating to apply, the rig returns to neutral; otherwise the applied coating
      // waits for its replacement (inherited copies are disposed when it arrives).
      if (!repaint) this.remove(previous)
      this.rigs.delete(file)
    }
    const rig = { root, outfit, busy: false, stale: false, copies: new Map<THREE.Material, THREE.Material>(previous && repaint ? previous.copies : []) }
    this.rigs.set(file, rig)
    if (!repaint) return
    const materials = paintableMaterials(root, (m) => this.sourceMaterial(m))
    if (!materials.length) return
    const preparedCoat = this.source.preparation.coat(file)
    // A prepared coating is only used if it covers EXACTLY the materials to paint: pieces
    // placed after it was prepared carry their own materials (the coating doesn't know them),
    // or a rig already painted made them invisible (the coating still carries them). Either
    // way it's stale: the paint is recomputed.
    if (preparedCoat && materials.length > 0 && materials.every((m) => preparedCoat.has(m)) && [...preparedCoat.keys()].every((m) => materials.includes(m))) {
      this.apply(rig, preparedCoat)
      return
    }
    if (preparedCoat) this.source.preparation.abandon(file)
    const generation = this.generation
    rig.busy = true
    const loading = armory
      .paintArms(xuid, outfit, materials, this.source.weaponKeyFor(file))
      .then((coat) => {
        // A computed coat lands only if it still covers EVERY paintable material of the rig: the
        // piece that arrived while it was in flight replaced the materials it was computed on,
        // and landing the stale coat would paint the old materials and leave the new ones
        // neutral. The guard keeps the last known-good coat on the rig meanwhile.
        if (!coat || generation !== this.generation || this.rigs.get(file) !== rig) return
        const materials = paintableMaterials(root, (m) => this.sourceMaterial(m))
        if (!materials.every((m) => coat.has(m))) return
        rig.stale = false
        this.apply(rig, coat)
      })
      .catch((error: unknown) => console.warn('3D replay: arm paint unavailable', error))
      .finally(() => {
        if (generation === this.generation && this.rigs.get(file) === rig) rig.busy = false
      })
    void (this.source.gate?.track(loading) ?? loading)
  }

  /** remove restores a rig's original materials and disposes of its painted copies. */
  private remove(rig: { root: THREE.Object3D; copies: Map<THREE.Material, THREE.Material> }): void {
    const original = (m: THREE.Material) => rig.copies.get(m) ?? m
    rig.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.material = Array.isArray(object.material) ? object.material.map(original) : original(object.material)
    })
    for (const copy of rig.copies.keys()) { this.copies.delete(copy); copy.dispose() }
    rig.copies.clear()
  }

  /**
   * apply applies the painted copies onto meshes whose material is in `coat`. Copies applied
   * before (inherited, the coating that was waiting for its replacement) stop being referenced:
   * they are disposed.
   */
  private apply(rig: { root: THREE.Object3D; copies: Map<THREE.Material, THREE.Material> }, coat: Coat): void {
    const previousCopies = [...rig.copies.keys()]
    // The weapon's energy fields (the sword's blade) glow in the emissive swatch of the weapon's
    // own paint, never the armor's (`energyField3d`).
    const tint = energyTintOf(coat, (m) => !!m.userData.rigWeapon)
    rig.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const paint = (m: THREE.Material) => {
        // The rig may carry the previous coating: the coating is read against the original
        // material (the coat's keys are the originals).
        const original = this.sourceMaterial(m)
        const paintFor = coat.get(original)
        if (!paintFor && tint && isEnergized(original)) {
          const field = energyCopy(original, tint)
          this.copies.set(field, original)
          rig.copies.set(field, original)
          return field
        }
        if (!paintFor || !(original instanceof THREE.MeshStandardMaterial)) return m
        const copy = armorMaterial(original, paintFor)
        this.source.baked?.apply(copy)
        this.copies.set(copy, original)
        rig.copies.set(copy, original)
        return copy
      }
      object.material = Array.isArray(object.material) ? object.material.map(paint) : paint(object.material)
    })
    // Replaced copies are no longer on the rig: they are disposed. Those remaining on an
    // invisible mesh (default arms hidden by a piece, outside the coating) are kept: their
    // source material is painted, they're disposed when the rig is removed.
    for (const old of previousCopies) {
      let inUse = false
      rig.root.traverse((object) => {
        if (inUse || !(object instanceof THREE.Mesh)) return
        for (const m of Array.isArray(object.material) ? object.material : [object.material]) if (m === old) { inUse = true; return }
      })
      if (!inUse) { this.copies.delete(old); rig.copies.delete(old); old.dispose() }
    }
  }
}

/**
 * paintableMaterials: the root's visible arm materials (raw masks, style), each once: the
 * rig's and those of placed pieces. `source` maps an applied copy back to its original material
 * (the coating is computed on originals, even if the rig still carries the previous coating).
 */
function paintableMaterials(root: THREE.Object3D, source: (m: THREE.Material) => THREE.Material = (m) => m): THREE.Material[] {
  const result: THREE.Material[] = []
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return
    for (const m of Array.isArray(object.material) ? object.material : [object.material]) {
      const original = source(m)
      if (isPaintedMaterial(original) && original.userData.style && !result.includes(original)) result.push(original)
    }
  })
  return result
}
