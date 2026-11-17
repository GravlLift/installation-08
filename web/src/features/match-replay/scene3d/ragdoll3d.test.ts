// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { spartanSkeleton } from '../test/spartanSkeleton'
import { RagdollJob, SAMPLE_RATE, particlesOf, poseBake, type RagdollBake } from './ragdollBake3d'
import { P, PARTICLES, STICKS } from './ragdollBody3d'
import { deathKey } from './ragdollBakery3d'
import { bonesOf } from './ragdollBones3d'
import { blastSpeed, INHERIT_UP_MAX, kickVelocities, type KickInput, type KickKind } from './ragdollKick3d'
import { TrianglePatch, type TriangleSource } from './ragdollPatch3d'
import { createRagdoll, kickRagdoll, stepRagdoll } from './ragdollSolver3d'

/** A flat floor at height `y` (two large triangles), and a step `step` tall at x > 0.3. */
function floor(y = 0, step = 0): TriangleSource {
  const quad = (x0: number, x1: number, h: number) => [x0, h, -20, x1, h, 20, x1, h, -20, x0, h, -20, x0, h, 20, x1, h, 20]
  const riser = (x: number, h0: number, h1: number) => [x, h0, -20, x, h1, 20, x, h1, -20, x, h0, -20, x, h0, 20, x, h1, 20]
  const tris = step === 0 ? quad(-20, 20, y) : [...quad(-20, 0.3, y), ...riser(0.3, y, y + step), ...quad(0.3, 20, y + step)]
  return { trianglesIn: () => Float32Array.from(tris) }
}

const NONE: Omit<KickInput, 'kind'> = { velocity: [0, 0, 0], from: null, dir: [1, 0, 0], blast: null, vehicle: null, seed: 7 }

/** The test skeleton standing at feet `feet`, facing +X. */
function standing(feet = new THREE.Vector3()): { root: THREE.Group; bones: THREE.Bone[]; names: string[] } {
  const root = spartanSkeleton()
  root.position.copy(feet)
  root.updateMatrixWorld(true)
  const bones = bonesOf(root)
  return { root, bones, names: bones.map((b) => b.name) }
}

function bake(kind: KickKind, world = floor(), over: Partial<KickInput> = {}): RagdollBake {
  const s = standing()
  const job = RagdollJob.start({ bones: s.bones, names: s.names, feet: new THREE.Vector3(), yaw: 0, kick: { ...NONE, kind, ...over }, world })
  if (!job) throw new Error('bake refused')
  for (;;) {
    const done = job.advance(Infinity)
    if (done) return done
  }
}

describe('ragdoll body bake', () => {
  it('same death, same track bit for bit', () => {
    for (const kind of ['shot', 'blast'] as const) {
      const a = bake(kind)
      const b = bake(kind)
      expect(a.count).toBe(b.count)
      expect(Array.from(a.rot)).toEqual(Array.from(b.rot))
      expect(Array.from(a.pelvis)).toEqual(Array.from(b.pelvis))
    }
  })

  it('starts from the death pose, with no jump', () => {
    const b = bake('shot')
    const s = standing()
    const before = s.bones.map((bone) => bone.getWorldPosition(new THREE.Vector3()))
    poseBake(b, 0, s.bones)
    s.root.updateMatrixWorld(true)
    s.bones.forEach((bone, i) => expect(bone.getWorldPosition(new THREE.Vector3()).distanceTo(before[i])).toBeLessThan(2e-3))
  })

  it('the bones keep their length; the body ends up lying on the floor', () => {
    const b = bake('melee')
    const s = standing()
    const lengths = s.bones.map((bone) => bone.position.length())
    poseBake(b, 10, s.bones)
    s.root.updateMatrixWorld(true)
    s.bones.forEach((bone, i) => {
      if (bone.name !== 'b_pelvis') expect(bone.position.length()).toBeCloseTo(lengths[i], 5)
    })
    const head = (s.root.getObjectByName('b_head') as THREE.Bone).getWorldPosition(new THREE.Vector3())
    const pelvis = (s.root.getObjectByName('b_pelvis') as THREE.Bone).getWorldPosition(new THREE.Vector3())
    expect(head.y).toBeLessThan(0.2)
    expect(pelvis.y).toBeLessThan(0.15)
    expect(b.rested).toBe(true)
  })

  it('replays forward and backward: same instant, same pose; beyond it, the last pose holds', () => {
    const b = bake('blast')
    const s = standing()
    const snap = (t: number) => {
      poseBake(b, t, s.bones)
      return s.bones.flatMap((bone) => [...bone.quaternion.toArray(), ...bone.position.toArray()])
    }
    const times = [0, 0.37, 1.1, 0.5, 2, 0.37, 0]
    const seen = times.map(snap)
    expect(seen[5]).toEqual(seen[1])
    expect(seen[6]).toEqual(seen[0])
    const end = (b.count - 1) / SAMPLE_RATE
    expect(snap(end + 5)).toEqual(snap(end))
    // Between two samples, the pose is between the two (pelvis interpolated).
    const pelvis = b.index[0]
    const at = (t: number) => snap(t)[7 * pelvis + 5]
    const mid = at(1.5 / SAMPLE_RATE)
    expect(Math.min(at(1 / SAMPLE_RATE), at(2 / SAMPLE_RATE)) - 1e-9).toBeLessThanOrEqual(mid)
    expect(Math.max(at(1 / SAMPLE_RATE), at(2 / SAMPLE_RATE)) + 1e-9).toBeGreaterThanOrEqual(mid)
  })
})

describe('ragdoll body solver', () => {
  const run = (kind: KickKind, world: TriangleSource, seconds = 4) => {
    const s = standing()
    const x0 = particlesOf(s.bones) as Float64Array
    const st = createRagdoll(x0)
    kickRagdoll(st, kickVelocities({ ...NONE, kind, blast: kind === 'blast' ? [-0.3, 0.05, 0] : null, vehicle: [4, 0, 0] }, x0))
    const box = new THREE.Box3(new THREE.Vector3(-6, -3, -6), new THREE.Vector3(6, 3, 6))
    const patch = new TrianglePatch(world.trianglesIn(box), box)
    for (let k = 0; k < seconds * 120; k++) stepRagdoll(st, patch)
    return { st, x0 }
  }

  it('stays stable for 4 s for every kick: finite, above the floor, segments held, at rest', () => {
    for (const kind of ['none', 'shot', 'headshot', 'melee', 'blast', 'splatter'] as const) {
      const { st, x0 } = run(kind, floor())
      for (let i = 0; i < PARTICLES.length; i++) {
        expect(Number.isFinite(st.x[3 * i])).toBe(true)
        expect(st.x[3 * i + 1]).toBeGreaterThan(st.r[i] - 0.02)
      }
      STICKS.forEach(([a, b]) => {
        const d = (x: Float64Array) => Math.hypot(x[3 * a] - x[3 * b], x[3 * a + 1] - x[3 * b + 1], x[3 * a + 2] - x[3 * b + 2])
        expect(Math.abs(d(st.x) - d(x0)) / d(x0)).toBeLessThan(0.03)
      })
      let fastest = 0
      for (let i = 0; i < 3 * PARTICLES.length; i++) fastest = Math.max(fastest, Math.abs(st.x[i] - st.prev[i]) * 120)
      expect(fastest).toBeLessThan(0.1)
    }
  })

  it('a step: the body stays above the floor and the step', () => {
    const { st } = run('melee', floor(0, 0.25))
    for (let i = 0; i < PARTICLES.length; i++) {
      const ground = st.x[3 * i] > 0.3 ? 0.25 : 0
      expect(st.x[3 * i + 1]).toBeGreaterThan(ground + st.r[i] - 0.03)
    }
  })
})

describe('kickVelocities', () => {
  const s = standing()
  const x = particlesOf(s.bones) as Float64Array
  const v = (kind: KickKind, over: Partial<KickInput> = {}) => kickVelocities({ ...NONE, kind, ...over }, x)
  const at = (vel: Float64Array, name: Parameters<typeof P>[0]) => new THREE.Vector3(vel[3 * P(name)], vel[3 * P(name) + 1], vel[3 * P(name) + 2])

  it('with no killer: the inherited velocity alone, capped', () => {
    const still = v('none', { velocity: [1, 0, 0.5] })
    for (let i = 0; i < PARTICLES.length; i++) expect([still[3 * i], still[3 * i + 1], still[3 * i + 2]]).toEqual([1, 0, 0.5])
    expect(at(v('none', { velocity: [30, 0, 0] }), 'pelvis').length()).toBeCloseTo(3)
    // A player climbing moves up fast without being launched: the upward share is capped, not the downward one.
    expect(at(v('none', { velocity: [0, 3.3, 0] }), 'pelvis').y).toBeCloseTo(INHERIT_UP_MAX)
    expect(at(v('none', { velocity: [0, -2, 0] }), 'pelvis').y).toBeCloseTo(-2)
  })

  it('bullet: modest push along the shot, carried by the torso; headshot: by the head', () => {
    const from: [number, number, number] = [-5, 0.62, 0]
    const shot = v('shot', { from })
    expect(at(shot, 'chest').x).toBeGreaterThan(0.6)
    expect(at(shot, 'chest').length()).toBeLessThan(1.5)
    expect(at(shot, 'chest').x).toBeGreaterThan(at(shot, 'lAnkle').x)
    const head = v('headshot', { from })
    expect(at(head, 'head').x).toBeGreaterThan(at(head, 'chest').x)
    expect(at(head, 'head').x).toBeGreaterThan(at(shot, 'head').x)
  })

  it('melee: strong horizontal shove from the killer, lifted a little', () => {
    const m = at(v('melee', { from: [0, 0.62, -2] }), 'chest')
    expect(m.z).toBeGreaterThan(2)
    expect(m.y).toBeGreaterThan(0)
    expect(Math.abs(m.x)).toBeLessThan(0.5)
  })

  it('explosion: radial from the detonation, lifted, stronger the closer', () => {
    const b = v('blast', { blast: [-0.5, 0.1, 0] })
    expect(at(b, 'pelvis').x).toBeGreaterThan(0)
    expect(at(b, 'pelvis').y).toBeGreaterThan(0)
    expect(at(b, 'lAnkle').length()).toBeGreaterThan(at(b, 'head').length() - 1e-9)
    expect(blastSpeed(0.2)).toBeGreaterThan(blastSpeed(1.5))
    expect(blastSpeed(1.5)).toBeGreaterThan(blastSpeed(10) - 1e-9)
    expect(at(v('blast', { blast: [-0.5, 0.1, 0] }), 'chest').length()).toBeGreaterThan(at(v('melee'), 'chest').length())
  })

  it('splatter: the vehicle\'s velocity, lifted; with no vehicle, along the impulse', () => {
    const car = at(v('splatter', { vehicle: [0, 0, 5] }), 'pelvis')
    expect(car.z).toBeGreaterThan(4)
    expect(car.y).toBeGreaterThan(0.5)
    expect(at(v('splatter'), 'pelvis').x).toBeGreaterThan(3)
  })

  it('same seed, same twist', () => {
    expect(Array.from(v('shot', { seed: 3 }))).toEqual(Array.from(v('shot', { seed: 3 })))
    expect(Array.from(v('shot', { seed: 3 }))).not.toEqual(Array.from(v('shot', { seed: 4 })))
  })
})

describe('deathKey', () => {
  it('the same death from a rebuilt list keeps its key (and its bake); a different frame, not', () => {
    const body = { start: 12.25, fall: { kind: 'melee' } } as unknown as Parameters<typeof deathKey>[0]['body']
    const a = { victim: 'v', killer: 'k', frame: 12, body }
    expect(deathKey({ ...a })).toBe(deathKey(a))
    expect(deathKey({ ...a, frame: 13 })).not.toBe(deathKey(a))
  })
})
