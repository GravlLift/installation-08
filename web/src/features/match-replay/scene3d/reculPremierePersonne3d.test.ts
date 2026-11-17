// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { newRecoil } from './recoil3d'
import { ROTATION_RIG_CAMERA } from './premierePersonne3d'
import { FP_RECOIL_GAIN, pivotDuRecul, poserReculRig } from './reculPremierePersonne3d'

const PIVOT = new THREE.Vector3(0.05, -0.04, 0.02)
const BOUCHE = new THREE.Vector3(0.25, -0.03, 0.02)

/** Un rig sous un support tourné comme `BrasPremierePersonne3d.placer` le tourne (caméra à l'origine). */
function rigSousCamera(): { support: THREE.Group; racine: THREE.Group } {
  const support = new THREE.Group()
  support.quaternion.copy(ROTATION_RIG_CAMERA)
  const racine = new THREE.Group()
  support.add(racine)
  return { support, racine }
}

/** Le point `p` du rig en repère caméra (x à droite, y en haut, -z vers l'avant). */
function enCamera(support: THREE.Object3D, p: THREE.Vector3): THREE.Vector3 {
  support.updateMatrixWorld(true)
  return p.clone().applyMatrix4(support.children[0].matrixWorld)
}

describe('poserReculRig', () => {
  it('laisse le rig au repos sans recul ou pour un recul nul', () => {
    const racine = new THREE.Group()
    poserReculRig(racine, null, PIVOT)
    expect(racine.position.length()).toBe(0)
    expect(racine.quaternion.equals(new THREE.Quaternion())).toBe(true)
    poserReculRig(racine, newRecoil(), PIVOT)
    expect(racine.position.length()).toBe(0)
    expect(racine.quaternion.equals(new THREE.Quaternion())).toBe(true)
  })

  it('recule le rig le long de l’avant de la visée, vers l’œil', () => {
    const { support, racine } = rigSousCamera()
    const avant = enCamera(support, BOUCHE)
    poserReculRig(racine, { ...newRecoil(), back: 0.012 }, PIVOT)
    const apres = enCamera(support, BOUCHE)
    // L'avant de la caméra est -Z : reculer, c'est monter en z, sans écart latéral ni vertical.
    expect(apres.z - avant.z).toBeCloseTo(0.012 * FP_RECOIL_GAIN, 9)
    expect(apres.x).toBeCloseTo(avant.x, 9)
    expect(apres.y).toBeCloseTo(avant.y, 9)
  })

  it('lève la bouche autour du pivot, qui reste en place', () => {
    const { support, racine } = rigSousCamera()
    const boucheAvant = enCamera(support, BOUCHE)
    const pivotAvant = enCamera(support, PIVOT)
    poserReculRig(racine, { ...newRecoil(), pitch: (3 * Math.PI) / 180 }, PIVOT)
    const boucheApres = enCamera(support, BOUCHE)
    const pivotApres = enCamera(support, PIVOT)
    expect(boucheApres.y).toBeGreaterThan(boucheAvant.y)
    expect(boucheApres.x).toBeCloseTo(boucheAvant.x, 9)
    expect(pivotApres.distanceTo(pivotAvant)).toBeLessThan(1e-9)
    // Le canon tourne du tangage multiplié par le gain.
    const canonAvant = boucheAvant.clone().sub(pivotAvant).normalize()
    const canonApres = boucheApres.clone().sub(pivotApres).normalize()
    expect(canonAvant.angleTo(canonApres)).toBeCloseTo((3 * Math.PI) / 180 * FP_RECOIL_GAIN, 6)
  })

  it('n’accumule rien : poser deux fois vaut poser une fois, et le repos revient', () => {
    const recul = { back: 0.01, pitch: 0.05, yaw: 0.004, roll: -0.006 }
    const racine = new THREE.Group()
    poserReculRig(racine, recul, PIVOT)
    const position = racine.position.clone()
    const quaternion = racine.quaternion.clone()
    poserReculRig(racine, recul, PIVOT)
    expect(racine.position.distanceTo(position)).toBeLessThan(1e-12)
    expect(racine.quaternion.angleTo(quaternion)).toBeLessThan(1e-9)
    poserReculRig(racine, null, PIVOT)
    expect(racine.position.length()).toBe(0)
    expect(racine.quaternion.equals(new THREE.Quaternion())).toBe(true)
  })
})

describe('pivotDuRecul', () => {
  it('prend la racine de l’arme à l’idle, null sans pose d’arme', () => {
    expect(pivotDuRecul({ position: [1, 2, 3] })?.toArray()).toEqual([1, 2, 3])
    expect(pivotDuRecul(undefined)).toBeNull()
  })
})
