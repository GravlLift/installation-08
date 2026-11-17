// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { appliquerTenueRig } from './brasPremierePersonne3d'
import {
  formatRigGrips,
  rigGripOf,
  rigGripStep,
  tuneRigGrip,
  tuneViewGrip,
  viewGripOf,
  type ViewGrip,
} from './viewGrip3d'

const NUL: ViewGrip = { x: 0, y: 0, z: 0, roll: 0 }

describe('rigGripOf / rigGripStep', () => {
  it('the default grip is null', () => {
    expect(rigGripOf(null)).toEqual(NUL)
    expect(rigGripOf('00000000')).toEqual(NUL)
  })

  it('the keys do what they say on screen: J left, M away', () => {
    expect(rigGripStep('KeyJ', false)).toEqual({ x: -0.005, y: 0, z: 0, roll: 0 })
    expect(rigGripStep('KeyL', true)).toEqual({ x: 0.02, y: 0, z: 0, roll: 0 })
    expect(rigGripStep('KeyM', false)).toEqual({ x: 0, y: 0, z: 0.005, roll: 0 })
    expect(rigGripStep('KeyO', false)?.roll).toBeCloseTo(Math.PI / 90)
    expect(rigGripStep('KeyA', false)).toBeNull()
  })

  it('tuneRigGrip accumulates from the table or the default', () => {
    const a = tuneRigGrip('aaaa0001', { x: 0.01, y: 0, z: 0, roll: 0 })
    expect(a.x).toBeCloseTo(0.01)
    const b = tuneRigGrip('aaaa0001', { x: 0.01, y: 0, z: 0, roll: 0 })
    expect(b.x).toBeCloseTo(0.02)
    expect(rigGripOf('aaaa0001')).toEqual(b)
  })
})

describe('formatRigGrips', () => {
  it('lists all the tuned grips, sorted, in the table\'s syntax', () => {
    tuneRigGrip('bbbb0002', { x: 0.05, y: 0, z: 0, roll: 0 })
    const block = formatRigGrips(new Map([['bbbb0002', 'VK78 Commando'], ['aaaa0001', 'Shock Rifle']]))
    expect(block).toBe(
      `'aaaa0001': { x: 0.020, y: 0.000, z: 0.000, roll: 0.000 }, // Shock Rifle\n'bbbb0002': { x: 0.050, y: 0.000, z: 0.000, roll: 0.000 }, // VK78 Commando`,
    )
  })
})

describe('the two tables are independent', () => {
  it('tuning the rig does not touch the static model\'s grip', () => {
    const before = viewGripOf('1a22fee6')
    tuneRigGrip('1a22fee6', { x: 0.03, y: 0.02, z: 0, roll: 0 })
    expect(viewGripOf('1a22fee6')).toEqual(before)
  })

  it('tuning the static model does not touch the rig\'s grip', () => {
    tuneViewGrip('cccc0003', { x: 0.04, y: 0, z: 0, roll: 0 })
    expect(rigGripOf('cccc0003')).toEqual(NUL)
  })
})

describe('appliquerTenueRig (identity camera)', () => {
  it('x goes right (+X), y up (+Y), z away from the eye (-Z)', () => {
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    appliquerTenueRig(position, quaternion, { x: 0.1, y: 0.1, z: 0.1, roll: 0 })
    expect(position).toEqual(new THREE.Vector3(0.1, 0.1, -0.1))
    expect(quaternion).toEqual(new THREE.Quaternion(0, 0, 0, 1))
  })

  it('a roll moves nothing and keeps the aim axis', () => {
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const before = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion).clone()
    appliquerTenueRig(position, quaternion, { x: 0, y: 0, z: 0, roll: 0.3 })
    expect(position).toEqual(new THREE.Vector3(0, 0, 0))
    expect(new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion)).toEqual(before)
  })

  it('a null grip changes nothing', () => {
    const position = new THREE.Vector3(1, 2, 3)
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.4, 0.6))
    const p0 = position.clone()
    const q0 = quaternion.clone()
    appliquerTenueRig(position, quaternion, NUL)
    expect(position).toEqual(p0)
    expect(quaternion).toEqual(q0)
  })
})

describe('appliquerTenueRig (camera rotated 90° around world +Y)', () => {
  // Camera right = world (0, 0, -1), aim = world (-1, 0, 0), up unchanged.
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)

  it('x follows the camera\'s right: +x goes toward world (0, 0, -1)', () => {
    const position = new THREE.Vector3()
    const quaternion = q.clone()
    appliquerTenueRig(position, quaternion, { x: 0.1, y: 0, z: 0, roll: 0 })
    expect(position.x).toBeCloseTo(0)
    expect(position.y).toBeCloseTo(0)
    expect(position.z).toBeCloseTo(-0.1)
  })

  it('z away from the eye follows the camera\'s aim: +z goes toward world (-1, 0, 0)', () => {
    const position = new THREE.Vector3()
    const quaternion = q.clone()
    appliquerTenueRig(position, quaternion, { x: 0, y: 0, z: 0.1, roll: 0 })
    expect(position.x).toBeCloseTo(-0.1)
    expect(position.y).toBeCloseTo(0)
    expect(position.z).toBeCloseTo(0)
  })

  it('y stays the world\'s up', () => {
    const position = new THREE.Vector3()
    const quaternion = q.clone()
    appliquerTenueRig(position, quaternion, { x: 0, y: 0.1, z: 0, roll: 0 })
    expect(position.x).toBeCloseTo(0)
    expect(position.y).toBeCloseTo(0.1)
    expect(position.z).toBeCloseTo(0)
  })

  it('a pure roll moves nothing and keeps the aim axis', () => {
    const position = new THREE.Vector3()
    const quaternion = q.clone()
    const before = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion).clone()
    appliquerTenueRig(position, quaternion, { x: 0, y: 0, z: 0, roll: 0.3 })
    expect(position.x).toBeCloseTo(0)
    expect(position.y).toBeCloseTo(0)
    expect(position.z).toBeCloseTo(0)
    // Float tolerance: the axis is invariant to within 1e-6 (no binary float equality).
    const after = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion)
    expect(Math.abs(after.x - before.x)).toBeLessThan(1e-6)
    expect(Math.abs(after.y - before.y)).toBeLessThan(1e-6)
    expect(Math.abs(after.z - before.z)).toBeLessThan(1e-6)
  })
})
