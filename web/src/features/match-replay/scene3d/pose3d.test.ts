// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { fixtureClips } from '../test/spartanClips'
import { spartanSkeleton } from '../test/spartanSkeleton'
import { GRIP_TO_WEAPON } from './avatar3d'
import { ClipRig, newClipMix, type ClipMix } from './clipSample3d'
import {
  findBones,
  PITCH_LIMIT,
  poseSpartan,
  rigSpartan,
  SPARTAN_FORWARD,
  spartanYaw,
  type SpartanRig,
} from './pose3d'
import { aimDirThree } from './tracks3d'

const worldQ = (o: THREE.Object3D) => o.getWorldQuaternion(new THREE.Quaternion())
const named = (root: THREE.Object3D, name: string) => root.getObjectByName(name) as THREE.Bone

/** The game's skeleton, bound to its test clips. */
function rigged(): { root: THREE.Group; rig: SpartanRig; mix: ClipMix } {
  const root = spartanSkeleton()
  const clips = fixtureClips(root)
  const rig = rigSpartan(root, new ClipRig(root, clips)) as SpartanRig
  const mix = newClipMix()
  mix.baseCount = 1
  Object.assign(mix.base[0], { clip: clips.get('combat:rifle:idle'), time: 0, weight: 1, loop: true })
  return { root, rig, mix }
}

/** barrelOf: the (world-space) barrel of the weapon held by the right grip. */
function barrelOf(root: THREE.Object3D): THREE.Vector3 {
  return new THREE.Vector3(1, 0, 0).applyQuaternion(worldQ(named(root, 'b_r_grip')).multiply(GRIP_TO_WEAPON))
}

describe('findBones', () => {
  it('finds bones by their name, null if any is missing', () => {
    const root = new THREE.Group()
    const a = new THREE.Bone()
    a.name = 'b_a'
    root.add(a)
    expect(findBones(root, { a: 'b_a' })).toEqual({ a })
    expect(findBones(root, { a: 'b_a', z: 'b_z' })).toBeNull()
  })
})

describe('spartanYaw', () => {
  it('rotates the model\'s facing toward the heading', () => {
    for (const h of [0, 90, 180, -45, 270]) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spartanYaw(h))
      const face = SPARTAN_FORWARD.clone().applyQuaternion(q)
      const [x, y, z] = aimDirThree(h, 0)
      expect(face.distanceTo(new THREE.Vector3(x, y, z))).toBeLessThan(1e-9)
    }
  })
})

describe('poseSpartan', () => {
  it('refuses a model with no Spartan bones', () => {
    const root = new THREE.Group()
    const b = new THREE.Bone()
    b.name = 'b_pelvis'
    root.add(b)
    expect(rigSpartan(root, null)).toBeNull()
  })

  it('pitch after the clip: the held weapon aims at the aim direction, within 0.5° (bounded by PITCH_LIMIT)', () => {
    const { root, rig, mix } = rigged()
    for (const h of [0, 75, 210]) {
      for (const p of [-PITCH_LIMIT, -40, 0, 25, 60, PITCH_LIMIT]) {
        poseSpartan(rig, { h, p, mix })
        const [x, y, z] = aimDirThree(h, p)
        const err = THREE.MathUtils.radToDeg(barrelOf(root).angleTo(new THREE.Vector3(x, y, z)))
        expect(err).toBeLessThan(0.5)
      }
    }
    poseSpartan(rig, { h: 0, p: 120, mix })
    const [x, y, z] = aimDirThree(0, PITCH_LIMIT)
    expect(barrelOf(root).angleTo(new THREE.Vector3(x, y, z))).toBeLessThan(0.01)
  })

  it('pitch adds to the clip: the grip keeps the clip\'s pose relative to the torso', () => {
    const { root, rig, mix } = rigged()
    poseSpartan(rig, { h: 0, p: 0, mix })
    const chest = named(root, 'b_spine3')
    const rel0 = worldQ(chest).invert().multiply(worldQ(named(root, 'b_r_grip')))
    poseSpartan(rig, { h: 0, p: 50, mix })
    const rel1 = worldQ(chest).invert().multiply(worldQ(named(root, 'b_r_grip')))
    // angleTo goes through acos on 32-bit float inputs: ~1e-4 rad of noise.
    expect(rel1.angleTo(rel0)).toBeLessThan(1e-3)
  })

  it('with no mix, the copy stays at rest (pitch alone)', () => {
    const root = spartanSkeleton()
    const rig = rigSpartan(root, null) as SpartanRig
    const pelvis = named(root, 'b_pelvis').quaternion.clone()
    poseSpartan(rig, { h: 30, p: 0 })
    expect(named(root, 'b_pelvis').quaternion.angleTo(pelvis)).toBeLessThan(1e-9)
  })

  it('pure: a pose replayed after others is bit-for-bit identical', () => {
    const { root, rig, mix } = rigged()
    const all: THREE.Bone[] = []
    root.traverse((o) => {
      if (o instanceof THREE.Bone) all.push(o)
    })
    const snapshot = () => all.map((b) => [...b.quaternion.toArray(), ...b.position.toArray()])
    poseSpartan(rig, { h: 40, p: 25, mix })
    const first = snapshot()
    poseSpartan(rig, { h: 200, p: -50, mix })
    poseSpartan(rig, { h: -30, p: 70, mix: null })
    poseSpartan(rig, { h: 40, p: 25, mix })
    expect(snapshot()).toEqual(first)
  })
})
