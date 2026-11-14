import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { redReticleTarget, readRedReticle, type ReticleTarget } from './redReticle3d'
import type { Tracks3d } from './tracks3d'

const ray = new THREE.Ray(new THREE.Vector3(0, 0.4, 0), new THREE.Vector3(1, 0, 0))
const target = (x: number, enemy = true): ReticleTarget => ({ feet: new THREE.Vector3(x, 0, 0), crouch: false, enemy })

describe('red reticle', () => {
  it('requires an enemy ahead and within range', () => {
    expect(redReticleTarget(ray, [target(5)], 10)).toBeCloseTo(4.88)
    expect(redReticleTarget(ray, [target(11)], 10)).toBeNull()
    expect(redReticleTarget(ray, [target(-5)], 10)).toBeNull()
    expect(redReticleTarget(ray, [target(5, false)], 10)).toBeNull()
  })

  it('uses the nearest body, including teammates', () => {
    expect(redReticleTarget(ray, [target(8), target(4, false)], 10)).toBeNull()
    expect(redReticleTarget(ray, [target(8, false), target(4)], 10)).toBeCloseTo(3.88)
    expect(redReticleTarget(ray, [target(8), target(4)], 10)).toBeCloseTo(3.88)
  })

  it('ignores dead enemies and respects walls', () => {
    const state = (x: number) => ({ x, y: 0, z: 0, h: 0, p: 0, crouch: false, dropOeil: 0, slot: 0 })
    const tracks = { players: [{ xuid: 'self' }, { xuid: 'enemy' }], sample: (id: string) => id === 'self' ? state(0) : state(5) } as unknown as Tracks3d
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(0, 0.4, 0)
    camera.lookAt(1, 0.4, 0)
    camera.updateMatrixWorld()
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2, 2), new THREE.MeshBasicMaterial())
    wall.position.x = 2
    wall.updateMatrixWorld()
    const opts = { tracks, frame: 0, xuid: 'self', camera, drop: 0, allegiance: { ofXuid: () => false }, surfaces: [] as THREE.Mesh[], raycaster: new THREE.Raycaster(), riderAt: () => null, range: 10 as number | null }
    expect(readRedReticle(opts)).toBe(true)
    expect(readRedReticle({ ...opts, surfaces: [wall] })).toBe(false)
    const dead = { ...tracks, sample: (id: string) => id === 'self' ? state(0) : null }
    expect(readRedReticle({ ...opts, tracks: dead })).toBe(false)
    // Two weapons, same enemy 5 wu away: the shorter range stays white, the longer turns red.
    expect(readRedReticle({ ...opts, range: 2.5 })).toBe(false)
    expect(readRedReticle({ ...opts, range: 18 })).toBe(true)
    // A weapon without a range is never red, even point-blank.
    expect(readRedReticle({ ...opts, range: null })).toBe(false)
  })
})
