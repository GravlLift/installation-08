// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * Tests: a shot's game effects — the firing effect at every instance of the weapon's markers, the
 * flight effect riding the projectile at its speed and held at the hit for its death delay, the
 * impact effect from the projectile's arrival in the surface's frame; nothing for a weapon the
 * library has no shot for.
 */
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import type { ShotFxEntry } from '../model/shotFx'
import type { ActionContext } from './actionScene3d'
import {
  cameraInput,
  frameAlong,
  GameShotEffects,
  impactAxis,
  LOC_FORWARD,
  LOC_NORMAL,
  LOC_REFLECTION,
  parseShotEffects,
  shotSeconds,
  type ShotEffect,
  type WeaponShot,
} from './gameShotEffects3d'
import { CAMERA_INDEPENDENT, CAMERA_THIRD_PERSON, FN_CONSTANT, SYSTEM_KILLED_WITH_EVENT, type IdleSystem } from './weaponIdleEffects3dModel'

const TEXTURES = [
  { name: 'baseTexture', file: 'fx-262e7dba.png', layers: 4, srgb: true, signed: false },
  { name: 'alphaMap', file: 'fx-262e7dba.png', layers: 4, srgb: true, signed: false },
  { name: 'paletteTexture', file: 'fx-b5c0b591.png', layers: 1, srgb: true, signed: false },
]
const k = (v: number) => ({ type: FN_CONSTANT, input: 1, rangeInput: 3, min: v, max: v })

/** A system of one sprite living `life` s in an event of `d` s, at `location`. */
function system(particle: string, location: string, d: number, life: number, opts: Partial<IdleSystem> = {}, billboard = 0): IdleSystem {
  return {
    location, event: 0, eventFlags: 0, eventDuration: [d, d], coordinateSystem: 1, cameraMode: CAMERA_INDEPENDENT, flags: 0,
    sizeScale: 1, particle,
    emitter: {
      flags: 0, appearance: 0, particleFlags: 0, shape: 0, axisScale: [0, 0, 0], direction: [1, 0, 0],
      startingInterpolant: [0, 0, 0], billboard,
      properties: { startingCount: k(1), lifespan: k(life), size: k(0.03), intensity: k(200), tint: { ...k(0), color: [1, 1, 1] } },
    },
    render: { appearance: 0, blendMode: 9, shader: '9b1c511e', textures: TEXTURES, constants: { useAlphaMapRed: [1] } },
    ...opts,
  }
}

const EFFECTS: Record<string, ShotEffect> = {
  '136580d8': { effect: '136580d8', cameraRange: [0, 0], deathDelay: 0.1, systems: [system('muzzle', 'ee18be86', 0.2, 0.2, { cameraMode: CAMERA_THIRD_PERSON })] },
  '9f69be2d': { effect: '9f69be2d', cameraRange: [1, 120], deathDelay: 0.1, systems: [system('plume', 'b9820a92', 1, 1, { flags: SYSTEM_KILLED_WITH_EVENT }, 2)] },
  '3b3d55b3': { effect: '3b3d55b3', cameraRange: [0, 0], deathDelay: 0, systems: [system('core', LOC_NORMAL, 1.3, 0.5)] },
}

const SHOCK: WeaponShot = {
  projectile: '96555d72', initialVelocity: 50, finalVelocity: 50, maxRange: 100,
  firing: '136580d8', markers: { ee18be86: [[0.374, 0.043, 0], [0.386, 0.043, 0.009]] }, markerRotations: {},
  flight: ['9f69be2d'], impact: '3b3d55b3', impactFrom: 'material effects',
}

const INDEX = { shot_effects: { weapons: { '1a22fee6': SHOCK, bad: { flight: 'no' } }, effects: EFFECTS } }

async function setup(hit = true) {
  const root = new THREE.Group()
  const model = new THREE.Object3D()
  model.position.set(10, 2, 3)
  const hitFace = vi.fn(() => (hit ? { point: new THREE.Vector3(10, 0, 0), normal: new THREE.Vector3(-1, 0, 0) } : null))
  const ctx = {
    root,
    ground: { hitFace },
    weaponLibrary: () => '/api/weapons',
    drawnWeapon: (xuid: string) => (xuid === 'A' ? { model, source: model } : null),
    scopeMounted: () => false,
    cameraPosition: (out: THREE.Vector3) => out.set(0, 0, 0),
  } as unknown as ActionContext
  const fx = new GameShotEffects(ctx, () => Promise.resolve<unknown>(INDEX))
  fx.has('1a22fee6') // starts the index read
  await Promise.resolve()
  await Promise.resolve()
  const e = { seed: 3 } as unknown as ShotFxEntry
  const from = new THREE.Vector3(0, 0, 0)
  const dir = new THREE.Vector3(1, 0, 0)
  const at = (age: number, key = '1a22fee6', xuid: string | null = 'A') => {
    fx.begin()
    const drawn = fx.draw({ e, key, xuid, firstPerson: false, from, dir, age })
    fx.end()
    return drawn
  }
  const pools = () => root.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh)
  const count = (name: string) => pools().filter((p) => p.name === `game-shot-effect:${name}`).reduce((n, p) => n + (p.visible ? p.count : 0), 0)
  const position = (name: string) => {
    const p = pools().find((x) => x.name === `game-shot-effect:${name}`)!
    const m = new THREE.Matrix4()
    p.getMatrixAt(0, m)
    return new THREE.Vector3().setFromMatrixPosition(m)
  }
  return { fx, at, count, position, hitFace }
}

describe('GameShotEffects', () => {
  it('plays the firing effect at every marker instance of the drawn weapon, the flight at the projectile', async () => {
    const s = await setup()
    expect(s.at(0.1)).toBe(true)
    expect(s.count('muzzle')).toBe(2)
    expect(s.position('muzzle').x).toBeCloseTo(10.374)
    expect(s.count('plume')).toBe(1)
    // 50 u/s for 0.1 s.
    expect(s.position('plume').x).toBeCloseTo(5)
    expect(s.count('core')).toBe(0)
    s.fx.dispose()
  })

  it('holds the flight at the hit for its death delay, and plays the impact from the arrival', async () => {
    const s = await setup()
    s.at(0.25)
    expect(s.count('plume')).toBe(1)
    expect(s.position('plume').x).toBeCloseTo(10)
    expect(s.count('core')).toBe(1)
    expect(s.position('core').x).toBeCloseTo(10)
    s.at(0.31)
    expect(s.count('plume')).toBe(0)
    expect(s.count('core')).toBe(1)
    // The hit is traced once, to the projectile's range.
    expect(s.hitFace).toHaveBeenCalledTimes(1)
    expect(s.hitFace).toHaveBeenCalledWith(expect.any(THREE.Vector3), expect.any(THREE.Vector3), 100)
    s.fx.dispose()
  })

  it('plays no impact for a shot that hits nothing within range, and nothing for an unknown weapon', async () => {
    const s = await setup(false)
    s.at(2.1)
    expect(s.count('core')).toBe(0)
    expect(s.at(0.1, 'aaaaaaaa')).toBe(false)
    expect(s.count('plume')).toBe(0)
    s.fx.dispose()
  })

  it('draws no firing effect without a drawn weapon (no shape outside a drawn barrel)', async () => {
    const s = await setup()
    s.at(0.1, '1a22fee6', null)
    expect(s.count('muzzle')).toBe(0)
    expect(s.count('plume')).toBe(1)
    s.fx.dispose()
  })
})

describe('shot effect frames and timing', () => {
  it('reads the table and drops malformed weapons', () => {
    expect(parseShotEffects({ schema: 10 })).toBeNull()
    const t = parseShotEffects(INDEX)!
    expect(Object.keys(t.weapons)).toEqual(['1a22fee6'])
    expect(Object.keys(t.effects)).toHaveLength(3)
  })

  it('lives a flight to range, then the longer of the flight death delay and the impact', () => {
    const t = parseShotEffects(INDEX)!
    // 100 u at 50 u/s, then the impact's 1.3 s event and 0.5 s life.
    expect(shotSeconds(t, SHOCK)).toBeCloseTo(2 + 1.8)
  })

  it('builds a frame along its X, Y the world up made perpendicular', () => {
    const m = frameAlong(new THREE.Vector3(1, 2, 3), new THREE.Vector3(0, 0, 2), new THREE.Matrix4())
    const x = new THREE.Vector3()
    const y = new THREE.Vector3()
    const z = new THREE.Vector3()
    m.extractBasis(x, y, z)
    expect(x.toArray()).toEqual([0, 0, 1])
    expect(y.y).toBeCloseTo(1)
    // Right-handed: Z = X x Y.
    expect(z.x).toBeCloseTo(-1)
    // Straight up: another perpendicular.
    frameAlong(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), m).extractBasis(x, y, z)
    expect(Math.abs(x.dot(y))).toBeLessThan(1e-9)
  })

  it('orients the impact locations along the normal, the flight and its reflection', () => {
    const n = new THREE.Vector3(0, 1, 0)
    const d = new THREE.Vector3(1, -1, 0).normalize()
    const out = new THREE.Vector3()
    expect(impactAxis(LOC_NORMAL, n, d, out).toArray()).toEqual([0, 1, 0])
    expect(impactAxis(LOC_FORWARD, n, d, out).y).toBeCloseTo(-Math.SQRT1_2)
    expect(impactAxis(LOC_REFLECTION, n, d, out).y).toBeCloseTo(Math.SQRT1_2)
  })

  it('feeds the camera distance over the effect camera range', () => {
    const e = EFFECTS['9f69be2d']
    expect(cameraInput(e, 0)).toBe(0)
    expect(cameraInput(e, 60.5)).toBeCloseTo(0.5)
    expect(cameraInput(e, 500)).toBe(1)
    expect(cameraInput(EFFECTS['136580d8'], 30)).toBe(0)
  })
})
