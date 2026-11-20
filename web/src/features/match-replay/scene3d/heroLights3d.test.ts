// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import {
  HERO_DEFAULTS,
  HERO_LIGHT_DISTANCE,
  HERO_LIGHTS_MAX,
  heroRigOf,
  heroRimTint,
  parseHeroLights,
  resolveHeroLight,
  type Vec3,
} from './heroLights3d'

const close = (a: Vec3, b: Vec3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9))
const deg = (d: number) => (d * Math.PI) / 180

describe('parseHeroLights', () => {
  it('keeps the known fields of valid entries, and absent fields stay absent', () => {
    const r = parseHeroLights([
      { xuid: 'a', key: 4, fill: 0, rim: 10, azimuth: -180, elevation: 90, rimColor: 'team', extra: 1 },
      { xuid: 'b' },
    ])
    expect(r).toEqual({ lights: [{ xuid: 'a', key: 4, fill: 0, rim: 10, azimuth: -180, elevation: 90, rimColor: 'team' }, { xuid: 'b' }] })
  })

  it('accepts an empty list', () => {
    expect(parseHeroLights([])).toEqual({ lights: [] })
  })

  it.each([
    [{}, 'lights must be an array'],
    [[1], 'lights[0] is not an object'],
    [[{ xuid: '' }], 'lights[0].xuid must be a non-empty string'],
    [[{ xuid: 'a' }, { xuid: 'a' }], 'lights[1].xuid repeats lights[0]: one rig per player'],
    [[{ xuid: 'a', key: -0.1 }], 'lights[0].key must be a finite number in [0, 10]'],
    [[{ xuid: 'a', fill: 10.5 }], 'lights[0].fill must be a finite number in [0, 10]'],
    [[{ xuid: 'a', rim: Number.NaN }], 'lights[0].rim must be a finite number in [0, 10]'],
    [[{ xuid: 'a', azimuth: 181 }], 'lights[0].azimuth must be a finite number in [-180, 180]'],
    [[{ xuid: 'a', elevation: -91 }], 'lights[0].elevation must be a finite number in [-90, 90]'],
    [[{ xuid: 'a', rimColor: 'red' }], "lights[0].rimColor must be 'team' or 'white'"],
  ])('refuses %j', (raw, error) => {
    expect(parseHeroLights(raw)).toEqual({ error })
  })

  it('refuses more than HERO_LIGHTS_MAX rigs', () => {
    const raw = Array.from({ length: HERO_LIGHTS_MAX + 1 }, (_, i) => ({ xuid: `p${i}` }))
    expect(parseHeroLights(raw)).toEqual({ error: `lights has ${HERO_LIGHTS_MAX + 1} entries; at most ${HERO_LIGHTS_MAX}` })
    expect('lights' in parseHeroLights(raw.slice(0, HERO_LIGHTS_MAX))).toBe(true)
  })

  it('resolves absent fields to the defaults', () => {
    expect(resolveHeroLight({ xuid: 'a', rim: 1 })).toEqual({ ...HERO_DEFAULTS, xuid: 'a', rim: 1 })
  })
})

describe('heroRigOf', () => {
  // The player's body center, and a camera 5 u away on +z (THREE coordinates), looking at it along -z:
  // the camera's side is +z, screen right is +x.
  const center: Vec3 = [10, 2, -3]
  const camera: Vec3 = [10, 3, 2]

  it('puts the key on the camera side at azimuth 0, toward screen right at +90, toward screen left at -90', () => {
    close(heroRigOf(center, camera, 0, 0).key, [0, 0, 1])
    close(heroRigOf(center, camera, 90, 0).key, [1, 0, 0])
    close(heroRigOf(center, camera, -90, 0).key, [-1, 0, 0])
  })

  it('lifts the key by its elevation and keeps every direction a unit vector', () => {
    const rig = heroRigOf(center, camera, 45, 30)
    close(rig.key, [Math.cos(deg(30)) * Math.sin(deg(45)), Math.sin(deg(30)), Math.cos(deg(30)) * Math.cos(deg(45))])
    for (const d of [rig.key, rig.fill, rig.rim]) expect(Math.hypot(...d)).toBeCloseTo(1, 12)
  })

  it('mirrors the fill across the camera axis at half the elevation', () => {
    const rig = heroRigOf(center, camera, 40, 30)
    close(rig.fill, [-Math.cos(deg(15)) * Math.sin(deg(40)), Math.sin(deg(15)), Math.cos(deg(15)) * Math.cos(deg(40))])
  })

  it('puts the rim behind the player, straight opposite the camera, at the elevation', () => {
    const rig = heroRigOf(center, camera, 40, 30)
    close(rig.rim, [0, Math.sin(deg(30)), -Math.cos(deg(30))])
    // Its notional position: HERO_LIGHT_DISTANCE from the player, on the far side from the camera.
    close(rig.rimAt, [10, 2 + HERO_LIGHT_DISTANCE * Math.sin(deg(30)), -3 - HERO_LIGHT_DISTANCE * Math.cos(deg(30))])
    close(rig.keyAt, [10 + HERO_LIGHT_DISTANCE * rig.key[0], 2 + HERO_LIGHT_DISTANCE * rig.key[1], -3 + HERO_LIGHT_DISTANCE * rig.key[2]])
  })

  it('turns with the camera: a camera on +x has its screen right on -z', () => {
    const rig = heroRigOf([0, 0, 0], [4, 1, 0], 90, 0)
    close(rig.key, [0, 0, -1])
    close(rig.rim, [-1, 0, 0])
  })

  it('falls back to +z as the camera side for a camera straight above', () => {
    const rig = heroRigOf([1, 0, 1], [1, 9, 1], 0, 0)
    close(rig.key, [0, 0, 1])
    close(rig.rim, [0, 0, -1])
  })
})

describe('heroRimTint', () => {
  it('brings a team color to a brightest channel of 1, white for black', () => {
    close(heroRimTint([0.5, 0.25, 0]), [1, 0.5, 0])
    close(heroRimTint([0, 0, 0]), [1, 1, 1])
  })
})
