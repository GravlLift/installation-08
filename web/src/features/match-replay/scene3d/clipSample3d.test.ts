// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { fakeClip, fixtureClips } from '../test/spartanClips'
import { spartanSkeleton } from '../test/spartanSkeleton'
import { SpartanClips, type ClipTrack, type SpartanClip } from './clips3d'
import { ClipRig, framePosition, measureSyncPhases, newClipMix, type ClipMix } from './clipSample3d'

const Y = new THREE.Vector3(0, 1, 0)
const DEG = Math.PI / 180

/** turn: a rotation track for `bone` around Y, one angle (degrees) per frame. */
function turn(bone: string, degrees: readonly number[]): ClipTrack {
  const values = new Float32Array(4 * degrees.length)
  degrees.forEach((d, k) => new THREE.Quaternion().setFromAxisAngle(Y, d * DEG).toArray(values, 4 * k))
  return { bone, size: 4, values, keys: degrees.length }
}

function shift(bone: string, xs: readonly number[]): ClipTrack {
  const values = new Float32Array(3 * xs.length)
  xs.forEach((x, k) => values.set([x, 0, 0], 3 * k))
  return { bone, size: 3, values, keys: xs.length }
}

/** Two bones at rest (zero rotation, at (0, 0, 0) and (0, 1, 0)). */
function bones(): { root: THREE.Group; a: THREE.Bone; b: THREE.Bone } {
  const root = new THREE.Group()
  const a = new THREE.Bone()
  a.name = 'b_a'
  const b = new THREE.Bone()
  b.name = 'b_b'
  b.position.set(0, 1, 0)
  root.add(a)
  a.add(b)
  return { root, a, b }
}

const CLIPS = new SpartanClips([
  fakeClip('a90', 1, { tracks: [turn('b_a', [90]), turn('b_b', [30])] }),
  fakeClip('a0', 1, { tracks: [turn('b_a', [0])] }),
  fakeClip('sweep', 2, { tracks: [turn('b_a', [0, 90]), shift('b_a', [0, 2])] }),
])
const clip = (name: string) => CLIPS.get(name) as SpartanClip

function mix(base: [string, number, number, boolean][], over: [string, number, number][] = []): ClipMix {
  const m = newClipMix()
  base.forEach(([n, time, weight, loop], i) => Object.assign(m.base[i], { clip: clip(n), time, weight, loop }))
  over.forEach(([n, time, weight], i) => Object.assign(m.over[i], { clip: clip(n), time, weight, loop: false }))
  m.baseCount = base.length
  m.overCount = over.length
  return m
}

const yaw = (b: THREE.Bone) => (2 * Math.atan2(b.quaternion.y, b.quaternion.w)) / DEG

describe('framePosition', () => {
  const c = fakeClip('c', 10)
  it('a looping clip wraps to the start after its last frame; played once, it holds its edges', () => {
    expect(framePosition(c, 11 / 30, true)).toBeCloseTo(1)
    expect(framePosition(c, -1 / 30, true)).toBeCloseTo(9)
    expect(framePosition(c, 11 / 30, false)).toBe(9)
    expect(framePosition(c, -1, false)).toBe(0)
  })
})

describe('ClipRig.apply', () => {
  it("samples the pose at the clip's own frame rate", () => {
    const { root, a } = bones()
    const rapide = { ...fakeClip('rapide', 2, { tracks: [shift('b_a', [0, 2])] }), frameRate: 60 }
    const rig = new ClipRig(root, new SpartanClips([rapide]))
    const m = newClipMix(1, 0)
    Object.assign(m.base[0], { clip: rapide, time: 1 / 120, weight: 1, loop: false })
    m.baseCount = 1
    rig.apply(m)
    expect(a.position.x).toBeCloseTo(1)
  })
  it('blends the base layers in a weighted average', () => {
    const { root, a } = bones()
    const rig = new ClipRig(root, CLIPS)
    rig.apply(mix([['a90', 0, 0.5, true], ['a0', 0, 0.5, true]]))
    expect(yaw(a)).toBeCloseTo(45, 4)
    rig.apply(mix([['a90', 0, 0.25, true], ['a0', 0, 0.75, true]]))
    expect(yaw(a)).toBeCloseTo(22.5, 4)
  })

  it('the weight share no layer gives returns to rest', () => {
    const { root, a, b } = bones()
    const rig = new ClipRig(root, CLIPS)
    rig.apply(mix([['a90', 0, 0.5, true]]))
    expect(yaw(a)).toBeCloseTo(45, 4)
    // b_b is only animated by a90: at half weight, halfway to its rest pose.
    expect(yaw(b)).toBeCloseTo(15, 4)
    rig.apply(mix([['a0', 0, 1, true]]))
    expect(yaw(b)).toBeCloseTo(0, 6)
    expect(b.position.y).toBe(1)
  })

  it('an over layer replaces, at its weight, the bones it animates; the others keep the base', () => {
    const { root, a, b } = bones()
    const rig = new ClipRig(root, CLIPS)
    rig.apply(mix([['a90', 0, 1, true]], [['a0', 0, 1]]))
    expect(yaw(a)).toBeCloseTo(0, 6)
    expect(yaw(b)).toBeCloseTo(30, 4)
    rig.apply(mix([['a90', 0, 1, true]], [['a0', 0, 0.5]]))
    expect(yaw(a)).toBeCloseTo(45, 4)
  })

  it('interpolates between two frames; looping, the last frame joins the first', () => {
    const { root, a } = bones()
    const rig = new ClipRig(root, CLIPS)
    rig.apply(mix([['sweep', 0.5 / 30, 1, false]]))
    expect(yaw(a)).toBeCloseTo(45, 4)
    expect(a.position.x).toBeCloseTo(1, 6)
    rig.apply(mix([['sweep', 1.5 / 30, 1, true]]))
    expect(yaw(a)).toBeCloseTo(45, 4)
    expect(a.position.x).toBeCloseTo(1, 6)
    rig.apply(mix([['sweep', 1.5 / 30, 1, false]]))
    expect(yaw(a)).toBeCloseTo(90, 4)
  })

  it('pure: a mix replayed after others renders the bones down to the bit', () => {
    const { root, a, b } = bones()
    const rig = new ClipRig(root, CLIPS)
    const m = mix([['sweep', 0.7 / 30, 0.6, true], ['a90', 0, 0.4, true]], [['a0', 0, 0.3]])
    const snap = () => [...a.quaternion.toArray(), ...a.position.toArray(), ...b.quaternion.toArray()]
    rig.apply(m)
    const first = snap()
    rig.apply(mix([['a0', 0, 1, true]]))
    rig.apply(mix([['sweep', 1.2 / 30, 0.3, true]], [['a90', 0, 1]]))
    rig.apply(m)
    expect(snap()).toEqual(first)
  })
})

describe('ClipRig.ensureClip', () => {
  /** Three bones at rest: b_a and b_b (the catalog's), b_c (a pose-only bone, never in the catalog). */
  function threeBones(): { root: THREE.Group; a: THREE.Bone; b: THREE.Bone; c: THREE.Bone } {
    const root = new THREE.Group()
    const a = new THREE.Bone()
    a.name = 'b_a'
    const b = new THREE.Bone()
    b.name = 'b_b'
    b.position.set(0, 1, 0)
    const c = new THREE.Bone()
    c.name = 'b_c'
    c.position.set(0, 0, 2)
    root.add(a)
    a.add(b)
    a.add(c)
    return { root, a, b, c }
  }

  const gameplay = fakeClip('combat:idle', 1, { tracks: [turn('b_a', [90]), turn('b_b', [30])] })
  const pose = fakeClip('pose:stance', 1, { tracks: [turn('b_c', [60])] })

  it('drives a bone the catalog never animated, and lets it rest', () => {
    const { root, c } = threeBones()
    const rig = new ClipRig(root, new SpartanClips([gameplay]))
    expect(rig.bones.length).toBe(2)
    rig.ensureClip(pose)
    expect(rig.bones.length).toBe(3)
    // At weight 1 the third bone takes the clip's pose...
    const m = newClipMix(1, 0)
    Object.assign(m.base[0], { clip: pose, time: 0, weight: 1, loop: false })
    m.baseCount = 1
    rig.apply(m)
    expect(yaw(c)).toBeCloseTo(60, 4)
    // ...and with no weight it returns to its rest (the pose was captured from that rest).
    Object.assign(m.base[0], { weight: 0 })
    rig.apply(m)
    expect(yaw(c)).toBeCloseTo(0, 6)
    expect(c.position.z).toBe(2)
  })

  it('keeps the original bones working after a clip is added', () => {
    const { root, a, b } = threeBones()
    const rig = new ClipRig(root, new SpartanClips([gameplay]))
    rig.ensureClip(pose)
    const m = newClipMix(1, 0)
    Object.assign(m.base[0], { clip: gameplay, time: 0, weight: 1, loop: false })
    m.baseCount = 1
    rig.apply(m)
    expect(yaw(a)).toBeCloseTo(90, 4)
    expect(yaw(b)).toBeCloseTo(30, 4)
  })

  it('is a no-op for a clip already bound', () => {
    const { root } = threeBones()
    const rig = new ClipRig(root, new SpartanClips([gameplay]))
    rig.ensureClip(pose)
    const n = rig.bones.length
    rig.ensureClip(pose)
    expect(rig.bones.length).toBe(n)
  })

  it('binds a clip on the fly when it appears in a mix', () => {
    const { root, c } = threeBones()
    const rig = new ClipRig(root, new SpartanClips([gameplay]))
    const m = newClipMix(1, 0)
    Object.assign(m.base[0], { clip: pose, time: 0, weight: 1, loop: false })
    m.baseCount = 1
    rig.apply(m)
    expect(yaw(c)).toBeCloseTo(60, 4)
  })
})

describe('measureSyncPhases', () => {
  it('finds the frame where the left foot leads furthest; stationary clips stay at 0', () => {
    const root = spartanSkeleton()
    const clips = fixtureClips(root)
    for (const name of clips.names()) (clips.get(name) as SpartanClip).sync = 0
    measureSyncPhases(root, clips)
    const run = clips.get('combat:rifle:locomote_run_front') as SpartanClip
    // The fixture's thighs swing sinusoidally: the left foot leads at a quarter of the cycle.
    expect(Math.abs(run.sync - 0.25)).toBeLessThanOrEqual(1 / run.frames)
    expect(clips.get('combat:rifle:idle')?.sync).toBe(0)
    // The source is never posed: its bones keep their rest pose.
    const fresh = spartanSkeleton()
    expect((root.getObjectByName('b_l_thigh') as THREE.Bone).quaternion.angleTo((fresh.getObjectByName('b_l_thigh') as THREE.Bone).quaternion)).toBe(0)
  })
})
