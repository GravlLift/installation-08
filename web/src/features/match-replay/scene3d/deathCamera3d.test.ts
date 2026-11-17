// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import type { Corpse } from './corpses3d'
import { bodyPosition, deathCameraPose, povSubject } from './deathCamera3d'
import { fallSeconds } from './fall3d'
import type { RagdollBake } from './ragdollBake3d'

describe('bodyPosition', () => {
  const corpse: Corpse = {
    at: new THREE.Vector3(2, 0, 3),
    dir: new THREE.Vector3(1, 0, 0),
    h: 0,
    kind: 'shot',
  }
  const out = () => new THREE.Vector3()

  it('cuit : le corps est au repos, à la place de la cuisson', () => {
    const bake = { feet: new THREE.Vector3(5, 0, 7) } as unknown as RagdollBake
    expect(bodyPosition(corpse, 1, bake, out())).toEqual(new THREE.Vector3(5, 0, 7))
  })

  it('chute : à la mort le corps est aux pieds de la victime', () => {
    expect(bodyPosition(corpse, 0, null, out())).toEqual(new THREE.Vector3(2, 0, 3))
  })

  it('chute : au terme de la chute le corps a glissé le long de l impulsion', () => {
    const slide = 0.08 // `shot` : STYLES.shot.slide
    const p = bodyPosition(corpse, fallSeconds('shot'), null, out())
    expect(p).toEqual(new THREE.Vector3(2 + slide, 0, 3))
  })
})

describe('povSubject', () => {
  it('en vie : le joueur, en 1re personne', () => {
    expect(povSubject(true, null, 0)).toEqual({ kind: 'fp' })
  })

  it('mort avec un corps : le corps, en 3e personne', () => {
    const body = new THREE.Vector3(1, 0, 2)
    expect(povSubject(false, body, 45)).toEqual({ kind: 'corpse', feet: body, heading: 45 })
  })

  it('mort sans corps : rien, l œil reste où il était', () => {
    expect(povSubject(false, null, 0)).toEqual({ kind: 'hold' })
  })

  it("l'image de réapparition (échantillon rechargé) revient à la 1re personne", () => {
    expect(povSubject(true, new THREE.Vector3(1, 0, 2), 0)).toEqual({ kind: 'fp' })
  })
})

describe('deathCameraPose', () => {
  const opts = { distance: 1.05, rise: 0.2, eyeHeight: 0.62 }

  it('un corps à l origine, cap 0 : l œil est derrière et au-dessus, le regard porte devant', () => {
    const pose = deathCameraPose(new THREE.Vector3(0, 0, 0), 0, opts, {
      position: new THREE.Vector3(),
      look: new THREE.Vector3(),
    })
    expect(pose.position.x).toBeCloseTo(-1.05)
    expect(pose.position.y).toBeCloseTo(0.82)
    expect(pose.position.z).toBeCloseTo(0)
    expect(pose.look.x).toBeCloseTo(10)
    expect(pose.look.y).toBeCloseTo(0.62)
    expect(pose.look.z).toBeCloseTo(0)
  })

  it('le corps déplacé déplace l œil et le regard d autant', () => {
    const pose = deathCameraPose(new THREE.Vector3(4, 0, -3), 0, opts, {
      position: new THREE.Vector3(),
      look: new THREE.Vector3(),
    })
    expect(pose.position.x).toBeCloseTo(4 - 1.05)
    expect(pose.position.y).toBeCloseTo(0.82)
    expect(pose.position.z).toBeCloseTo(-3)
    expect(pose.look.x).toBeCloseTo(4 + 10)
    expect(pose.look.z).toBeCloseTo(-3)
  })
})
