// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * Tests: the Shock Rifle shot's arc look — a jagged bolt and its forks, a pure function of
 * (from, to, seed, bucket) whatever the order frames are drawn in; forks counted and sized by the
 * named constants; the impact's arcs from the tag's count, lives and size; the minimum width.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import {
  ARC_FORK_ANGLE_MAX,
  ARC_FORK_ANGLE_MIN,
  ARC_FORK_MAX,
  ARC_FORK_MIN,
  ARC_FORK_SPACING,
  ARC_FORK_WIDTH,
  ARC_FORKS_MAX,
  ARC_JAG_MAX,
  ARC_MAX_DEPTH,
  ARC_SIDE_DEPTH,
  ARC_STEP,
  IMPACT_ARC_LIFE_A,
  IMPACT_ARC_LIFE_B,
  IMPACT_ARC_RADIUS,
  IMPACT_ARC_SIZE,
  IMPACT_ARCS,
  boltDepth,
  forkCount,
  impactArcLife,
  jaggedPath,
  minWidthScale,
  shockArcStrokes,
  shockImpactArcs,
  type ArcStroke,
} from './shockArcShot3d'
import { shockJitterBucket } from './shockShots3d'

const flat = (strokes: readonly ArcStroke[]) => strokes.map((s) => ({ w: s.width, k: s.strength, p: s.points.map((v) => [v.x, v.y, v.z]) }))

/** The distance of `p` from the line through `a` and `b`. */
function offLine(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const d = new THREE.Vector3().subVectors(b, a).normalize()
  const v = new THREE.Vector3().subVectors(p, a)
  return v.sub(d.multiplyScalar(v.dot(d))).length()
}

describe('shockArcStrokes', () => {
  const from = new THREE.Vector3(0.374, 1.2, 0.043)
  const to = new THREE.Vector3(30, 2, -12)
  const len = from.distanceTo(to)

  it('draws the core bolt muzzle to end point, its ends kept, then the forks', () => {
    const s = shockArcStrokes(from, to, 41, 0)
    expect(s).toHaveLength(1 + forkCount(len))
    const core = s[0]
    expect(core.width).toBe(1)
    expect(core.strength).toBe(1)
    expect(core.points).toHaveLength((1 << boltDepth(len)) + 1)
    expect(core.points[0].toArray()).toEqual(from.toArray())
    expect(core.points[core.points.length - 1].toArray()).toEqual(to.toArray())
  })

  it('a jagged bolt, never straight, inside its corridor', () => {
    const core = shockArcStrokes(from, to, 41, 3)[0]
    const offs = core.points.map((p) => offLine(p, from, to))
    expect(Math.max(...offs)).toBeGreaterThan(0)
    // Each level adds at most ARC_JAG_MAX: the bolt never strays further than depth x the cap.
    expect(Math.max(...offs)).toBeLessThanOrEqual(boltDepth(len) * ARC_JAG_MAX + 1e-9)
  })

  it('is a pure function of (from, to, seed, bucket): out-of-order frames draw the same picture', () => {
    const ages = [0.01, 0.2, 0.06, 0.13, 0.01, 0.24, 0.06]
    const first = new Map<number, ReturnType<typeof flat>>()
    for (const age of ages) {
      const b = shockJitterBucket(age)
      const got = flat(shockArcStrokes(from, to, 41, b))
      const seen = first.get(b)
      if (seen) expect(got).toEqual(seen)
      else first.set(b, got)
    }
    // Evaluated backwards, the same frames.
    for (const age of [...ages].reverse()) expect(flat(shockArcStrokes(from, to, 41, shockJitterBucket(age)))).toEqual(first.get(shockJitterBucket(age)))
  })

  it('flickers per bucket and per shot: the interior and the forks move, the ends hold', () => {
    const a = shockArcStrokes(from, to, 41, 0)
    const b = shockArcStrokes(from, to, 41, 1)
    const c = shockArcStrokes(from, to, 42, 0)
    expect(flat(b)).not.toEqual(flat(a))
    expect(flat(c)).not.toEqual(flat(a))
    expect(b[0].points[0].toArray()).toEqual(a[0].points[0].toArray())
    expect(b[0].points[b[0].points.length - 1].toArray()).toEqual(a[0].points[a[0].points.length - 1].toArray())
  })

  it('forks from the constants: count, attach point, length, angle, width, strength', () => {
    for (const bucket of [0, 1, 2, 7]) {
      const s = shockArcStrokes(from, to, 9, bucket)
      const core = s[0]
      const interior = core.points.slice(1, -1).map((p) => p.toArray())
      const axis = new THREE.Vector3().subVectors(to, from).normalize()
      for (const f of s.slice(1)) {
        expect(f.width).toBe(ARC_FORK_WIDTH)
        expect(f.strength).toBeGreaterThanOrEqual(0.5)
        expect(f.strength).toBeLessThanOrEqual(1)
        expect(f.points).toHaveLength((1 << ARC_SIDE_DEPTH) + 1)
        // It leaves a bolt point, never an end.
        expect(interior).toContainEqual(f.points[0].toArray())
        const chord = new THREE.Vector3().subVectors(f.points[f.points.length - 1], f.points[0])
        expect(chord.length()).toBeGreaterThanOrEqual(ARC_FORK_MIN - 1e-9)
        expect(chord.length()).toBeLessThanOrEqual(ARC_FORK_MAX + 1e-9)
        const deg = THREE.MathUtils.radToDeg(chord.normalize().angleTo(axis))
        expect(deg).toBeGreaterThanOrEqual(ARC_FORK_ANGLE_MIN - 1e-6)
        expect(deg).toBeLessThanOrEqual(ARC_FORK_ANGLE_MAX + 1e-6)
      }
    }
  })

  it('counts its forks by length, capped; subdivides near ARC_STEP, capped', () => {
    expect(forkCount(0)).toBe(0)
    expect(forkCount(0.1)).toBe(1)
    expect(forkCount(ARC_FORK_SPACING * 6)).toBe(6)
    expect(forkCount(1000)).toBe(ARC_FORKS_MAX)
    expect(boltDepth(0.05)).toBe(2)
    expect(boltDepth(ARC_STEP * 16)).toBe(4)
    expect(boltDepth(1000)).toBe(ARC_MAX_DEPTH)
  })

  it('a zero-length shot draws nothing', () => {
    expect(shockArcStrokes(from, from.clone(), 1, 0)).toEqual([])
  })
})

describe('jaggedPath', () => {
  it('keeps both ends and 2^depth pieces', () => {
    const a = new THREE.Vector3(0, 0, 0)
    const b = new THREE.Vector3(0, 0, 2)
    const p = jaggedPath(a, b, 4, 0.4, 0.05, 123)
    expect(p).toHaveLength(17)
    expect(p[0].toArray()).toEqual([0, 0, 0])
    expect(p[16].toArray()).toEqual([0, 0, 2])
  })
})

describe('shockImpactArcs (effect ae231ce9)', () => {
  const to = new THREE.Vector3(5, 1, 2)
  const back = new THREE.Vector3(-1, 0, 0)

  it('throws the tag\'s two arcs, each living its own tag life', () => {
    expect(shockImpactArcs(to, back, 41, 0)).toHaveLength(IMPACT_ARCS)
    for (let i = 0; i < IMPACT_ARCS; i++) {
      const life = impactArcLife(41, i)
      expect(life).toBeGreaterThanOrEqual(Math.min(IMPACT_ARC_LIFE_A, IMPACT_ARC_LIFE_B))
      expect(life).toBeLessThanOrEqual(Math.max(IMPACT_ARC_LIFE_A, IMPACT_ARC_LIFE_B))
    }
    expect(shockImpactArcs(to, back, 41, Math.max(IMPACT_ARC_LIFE_A, IMPACT_ARC_LIFE_B))).toHaveLength(0)
    expect(shockImpactArcs(to, back, 41, -0.01)).toHaveLength(0)
  })

  it('born IMPACT_ARC_RADIUS off the point, on the muzzle side, growing to the tag\'s size', () => {
    const early = shockImpactArcs(to, back, 41, 0.01)
    const late = shockImpactArcs(to, back, 41, 0.1)
    for (let i = 0; i < early.length; i++) {
      const s = early[i].points[0]
      expect(s.distanceTo(to)).toBeCloseTo(IMPACT_ARC_RADIUS, 9)
      expect(new THREE.Vector3().subVectors(s, to).dot(back)).toBeGreaterThan(0)
      const reach = (st: ArcStroke) => st.points[0].distanceTo(st.points[st.points.length - 1])
      expect(reach(late[i])).toBeGreaterThan(reach(early[i]))
      expect(reach(late[i])).toBeLessThanOrEqual(IMPACT_ARC_SIZE.max + 1e-9)
      expect(reach(early[i])).toBeGreaterThanOrEqual(IMPACT_ARC_SIZE.min - 1e-9)
    }
  })

  it('holds its shape for its life (the particle\'s frame is fixed): same age, same arcs, any order', () => {
    const at = (age: number) => flat(shockImpactArcs(to, back, 41, age))
    const a = at(0.05)
    at(0.12)
    at(0.01)
    expect(at(0.05)).toEqual(a)
  })
})

describe('minWidthScale', () => {
  // A 1080-pixel-tall target, a vertical field of view of 70 degrees.
  const projYY = 1 / Math.tan(THREE.MathUtils.degToRad(35))

  it('leaves a piece that already spans the minimum alone', () => {
    expect(minWidthScale(0.0015, 0.4, projYY, 1080, 1.5)).toBe(1)
  })

  it('widens a far piece to the minimum pixels', () => {
    const perPx = (30 * 2) / (projYY * 1080)
    const k = minWidthScale(0.0015, 30, projYY, 1080, 1.5)
    expect(k).toBeGreaterThan(1)
    expect(2 * 0.0015 * k).toBeCloseTo(1.5 * perPx, 9)
  })
})
