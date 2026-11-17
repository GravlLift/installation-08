// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * spartanSkeleton.ts — LE SQUELETTE DU SPARTAN DU JEU POUR LES TESTS : les 26 os que la pose
 * pilote ou traverse, avec leur position et leur orientation locales de repos telles que le GLB
 * `spartan` les porte (lues sur le GLB servi le 2026-11-09, axes glTF, unités du monde Halo). Les
 * repères de repos des os ne sont pas celui du modèle (comme dans le jeu) : c'est ce qui rend le
 * test des poses honnête. Les os sans rôle dans la pose (doigts, aides, armures) sont omis.
 *
 * Mesures de repos : bassin à 0,408 u, hanche 0,399, genou 0,233, cheville 0,051, orteil 0,016 ;
 * cuisse 0,168 u, mollet 0,186 u ; bras 0,105 u, avant-bras 0,092 u.
 */
import * as THREE from 'three'

type BoneRow = readonly [name: string, parent: string | null, t: readonly number[], q: readonly number[]]

const BONES: readonly BoneRow[] = [
  ['b_pedestal', null, [0, 0, 0], [0, 0, 0, 1]],
  ['b_pelvis', 'b_pedestal', [0.0081, 0.4079, 0], [0.7071, 0, 0, 0.7071]],
  ['b_spine1', 'b_pelvis', [-0.0013, 0, -0.0258], [-0.0004, -0.0004, -0.7071, -0.7071]],
  ['b_l_thigh', 'b_pelvis', [-0.0012, -0.043, 0.0087], [-0.0592, 0.042, -0.7085, -0.7019]],
  ['b_r_thigh', 'b_pelvis', [-0.0012, 0.043, 0.0087], [0.7085, 0.7019, -0.0592, 0.042]],
  ['b_r_calf', 'b_r_thigh', [0, 0, -0.1676], [-0.0818, 0, 0, 0.9966]],
  ['b_l_calf', 'b_l_thigh', [0, 0, 0.1676], [-0.0818, 0, 0, 0.9966]],
  ['b_spine2', 'b_spine1', [0, 0, -0.047], [0.0811, 0, 0, 0.9967]],
  ['b_l_foot', 'b_l_calf', [0, 0, 0.1857], [-0.6562, 0.1334, -0.0217, 0.7424]],
  ['b_spine3', 'b_spine2', [0, 0, -0.0362], [-0.0769, 0, 0, 0.997]],
  ['b_r_foot', 'b_r_calf', [0, 0, -0.1857], [0.7419, -0.024, -0.136, 0.6561]],
  ['b_r_toe', 'b_r_foot', [-0.0003, -0.0356, -0.0472], [0, 0.0105, 0, 0.9999]],
  ['b_neck0', 'b_spine3', [0, 0, -0.0887], [-0.1773, 0, 0, 0.9842]],
  ['b_l_clav', 'b_spine3', [-0.0234, -0.0083, -0.055], [1, 0, 0, 0.0048]],
  ['b_r_clav', 'b_spine3', [0.0234, -0.0083, -0.055], [-0.0048, 0, 0, 1]],
  ['b_l_toe', 'b_l_foot', [0, -0.0356, -0.0472], [0, 0.0105, 0, 0.9999]],
  ['b_neck1', 'b_neck0', [0, 0, -0.0198], [0.0626, 0, 0, 0.998]],
  ['b_l_upperarm', 'b_l_clav', [-0.0567, -0.0181, -0.0108], [0.9016, 0.0703, -0.4221, -0.064]],
  ['b_r_upperarm', 'b_r_clav', [0.0567, 0.0181, 0.0108], [0.9016, 0.0703, -0.4221, -0.064]],
  ['b_r_forearm', 'b_r_upperarm', [0, 0, -0.1055], [0.268, 0, 0, 0.9634]],
  ['b_head', 'b_neck1', [0, 0, -0.0183], [0.1105, 0, 0, 0.9939]],
  ['b_l_forearm', 'b_l_upperarm', [0, 0, 0.1055], [0.268, 0, 0, 0.9634]],
  ['b_r_hand', 'b_r_forearm', [0, 0, -0.0918], [-0.0526, 0.0915, 0.0801, 0.9912]],
  ['b_l_hand', 'b_l_forearm', [0, 0, 0.0918], [-0.0526, 0.0915, 0.0801, 0.9912]],
  ['b_r_grip', 'b_r_hand', [-0.0001, 0.0038, -0.0334], [0.0528, -0.0042, 0.1523, 0.9869]],
  ['b_l_grip', 'b_l_hand', [0.0001, -0.0038, 0.0334], [0.0528, -0.0042, 0.1523, 0.9869]],
]

/** spartanSkeleton : une racine portant le squelette du Spartan au repos (matrices à jour). */
export function spartanSkeleton(): THREE.Group {
  const root = new THREE.Group()
  const byName = new Map<string, THREE.Bone>()
  for (const [name, parent, t, q] of BONES) {
    const b = new THREE.Bone()
    b.name = name
    b.position.fromArray(t)
    b.quaternion.fromArray(q).normalize()
    ;(parent ? (byName.get(parent) as THREE.Bone) : root).add(b)
    byName.set(name, b)
  }
  root.updateMatrixWorld(true)
  return root
}
