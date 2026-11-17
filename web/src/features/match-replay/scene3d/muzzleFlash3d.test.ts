// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { fixtureClips } from '../test/spartanClips'
import { spartanSkeleton } from '../test/spartanSkeleton'
import { drawnWeapon, makeAvatar, placeBody, showWeapon, wearSpartan } from './avatar3d'
import { CROUCH_DROP, EYE_HEIGHT } from './body3d'
import { registerSpartanClips } from './clips3d'
import { drawnMuzzle, muzzleOfModel, viewMuzzle } from './muzzle3d'
import { MUZZLE_FLASH_SECONDS, flashPetals, flashRoll, muzzleFlashSite, muzzleFlashStrength, rigFlashSite, type FlashPetal } from './muzzleFlash3d'
import { aimDirThree } from './tracks3d'
import { viewGripOf } from './viewGrip3d'

/** Un modèle d'arme de test : la boîte du BR75 tenu, poignée à l'origine, canon le long de X. */
function rifle(): THREE.Group {
  const g = new THREE.Group()
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.308, 0.1, 0.024).translate(0.144, 0.02, 0), new THREE.MeshBasicMaterial()))
  return g
}

const TEAM = new THREE.Color(1, 0.25, 0)
const FEET = new THREE.Vector3(2, 1, 3)
const held = { color: new THREE.Color(1, 1, 1) }
const vec = (a: readonly number[]) => new THREE.Vector3(a[0], a[1], a[2])

describe('muzzleFlashStrength', () => {
  it('dure une à deux images à 60 Hz : pleine au tir, plus faible à la seconde, éteinte ensuite', () => {
    expect(MUZZLE_FLASH_SECONDS).toBeCloseTo(2 / 60)
    expect(muzzleFlashStrength(-0.001)).toBe(0)
    expect(muzzleFlashStrength(0)).toBe(1)
    const second = muzzleFlashStrength(1.2 / 60)
    expect(second).toBeGreaterThan(0)
    expect(second).toBeLessThan(1)
    expect(muzzleFlashStrength(2 / 60)).toBe(0)
    expect(muzzleFlashStrength(0.1)).toBe(0)
  })
})

describe('flashRoll', () => {
  it('tire un angle du germe : stable, dans [0, 2π), sans parenté entre germes voisins', () => {
    expect(flashRoll(825)).toBe(flashRoll(825))
    const rolls = Array.from({ length: 50 }, (_, i) => flashRoll(800 + i))
    expect(rolls.every((r) => r >= 0 && r < 2 * Math.PI)).toBe(true)
    // Les tirs d'une rafale ont des germes consécutifs : leurs gerbes ne tournent pas d'un degré.
    const steps = rolls.slice(1).map((r, i) => Math.abs(r - rolls[i]))
    expect(steps.filter((d) => d < THREE.MathUtils.degToRad(5)).length).toBeLessThan(5)
  })
})

describe('flashPetals', () => {
  const barrel = new THREE.Vector3(1, 0.2, -0.4).normalize()
  const tipOf = (p: FlashPetal) => new THREE.Vector3(0, 1, 0).applyQuaternion(p.rotation)

  it('ouvre la gerbe vers l’avant du canon, petite (pas une boule)', () => {
    const petals = flashPetals(barrel, 1, 825, [])
    expect(petals.length).toBeGreaterThan(4)
    for (const p of petals) {
      expect(tipOf(p).dot(barrel)).toBeGreaterThan(0.5)
      expect(p.size.y).toBeLessThan(0.12)
      expect(p.size.x).toBeLessThan(0.03)
    }
  })

  it('tourne avec le germe, pas avec l’image : la même image rend la même gerbe', () => {
    const a = flashPetals(barrel, 0.7, 825, []).map(tipOf)
    const b = flashPetals(barrel, 0.7, 825, []).map(tipOf)
    const c = flashPetals(barrel, 0.7, 826, []).map(tipOf)
    a.forEach((v, i) => expect(v.distanceTo(b[i])).toBeLessThan(1e-12))
    expect(a.some((v, i) => v.distanceTo(c[i]) > 1e-3)).toBe(true)
  })
})

describe('muzzleFlashSite : jamais de gerbe hors d’un canon dessiné', () => {
  const pos = new THREE.Vector3()
  const barrel = new THREE.Vector3()

  it('sans arme dessinée ou pour un tir de véhicule, pas de gerbe', () => {
    const a = makeAvatar(new THREE.Scene(), 'joueur', TEAM)
    placeBody(a, FEET, { h: 0, p: 0, crouch: false, dropOeil: 0 }, true)
    showWeapon(a, held, null, viewGripOf(null))
    expect(drawnWeapon(a)).toBeNull()
    expect(muzzleFlashSite(false, drawnWeapon(a), pos, barrel)).toBe(false)
    expect(muzzleFlashSite(false, drawnWeapon(undefined), pos, barrel)).toBe(false)
    showWeapon(a, held, rifle(), viewGripOf(null))
    expect(muzzleFlashSite(true, drawnWeapon(a), pos, barrel)).toBe(false)
  })

  it('un joueur caché (à bord en 1re personne, hors vie) ne dessine pas d’arme', () => {
    const a = makeAvatar(new THREE.Scene(), 'joueur', TEAM)
    placeBody(a, FEET, { h: 0, p: 0, crouch: false, dropOeil: 0 }, false)
    showWeapon(a, held, rifle(), null)
    expect(drawnWeapon(a)).not.toBeNull()
    a.group.visible = false
    expect(drawnWeapon(a)).toBeNull()
  })

  it('en 1re personne, la gerbe est au bout du canon dessiné, devant l’œil mais hors de son axe', () => {
    const a = makeAvatar(new THREE.Scene(), 'joueur', TEAM)
    const gun = rifle()
    placeBody(a, FEET, { h: 40, p: -10, crouch: false, dropOeil: 0 }, true)
    showWeapon(a, held, gun, viewGripOf(null))
    expect(muzzleFlashSite(false, drawnWeapon(a), pos, barrel)).toBe(true)
    const eye = FEET.clone().setY(FEET.y + EYE_HEIGHT)
    const dir = vec(aimDirThree(40, -10))
    const ahead = pos.clone().sub(eye)
    // Devant l'œil, le long de la visée, mais sous et à droite de son axe : jamais au centre de l'écran.
    expect(ahead.dot(dir)).toBeGreaterThan(0.25)
    expect(ahead.clone().addScaledVector(dir, -ahead.dot(dir)).length()).toBeGreaterThan(0.05)
    expect(barrel.angleTo(dir)).toBeLessThan(THREE.MathUtils.degToRad(5))
  })

  it('en 3e personne, la gerbe suit le modèle porté par la main du Spartan', () => {
    const source = spartanSkeleton()
    registerSpartanClips(source, fixtureClips(source))
    const a = makeAvatar(new THREE.Scene(), 'joueur', TEAM)
    wearSpartan(a, source)
    const gun = rifle()
    placeBody(a, FEET, { h: 120, p: 15, crouch: false, dropOeil: 0, mix: null }, false)
    showWeapon(a, held, gun, null)
    const drawn = drawnWeapon(a)
    expect(drawn?.model.parent).toBe(a.spartan?.rig.rightGrip)
    expect(muzzleFlashSite(false, drawn, pos, barrel)).toBe(true)
    const model = drawn?.model as THREE.Object3D
    const expected = muzzleOfModel(gun).clone().applyMatrix4(model.matrixWorld)
    expect(pos.distanceTo(expected)).toBeLessThan(1e-9)
  })
})

describe('rigFlashSite : la gerbe de 1re personne à la bouche du rig', () => {
  const from = new THREE.Vector3(0, 1.6, 0)
  const to = new THREE.Vector3(10, 1.6, -5)
  const pos = new THREE.Vector3()
  const barrel = new THREE.Vector3()

  it('la gerbe est à l’origine du vol, le long de sa direction', () => {
    expect(rigFlashSite(true, { from, to }, pos, barrel)).toBe(true)
    expect(pos.distanceTo(from)).toBeLessThan(1e-12)
    expect(barrel.distanceTo(to.clone().sub(from).normalize())).toBeLessThan(1e-12)
  })

  it('jamais de gerbe hors d’une bouche dessinée : sans rig dessiné, sans cap', () => {
    expect(rigFlashSite(false, { from, to }, pos, barrel)).toBe(false)
    expect(rigFlashSite(true, { from, to: null }, pos, barrel)).toBe(false)
  })
})

describe('drawnMuzzle et viewMuzzle', () => {
  it('lit la bouche et le canon dans la pose du modèle dessiné', () => {
    const gun = rifle()
    const copy = gun.clone()
    const holder = new THREE.Group()
    holder.position.set(1, 2, 3)
    holder.rotation.set(0, Math.PI / 2, 0)
    holder.add(copy)
    const pos = new THREE.Vector3()
    const barrel = new THREE.Vector3()
    drawnMuzzle({ model: copy, source: gun }, pos, barrel)
    // Tourné d'un quart de tour autour de Y : le canon (X) part vers -Z.
    expect(barrel.distanceTo(new THREE.Vector3(0, 0, -1))).toBeLessThan(1e-9)
    expect(pos.distanceTo(new THREE.Vector3(1, 2.02, 3 - 0.298))).toBeLessThan(1e-6)
  })

  it('l’origine du vol en 1re personne est la bouche que la vue dessine, debout comme accroupi', () => {
    for (const [h, p, crouch] of [[0, 0, false], [75, 30, false], [210, -45, true]] as const) {
      const a = makeAvatar(new THREE.Scene(), 'joueur', TEAM)
      const gun = rifle()
      const view = viewGripOf('1a22fee6')
      placeBody(a, FEET, { h, p, crouch, dropOeil: crouch ? CROUCH_DROP : 0 }, true)
      showWeapon(a, held, gun, view)
      const drawn = new THREE.Vector3()
      drawnMuzzle({ model: a.model as THREE.Object3D, source: gun }, drawn, new THREE.Vector3())
      const eye = FEET.clone().setY(FEET.y + EYE_HEIGHT - (crouch ? CROUCH_DROP : 0))
      const pure = viewMuzzle(eye, vec(aimDirThree(h, p)), view, muzzleOfModel(gun), new THREE.Vector3())
      expect(pure.distanceTo(drawn)).toBeLessThan(1e-6)
    }
  })
})
