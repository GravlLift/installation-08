// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * spartan3d.ts — A PLAYER'S SPARTAN COPY: the game's skinned model (`WeaponModels.spartan`)
 * cloned with its skeleton, its driven bones (`pose3d`) bound to the source's game clips
 * (`clips3d.spartanClipsOf`, `clipSample3d.ClipRig`). Its materials are copies: in the team
 * tint for the default armor; dressed in the player's armor, painted with its coating
 * (`armorMaterial3d`), the others (decals) as is. The team reads from the team outline
 * (`outline3d`).
 *
 * The copy shares geometries and textures with the source (released by `WeaponModels.dispose`)
 * and, dressed in the player's armor, with the piece library (`armorLibrary3d`); it owns its
 * tinted materials and its skeletons, which `releaseSpartan` releases. Meshes bound to the
 * same skin, armor pieces included, share ONE skeleton: it is only recomputed once per frame.
 */
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'

import type { CoatPaint } from './armorCoat3d'
import { ARMURE_NEUTRE, RUGOSITE_ARMURE_NEUTRE, armorMaterial } from './armorMaterial3d'
import type { Dress } from './armory3d'
import type { BakedLight } from './bakedLightShader'
import { spartanClipsOf } from './clips3d'
import { ClipRig } from './clipSample3d'
import { rigSpartan, type SpartanRig } from './pose3d'
import { dressSpartan } from './spartanArmor3d'

export interface SpartanCopy {
  source: THREE.Object3D
  rig: SpartanRig
  materials: THREE.Material[]
  skeletons: THREE.Skeleton[]
}

/**
 * copySpartan: a copy of `source`, dressed in the player's outfit `dress` (`spartanArmor3d`,
 * painted) when given, otherwise in the model's default armor tinted to team `tint`; null if
 * `source` doesn't have the Spartan's bones. `baked`: the map's baked light, grafted onto its
 * materials (it composes with the painted material's patch, `bakedLightShader.apply`).
 */
export function copySpartan(source: THREE.Object3D, tint: THREE.Color, dress: Dress | null = null, baked: BakedLight | null = null): SpartanCopy | null {
  const root = cloneSkinned(source)
  const skeletons = shareSkeletons(root)
  const dressed = dress !== null && skeletons.length === 1 && dressSpartan(root, skeletons[0], dress.outfit)
  if (dress && skeletons.length !== 1) console.warn('3D replay: the Spartan copy carries several skeletons, default armor')
  // A skinned mesh's bounding sphere dates from its rest pose: a body that falls or stretches
  // out grows past it, and would be culled out of view while still in it. Copies are always drawn.
  root.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) o.frustumCulled = false
  })
  const rig = rigOf(root, source)
  if (!rig) {
    for (const s of skeletons) s.dispose()
    return null
  }
  const materials = dressed ? copyMaterials(root, (m) => paintMaterial(m, dress.coat.get(m))) : copyMaterials(root, (m) => tinted(m, tint))
  if (baked) for (const m of materials) baked.apply(m)
  return { source, rig, materials, skeletons }
}

/** rigOf: `root`'s (a copy of `source`) driven bones, bound to the source's clips if it has any. */
export function rigOf(root: THREE.Object3D, source: THREE.Object3D): SpartanRig | null {
  const clips = spartanClipsOf(source)
  return rigSpartan(root, clips ? new ClipRig(root, clips) : null)
}

/** releaseSpartan removes the copy from the scene and releases its materials and skeletons. */
export function releaseSpartan(copy: SpartanCopy): void {
  copy.rig.root.removeFromParent()
  for (const m of copy.materials) m.dispose()
  for (const s of copy.skeletons) s.dispose()
}

/** The team tint's share in the default armor: the neutral gray dominates, the team shows through. */
const DEFAULT_ARMOR_TEAM_SHARE = 0.3

/**
 * tinted: a copy of `m` for the default armor (a player whose armor is not known): the
 * unpainted pieces' neutral gray, pulled toward `tint`, matte and metal-free — readable under
 * any light, with no dependence on the model's base color.
 */
function tinted(m: THREE.Material, tint: THREE.Color): THREE.Material {
  const c = m.clone()
  if (c instanceof THREE.MeshStandardMaterial) {
    c.map = null
    c.color.setScalar(ARMURE_NEUTRE).lerp(tint, DEFAULT_ARMOR_TEAM_SHARE)
    c.roughness = RUGOSITE_ARMURE_NEUTRE
    c.metalness = 0
  }
  return c
}

/**
 * paintMaterial: a copy of `m` painted with `paint`; with no paint (a material the view does
 * not paint), a plain copy.
 */
function paintMaterial(m: THREE.Material, paint: CoatPaint | undefined): THREE.Material {
  if (!paint || !(m instanceof THREE.MeshStandardMaterial)) return m.clone()
  return armorMaterial(m, paint)
}

/**
 * copyMaterials replaces each of `root`'s materials with its copy `copy` (one per source
 * material); returns the copies.
 */
function copyMaterials(root: THREE.Object3D, copy: (m: THREE.Material) => THREE.Material): THREE.Material[] {
  const copies = new Map<THREE.Material, THREE.Material>()
  const swap = (m: THREE.Material): THREE.Material => {
    let c = copies.get(m)
    if (!c) {
      c = copy(m)
      copies.set(m, c)
    }
    return c
  }
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const mesh = o as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material)
  })
  return [...copies.values()]
}

/**
 * shareSkeletons binds each of `root`'s skinned meshes to the first skeleton with the same
 * bones and the same bind matrices; returns the remaining skeletons (the ones the copy owns).
 */
function shareSkeletons(root: THREE.Object3D): THREE.Skeleton[] {
  const kept: THREE.Skeleton[] = []
  const dropped = new Set<THREE.Skeleton>()
  root.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return
    const own = o.skeleton
    if (kept.includes(own)) return
    const twin = kept.find((s) => sameSkin(own, s))
    if (!twin) {
      kept.push(own)
      return
    }
    dropped.add(own)
    o.bind(twin, o.bindMatrix)
  })
  for (const s of dropped) s.dispose()
  return kept
}

function sameSkin(a: THREE.Skeleton, b: THREE.Skeleton): boolean {
  if (a.bones.length !== b.bones.length) return false
  return a.bones.every((bone, i) => bone === b.bones[i] && a.boneInverses[i].equals(b.boneInverses[i]))
}
