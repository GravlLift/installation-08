import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { fixtureClips } from '../test/spartanClips'
import { spartanSkeleton } from '../test/spartanSkeleton'
import { GRIP_TO_WEAPON } from './avatar3d'
import { registerSpartanClips } from './clips3d'
import { newClipMix, type ClipMix } from './clipSample3d'
import { MuzzleProbe, muzzleOfModel, muzzleWorld } from './muzzle3d'
import { aimDirThree } from './tracks3d'

/** Un modèle d'arme de test : la boîte du BR75 tenu (0,31 x 0,10 x 0,024 u), poignée à l'origine. */
function rifle(): THREE.Group {
  const geo = new THREE.BoxGeometry(0.308, 0.1, 0.024).translate(0.144, 0.02, 0)
  const g = new THREE.Group()
  g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial()))
  // La pose de la source ne compte pas : la vue en tient une copie repositionnée.
  g.position.set(5, 5, 5)
  g.rotation.set(0.3, 1, 0)
  return g
}

const vec = (a: readonly number[]) => new THREE.Vector3(a[0], a[1], a[2])

describe('muzzleOfModel', () => {
  it('rend le devant de la boîte le long du canon, au milieu de la section, dans le repère du modèle', () => {
    const m = muzzleOfModel(rifle())
    expect(m.x).toBeCloseTo(0.298, 5)
    expect(m.y).toBeCloseTo(0.02, 5)
    expect(m.z).toBeCloseTo(0, 5)
  })

  it('se centre sur le bout du canon, pas sur la section entière (chargeur dessous)', () => {
    const gun = rifle()
    const mag = new THREE.BoxGeometry(0.04, 0.12, 0.02).translate(0.08, -0.09, 0)
    gun.add(new THREE.Mesh(mag, new THREE.MeshBasicMaterial()))
    const m = muzzleOfModel(gun)
    expect(m.x).toBeCloseTo(0.298, 5)
    expect(m.y).toBeCloseTo(0.02, 5)
  })
})

describe('muzzleWorld', () => {
  it('porte la bouche depuis la poignée comme l’avatar porte l’arme (GRIP_TO_WEAPON)', () => {
    const grip = new THREE.Vector3(1, 2, 3)
    // Une poignée tournée de l'inverse du port : le modèle d'arme a les axes du monde.
    const out = muzzleWorld(grip, GRIP_TO_WEAPON.clone().invert(), new THREE.Vector3(0.3, 0.02, 0), new THREE.Vector3())
    expect(out.distanceTo(new THREE.Vector3(1.3, 2.02, 3))).toBeLessThan(1e-6)
  })
})

describe('MuzzleProbe', () => {
  const source = spartanSkeleton()
  const clips = fixtureClips(source)
  registerSpartanClips(source, clips)
  const weapon = rifle()
  const feet = new THREE.Vector3(2, 1, -4)
  const mixOf = (name: string): ClipMix => {
    const mix = newClipMix()
    mix.baseCount = 1
    Object.assign(mix.base[0], { clip: clips.get(name), time: 0, weight: 1, loop: true })
    return mix
  }
  const idle = mixOf('combat:rifle:idle')
  const crouch = mixOf('crouch:rifle:idle')
  const at = (probe: MuzzleProbe, h: number, p: number, mix = idle) =>
    probe.at(source, weapon, feet, { h, p, mix }, new THREE.Vector3()) as THREE.Vector3

  it('la bouche est le bout du canon porté par la main, le long de la visée', () => {
    const probe = new MuzzleProbe()
    for (const [h, p] of [[0, 0], [90, 20], [230, -35]]) {
      const m = at(probe, h, p)
      const m2 = probe.at(source, weapon, feet, { h, p, mix: idle }, new THREE.Vector3()) as THREE.Vector3
      expect(m2.distanceTo(m)).toBeLessThan(1e-12)
      // Deux bouches de longueurs de canon différentes : leur écart suit la visée.
      const short = new THREE.Group()
      short.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02).translate(0.05, 0.02, 0)))
      const s = probe.at(source, short, feet, { h, p, mix: idle }, new THREE.Vector3()) as THREE.Vector3
      const along = m.clone().sub(s).normalize()
      expect(THREE.MathUtils.radToDeg(along.angleTo(vec(aimDirThree(h, p))))).toBeLessThan(0.5)
    }
  })

  it('suit le cap autour des pieds, le tangage de la visée et l’accroupi des clips', () => {
    const probe = new MuzzleProbe()
    const east = at(probe, 0, 0).sub(feet)
    const north = at(probe, 90, 0).sub(feet)
    expect(north.y).toBeCloseTo(east.y, 6)
    expect(Math.hypot(north.x, north.z)).toBeCloseTo(Math.hypot(east.x, east.z), 6)
    expect(at(probe, 0, 40).y).toBeGreaterThan(at(probe, 0, 0).y + 0.05)
    expect(at(probe, 0, 0, crouch).y).toBeLessThan(at(probe, 0, 0).y - 0.15)
  })

  it('ne garde rien d’un appel à l’autre : la même pose rend la même bouche', () => {
    const probe = new MuzzleProbe()
    const first = at(probe, 30, 10)
    at(probe, 250, -60, crouch)
    at(probe, 120, 70)
    expect(at(probe, 30, 10).distanceTo(first)).toBeLessThan(1e-9)
  })

  it('rend null pour un modèle sans les os du Spartan', () => {
    expect(new MuzzleProbe().at(new THREE.Group(), weapon, feet, { h: 0, p: 0, mix: null }, new THREE.Vector3())).toBeNull()
  })
})
