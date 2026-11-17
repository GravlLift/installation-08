// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { boucheRig, boucheRigCamera, boucheRigLocale, boucheMondeRig, type BoucheLocale } from './boucheRig3d'
import { appliquerTenueRig } from './brasPremierePersonne3d'
import { ROTATION_RIG_CAMERA } from './premierePersonne3d'
import type { ViewGrip } from './viewGrip3d'

const ZERO: ViewGrip = { x: 0, y: 0, z: 0, roll: 0 }

/** Un rig de test : un porteur (groupe) contenant une scène avec un canon (boîte) et un bras. */
function rigDeTest(): { porteur: THREE.Group; root: THREE.Group } {
  const porteur = new THREE.Group()
  const root = new THREE.Group()
  porteur.add(root)
  // Le canon : une boîte de 1 u de long le long de +X, décalée pour aller de -0.4 à +0.6.
  const geoCan = new THREE.BoxGeometry(1, 0.2, 0.2).translate(0.1, 0, 0)
  root.add(new THREE.Mesh(geoCan, new THREE.MeshStandardMaterial()))
  // Un bras : une boîte avec un matériau de bras, à l'arrière (-0.5), écarté de la mesure.
  const brasM = new THREE.MeshStandardMaterial()
  brasM.userData.surfaceBrute = { asg: 0 }
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.1).translate(-0.5, 0, 0), brasM))
  return { porteur, root }
}

/** Le matériau de bras est reconnu par `estMateriauBras` : surfaceBrute sans texture. */
const estBras = (m: THREE.Material) =>
  m instanceof THREE.MeshStandardMaterial && !!m.userData.surfaceBrute && !m.map

describe('boucheRig', () => {
  it('la bouche est le devant du canon (le +X de la boîte de 1 u), centré sur les autres axes', () => {
    const { porteur, root } = rigDeTest()
    const out = { bouche: new THREE.Vector3(), axe: new THREE.Vector3() }
    const ok = boucheRig(root, porteur, estBras, new THREE.Vector3(1, 0, 0), out)
    expect(ok).toBe(true)
    // Le devant de la boîte est à +0.6 (la boîte va de -0.4 à +0.6 sur X) ; la tranche de 0.01 u
    // et le repoussage au plan frontal mettent la bouche juste en dessous, ~+0.6.
    expect(out.bouche.x).toBeGreaterThan(0.5)
    expect(out.bouche.x).toBeLessThan(0.65)
    // Centré sur Y et Z (la boîte est symétrique sur ces axes).
    expect(out.bouche.y).toBeCloseTo(0, 4)
    expect(out.bouche.z).toBeCloseTo(0, 4)
    // L'axe est celui du canon.
    expect(out.axe.x).toBeCloseTo(1, 5)
    expect(out.axe.y).toBeCloseTo(0, 5)
    expect(out.axe.z).toBeCloseTo(0, 5)
  })

  it('les maillages de bras sont ignorés', () => {
    // Une scène qui ne porte que des maillages de bras : pas de maillage d'arme, pas de bouche.
    const porteur = new THREE.Group()
    const root = new THREE.Group()
    porteur.add(root)
    const brasM = new THREE.MeshStandardMaterial()
    brasM.userData.surfaceBrute = { asg: 0 }
    root.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.1).translate(-0.5, 0, 0), brasM))
    const out = { bouche: new THREE.Vector3(), axe: new THREE.Vector3() }
    expect(boucheRig(root, porteur, estBras, new THREE.Vector3(1, 0, 0), out)).toBe(false)
  })

  it('la bouche ne dépend pas de la pose du porteur dans le monde (déplacé, tourné, mis à l’échelle)', () => {
    const repos = rigDeTest()
    const attendu = { bouche: new THREE.Vector3(), axe: new THREE.Vector3() }
    boucheRig(repos.root, repos.porteur, estBras, new THREE.Vector3(1, 0, 0), attendu)
    const { porteur, root } = rigDeTest()
    porteur.position.set(12, 5, -7)
    porteur.quaternion.setFromEuler(new THREE.Euler(0.3, 1.1, -0.4))
    porteur.scale.set(1.5, 1.5, 1)
    const out = { bouche: new THREE.Vector3(), axe: new THREE.Vector3() }
    expect(boucheRig(root, porteur, estBras, new THREE.Vector3(1, 0, 0), out)).toBe(true)
    expect(out.bouche.distanceTo(attendu.bouche)).toBeLessThan(1e-6)
  })

  it('ne compte que les maillages d’arme, pas les bras mêlés', () => {
    const { porteur, root } = rigDeTest()
    const out = { bouche: new THREE.Vector3(), axe: new THREE.Vector3() }
    // Le canon est l'unique maillage d'arme : la bouche est son devant, le bras n'y entre pas.
    expect(boucheRig(root, porteur, estBras, new THREE.Vector3(1, 0, 0), out)).toBe(true)
    // Le devant du canon est à ~+0.6 (la boîte va de -0.4 à +0.6) ; le bras est à l'arrière (-0.5).
    expect(out.bouche.x).toBeGreaterThan(0.5)
  })

  it('rend faux sans maillage d’arme', () => {
    const porteur = new THREE.Group()
    const empty = new THREE.Group()
    porteur.add(empty)
    const out = { bouche: new THREE.Vector3(), axe: new THREE.Vector3() }
    expect(boucheRig(empty, porteur, estBras, new THREE.Vector3(1, 0, 0), out)).toBe(false)
  })
})

describe('boucheRigCamera', () => {
  it('avec une tenue nulle, la bouche en repère caméra est le point porteur tourné par ROTATION_RIG_CAMERA', () => {
    const st = { bouche: new THREE.Vector3(0.5, 0, 0), axe: new THREE.Vector3(1, 0, 0) }
    const out = boucheRigCamera(st, ZERO, new THREE.Vector3())
    const attendu = new THREE.Vector3(0.5, 0, 0).applyQuaternion(ROTATION_RIG_CAMERA)
    expect(out.distanceTo(attendu)).toBeLessThan(1e-9)
  })

  it('avec une tenue x = 0.1, la bouche avance de +0.1 sur X de la caméra', () => {
    const st = { bouche: new THREE.Vector3(0.5, 0, 0), axe: new THREE.Vector3(1, 0, 0) }
    const zero = boucheRigCamera(st, ZERO, new THREE.Vector3())
    const out = boucheRigCamera(st, { x: 0.1, y: 0, z: 0, roll: 0 }, new THREE.Vector3())
    // Le décalage de la tenue est dans le repère caméra, avant la rotation du rig.
    expect(out.x - zero.x).toBeCloseTo(0.1, 6)
    expect(out.y - zero.y).toBeCloseTo(0, 6)
    expect(out.z - zero.z).toBeCloseTo(0, 6)
  })

  it('avec un roulis non nul, la bouche coincide avec le point posé par appliquerTenueRig × ROTATION_RIG_CAMERA', () => {
    const st = { bouche: new THREE.Vector3(0.5, 0, 0), axe: new THREE.Vector3(1, 0, 0) }
    const tenue: ViewGrip = { x: 0.1, y: -0.05, z: 0.2, roll: 0.35 }
    const out = boucheRigCamera(st, tenue, new THREE.Vector3())
    const objet = new THREE.Object3D()
    appliquerTenueRig(objet.position, objet.quaternion, tenue)
    objet.quaternion.multiply(ROTATION_RIG_CAMERA)
    objet.updateMatrix()
    const attendu = st.bouche.clone().applyMatrix4(objet.matrix)
    expect(out.distanceTo(attendu)).toBeLessThan(1e-9)
  })
})

describe('boucheRigLocale', () => {
  it('un maillage simple : le porteur local est le maillage, le point est son devant, l’axe est le canon', () => {
    const { porteur, root } = rigDeTest()
    const locale: BoucheLocale = { porteurLocal: null as unknown as THREE.Object3D, point: new THREE.Vector3(), axe: new THREE.Vector3() }
    expect(boucheRigLocale(root, porteur, estBras, new THREE.Vector3(1, 0, 0), locale)).toBe(true)
    // Le porteur local est le maillage du canon (le seul maillage d'arme de la scène).
    expect(locale.porteurLocal).toBe(root.children[0])
    // Le point est le devant du canon en repère local du maillage, l'axe est le canon.
    expect(locale.point.x).toBeGreaterThan(0.5)
    expect(locale.point.x).toBeLessThan(0.65)
    expect(locale.axe.x).toBeCloseTo(1, 5)
    expect(locale.axe.y).toBeCloseTo(0, 5)
  })
})

describe('boucheRigLocale puis boucheMondeRig', () => {
  it('porteur et maillage déplacés et tournés : la bouche monde relue est le devant du canon, l’axe est le canon', () => {
    const { porteur, root } = rigDeTest()
    porteur.position.set(4, -2, 9)
    porteur.quaternion.setFromEuler(new THREE.Euler(0.2, -0.9, 0.5))
    const canon = root.children[0]
    canon.position.set(0.3, 0.1, -0.2)
    canon.quaternion.setFromEuler(new THREE.Euler(0.4, 0.6, -0.3))
    porteur.updateMatrixWorld(true)
    // L'axe du canon en repère du porteur : l'axe +X du maillage, tourné comme lui.
    const axePorteur = new THREE.Vector3(1, 0, 0).applyQuaternion(canon.quaternion)
    const locale: BoucheLocale = { porteurLocal: null as unknown as THREE.Object3D, point: new THREE.Vector3(), axe: new THREE.Vector3() }
    expect(boucheRigLocale(root, porteur, estBras, axePorteur, locale)).toBe(true)
    const pos = new THREE.Vector3()
    const axe = new THREE.Vector3()
    boucheMondeRig(locale.porteurLocal, locale.point, locale.axe, pos, axe)
    const attendu = new THREE.Vector3(0.6, 0, 0).applyMatrix4(canon.matrixWorld)
    expect(pos.distanceTo(attendu)).toBeLessThan(1e-6)
    const axeAttendu = new THREE.Vector3(1, 0, 0).transformDirection(canon.matrixWorld)
    expect(axe.distanceTo(axeAttendu)).toBeLessThan(1e-6)
  })
})

describe('boucheMondeRig', () => {
  it('la bouche monde suit le maillage quand il est déplacé et tourné', () => {
    const porteur = new THREE.Group()
    const canon = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 0.2).translate(0.1, 0, 0), new THREE.MeshStandardMaterial())
    porteur.add(canon)
    const point = new THREE.Vector3(0.6, 0, 0) // le devant, en repère local du maillage
    const axe = new THREE.Vector3(1, 0, 0)
    canon.position.set(2, 3, -4)
    canon.rotation.z = 0.7
    const pos = new THREE.Vector3()
    const outAxe = new THREE.Vector3()
    boucheMondeRig(canon, point, axe, pos, outAxe)
    const attendu = point.clone().applyMatrix4(canon.matrixWorld)
    expect(pos.distanceTo(attendu)).toBeLessThan(1e-9)
    expect(outAxe.length()).toBeCloseTo(1, 9)
  })

  it('le porteur déplacé, tourné et mis à l’échelle (1.5,1.5,1) : la bouche monde = le devant du maillage transformé par toute la chaîne', () => {
    const porteur = new THREE.Group()
    porteur.position.set(12, 5, -7)
    porteur.quaternion.setFromEuler(new THREE.Euler(0.3, 1.1, -0.4))
    porteur.scale.set(1.5, 1.5, 1)
    const canon = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 0.2).translate(0.1, 0, 0), new THREE.MeshStandardMaterial())
    porteur.add(canon)
    const point = new THREE.Vector3(0.6, 0, 0)
    const axe = new THREE.Vector3(1, 0, 0)
    const pos = new THREE.Vector3()
    const outAxe = new THREE.Vector3()
    boucheMondeRig(canon, point, axe, pos, outAxe)
    const attendu = point.clone().applyMatrix4(canon.matrixWorld)
    expect(pos.distanceTo(attendu)).toBeLessThan(1e-9)
  })
})
