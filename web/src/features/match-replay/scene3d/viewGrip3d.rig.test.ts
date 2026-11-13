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
  it('la tenue par défaut est nulle', () => {
    expect(rigGripOf(null)).toEqual(NUL)
    expect(rigGripOf('00000000')).toEqual(NUL)
  })

  it('les touches font ce qu’elles disent à l’écran : J à gauche, M loin', () => {
    expect(rigGripStep('KeyJ', false)).toEqual({ x: -0.005, y: 0, z: 0, roll: 0 })
    expect(rigGripStep('KeyL', true)).toEqual({ x: 0.02, y: 0, z: 0, roll: 0 })
    expect(rigGripStep('KeyM', false)).toEqual({ x: 0, y: 0, z: 0.005, roll: 0 })
    expect(rigGripStep('KeyO', false)?.roll).toBeCloseTo(Math.PI / 90)
    expect(rigGripStep('KeyA', false)).toBeNull()
  })

  it('tuneRigGrip s’accumule depuis la table ou le défaut', () => {
    const a = tuneRigGrip('aaaa0001', { x: 0.01, y: 0, z: 0, roll: 0 })
    expect(a.x).toBeCloseTo(0.01)
    const b = tuneRigGrip('aaaa0001', { x: 0.01, y: 0, z: 0, roll: 0 })
    expect(b.x).toBeCloseTo(0.02)
    expect(rigGripOf('aaaa0001')).toEqual(b)
  })
})

describe('formatRigGrips', () => {
  it('liste toutes les tenues réglées, triées, dans la syntaxe de la table', () => {
    tuneRigGrip('bbbb0002', { x: 0.05, y: 0, z: 0, roll: 0 })
    const bloc = formatRigGrips(new Map([['bbbb0002', 'VK78 Commando'], ['aaaa0001', 'Shock Rifle']]))
    expect(bloc).toBe(
      `'aaaa0001': { x: 0.020, y: 0.000, z: 0.000, roll: 0.000 }, // Shock Rifle\n'bbbb0002': { x: 0.050, y: 0.000, z: 0.000, roll: 0.000 }, // VK78 Commando`,
    )
  })
})

describe('les deux tables sont indépendantes', () => {
  it('régler le rig ne touche pas la tenue du modèle statique', () => {
    const avant = viewGripOf('1a22fee6')
    tuneRigGrip('1a22fee6', { x: 0.03, y: 0.02, z: 0, roll: 0 })
    expect(viewGripOf('1a22fee6')).toEqual(avant)
  })

  it('régler le modèle statique ne touche pas la tenue du rig', () => {
    tuneViewGrip('cccc0003', { x: 0.04, y: 0, z: 0, roll: 0 })
    expect(rigGripOf('cccc0003')).toEqual(NUL)
  })
})

describe('appliquerTenueRig (caméra identique)', () => {
  it('x va à droite (+X), y en haut (+Y), z loin de l’œil (-Z)', () => {
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    appliquerTenueRig(position, quaternion, { x: 0.1, y: 0.1, z: 0.1, roll: 0 })
    expect(position).toEqual(new THREE.Vector3(0.1, 0.1, -0.1))
    expect(quaternion).toEqual(new THREE.Quaternion(0, 0, 0, 1))
  })

  it('un roulis ne déplace rien et garde l’axe de la visée', () => {
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const avant = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion).clone()
    appliquerTenueRig(position, quaternion, { x: 0, y: 0, z: 0, roll: 0.3 })
    expect(position).toEqual(new THREE.Vector3(0, 0, 0))
    expect(new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion)).toEqual(avant)
  })

  it('une tenue nulle ne change rien', () => {
    const position = new THREE.Vector3(1, 2, 3)
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.4, 0.6))
    const p0 = position.clone()
    const q0 = quaternion.clone()
    appliquerTenueRig(position, quaternion, NUL)
    expect(position).toEqual(p0)
    expect(quaternion).toEqual(q0)
  })
})

describe('appliquerTenueRig (caméra tournée de 90° autour du monde +Y)', () => {
  // Droite de la caméra = monde (0, 0, -1), visée = monde (-1, 0, 0), haut inchangé.
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)

  it('x suit la droite de la caméra : +x va vers le monde (0, 0, -1)', () => {
    const position = new THREE.Vector3()
    const quaternion = q.clone()
    appliquerTenueRig(position, quaternion, { x: 0.1, y: 0, z: 0, roll: 0 })
    expect(position.x).toBeCloseTo(0)
    expect(position.y).toBeCloseTo(0)
    expect(position.z).toBeCloseTo(-0.1)
  })

  it('z loin de l’œil suit la visée de la caméra : +z va vers le monde (-1, 0, 0)', () => {
    const position = new THREE.Vector3()
    const quaternion = q.clone()
    appliquerTenueRig(position, quaternion, { x: 0, y: 0, z: 0.1, roll: 0 })
    expect(position.x).toBeCloseTo(-0.1)
    expect(position.y).toBeCloseTo(0)
    expect(position.z).toBeCloseTo(0)
  })

  it('y reste le haut du monde', () => {
    const position = new THREE.Vector3()
    const quaternion = q.clone()
    appliquerTenueRig(position, quaternion, { x: 0, y: 0.1, z: 0, roll: 0 })
    expect(position.x).toBeCloseTo(0)
    expect(position.y).toBeCloseTo(0.1)
    expect(position.z).toBeCloseTo(0)
  })

  it('un roulis pur ne déplace pas et garde l’axe de la visée', () => {
    const position = new THREE.Vector3()
    const quaternion = q.clone()
    const avant = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion).clone()
    appliquerTenueRig(position, quaternion, { x: 0, y: 0, z: 0, roll: 0.3 })
    expect(position.x).toBeCloseTo(0)
    expect(position.y).toBeCloseTo(0)
    expect(position.z).toBeCloseTo(0)
    // Tolérance de float : l'axe est invariant à 1e-6 près (pas d'égalité binaire de floats).
    const apres = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion)
    expect(Math.abs(apres.x - avant.x)).toBeLessThan(1e-6)
    expect(Math.abs(apres.y - avant.y)).toBeLessThan(1e-6)
    expect(Math.abs(apres.z - avant.z)).toBeLessThan(1e-6)
  })
})
