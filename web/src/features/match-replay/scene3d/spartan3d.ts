/**
 * spartan3d.ts — LA COPIE DU SPARTAN D'UN JOUEUR : le modèle à peau du jeu (`WeaponModels.spartan`)
 * cloné avec son squelette, ses os pilotés (`pose3d`) et liés aux clips du jeu de la source
 * (`clips3d.spartanClipsOf`, `clipSample3d.ClipRig`). Ses matériaux sont des copies : à la teinte de
 * l'équipe pour l'armure par défaut ; habillée de l'armure du joueur, peintes de son revêtement
 * (`armorMaterial3d`), les autres (décalcomanies) telles quelles. Le camp se lit au contour d'équipe
 * (`outline3d`).
 *
 * La copie partage géométries et textures avec la source (libérées par `WeaponModels.dispose`) et,
 * habillée de l'armure du joueur, avec la bibliothèque des pièces (`armorLibrary3d`) ; elle possède
 * ses matériaux teints et ses squelettes, que `releaseSpartan` libère. Les maillages liés à la même
 * peau, pièces d'armure comprises, partagent UN squelette : il ne se recalcule qu'une fois par image.
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
 * copySpartan : une copie de `source`, habillée de l'habit `dress` du joueur (`spartanArmor3d`, peint)
 * quand il est donné, sinon de l'armure par défaut du modèle teinte à l'équipe `tint` ; null si
 * `source` n'a pas les os du Spartan. `baked` : la lumière cuite de la carte, greffée sur ses
 * matériaux (elle compose avec le patch du matériau peint, `bakedLightShader.apply`).
 */
export function copySpartan(source: THREE.Object3D, tint: THREE.Color, dress: Dress | null = null, baked: BakedLight | null = null): SpartanCopy | null {
  const root = cloneSkinned(source)
  const skeletons = shareSkeletons(root)
  const dressed = dress !== null && skeletons.length === 1 && dressSpartan(root, skeletons[0], dress.outfit)
  if (dress && skeletons.length !== 1) console.warn('rejeu 3D : la copie du Spartan porte plusieurs squelettes, armure par défaut')
  // La sphère englobante d'un maillage à peau date de sa pose de repos : un corps qui tombe ou
  // s'allonge en sort, et serait écarté du champ alors qu'il y est. Les copies se dessinent toujours.
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

/** rigOf : les os pilotés de la copie `root` de `source`, liés aux clips de la source s'il y en a. */
export function rigOf(root: THREE.Object3D, source: THREE.Object3D): SpartanRig | null {
  const clips = spartanClipsOf(source)
  return rigSpartan(root, clips ? new ClipRig(root, clips) : null)
}

/** releaseSpartan retire la copie de la scène et libère ses matériaux et ses squelettes. */
export function releaseSpartan(copy: SpartanCopy): void {
  copy.rig.root.removeFromParent()
  for (const m of copy.materials) m.dispose()
  for (const s of copy.skeletons) s.dispose()
}

/** La part de la teinte d'équipe dans l'armure par défaut : le gris neutre domine, le camp se devine. */
const DEFAULT_ARMOR_TEAM_SHARE = 0.3

/**
 * tinted : une copie de `m` pour l'armure par défaut (joueur dont l'armure n'est pas connue) : le
 * gris neutre des pièces non peintes, tiré vers `tint`, mat et sans métal — lisible sous toute
 * lumière, sans dépendre de la couleur de base du modèle.
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
 * paintMaterial : la copie de `m` peinte de `paint` ; sans peinture (matériau que la vue ne peint
 * pas), une simple copie.
 */
function paintMaterial(m: THREE.Material, paint: CoatPaint | undefined): THREE.Material {
  if (!paint || !(m instanceof THREE.MeshStandardMaterial)) return m.clone()
  return armorMaterial(m, paint)
}

/**
 * copyMaterials remplace chaque matériau de `root` par sa copie `copy` (une par matériau source) ;
 * rend les copies.
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
 * shareSkeletons lie chaque maillage à peau de `root` au premier squelette de mêmes os et mêmes
 * matrices de liaison ; rend les squelettes restants (ceux que la copie possède).
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
