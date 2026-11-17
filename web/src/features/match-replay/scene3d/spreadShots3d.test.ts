// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * The spread shot (the Heatwave): a level fan of bolts around the aim, each flying to the first
 * face, ricocheting once, and drawn as a fading trail at its projectile speed.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { familyOf } from '../layers/shotEffects'
import { formeVol } from './shots3d'
import {
  boltEndAge,
  boltPath,
  boltTrail,
  spreadDirections,
  SPREAD_BOLTS,
  SPREAD_BOUNCE_RANGE,
  SPREAD_HALF_ANGLE_DEG,
  SPREAD_RANGE,
  SPREAD_SPEED,
  SPREAD_TRAIL,
  SPREAD_TRAIL_PIECES,
  type FaceHit,
} from './spreadShots3d'

/** A wall at x = 10 facing -X, and nothing else. */
const wall: FaceHit = (from, dir, far) => {
  if (dir.x <= 0) return null
  const t = (10 - from.x) / dir.x
  if (t < 0 || t > far) return null
  return { point: from.clone().addScaledVector(dir, t), normal: new THREE.Vector3(-1, 0, 0) }
}

describe('the family', () => {
  it('is drawn: the document\'s `spread` is neither plain nor a tracer', () => {
    expect(familyOf('spread')).toBe('spread')
    expect(formeVol('spread')).toBe('spread')
  })
})

describe('spreadDirections — a level fan around the aim', () => {
  it('spreads the bolts horizontally, symmetric, over the fan angle', () => {
    const dirs = spreadDirections(new THREE.Vector3(1, 0, 0))
    expect(dirs).toHaveLength(SPREAD_BOLTS)
    for (const d of dirs) expect(d.y).toBeCloseTo(0)
    const half = (SPREAD_HALF_ANGLE_DEG * Math.PI) / 180
    expect(Math.abs(Math.atan2(dirs[0].z, dirs[0].x))).toBeCloseTo(half)
    expect(dirs[0].z).toBeCloseTo(-dirs[SPREAD_BOLTS - 1].z)
    expect(dirs[(SPREAD_BOLTS - 1) / 2].toArray().map((v) => +v.toFixed(6))).toEqual([1, 0, 0])
  })

  it('stays level with the aim when the shooter looks down', () => {
    const aim = new THREE.Vector3(1, -1, 0).normalize()
    for (const d of spreadDirections(aim)) expect(d.angleTo(aim)).toBeLessThanOrEqual((SPREAD_HALF_ANGLE_DEG * Math.PI) / 180 + 1e-9)
    // The fan's axis is the aim's up: every bolt keeps the aim's pitch component along it at zero.
    const up = new THREE.Vector3(1, 1, 0).normalize()
    for (const d of spreadDirections(aim)) expect(d.dot(up)).toBeCloseTo(0)
  })
})

describe('boltPath — to the first face, one ricochet', () => {
  it('bounces off the wall it meets and flies on for the ricochet range', () => {
    const p = boltPath(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), wall)
    expect(p.points).toHaveLength(3)
    expect(p.points[1].toArray()).toEqual([10, 1, 0])
    expect(p.points[2].x).toBeCloseTo(10 - SPREAD_BOUNCE_RANGE)
    expect(p.at[2]).toBeCloseTo(10 + SPREAD_BOUNCE_RANGE)
    expect(p.hit).toBe(false)
  })

  it('flies its range and dies out without a face', () => {
    const p = boltPath(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0), wall)
    expect(p.points).toHaveLength(2)
    expect(p.at[1]).toBe(SPREAD_RANGE)
  })
})

describe('boltTrail — a fading trail at the projectile speed', () => {
  const p = boltPath(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), wall)
  const pieces = (age: number) => {
    const out: { tail: THREE.Vector3; head: THREE.Vector3; k: number }[] = []
    const shown = boltTrail(p, age, (tail, head, k) => out.push({ tail: tail.clone(), head: head.clone(), k }))
    return { shown, out }
  }

  it('nothing before the pull', () => {
    expect(pieces(-0.01).shown).toBe(false)
  })

  it('flies out at its speed, bright at the head and fading toward the tail', () => {
    const { shown, out } = pieces(0.1)
    expect(shown).toBe(true)
    expect(out).toHaveLength(SPREAD_TRAIL_PIECES)
    expect(out[0].head.x).toBeCloseTo(0.1 * SPREAD_SPEED)
    expect(out[0].k).toBe(1)
    for (let i = 1; i < out.length; i++) {
      expect(out[i].k).toBeLessThan(out[i - 1].k)
      expect(out[i].head.x).toBeCloseTo(out[i - 1].tail.x)
    }
    expect(out[0].head.x - out.at(-1)!.tail.x).toBeCloseTo(SPREAD_TRAIL)
  })

  it('is shorter just after the pull, starting at the muzzle', () => {
    const { out } = pieces(0.5 / SPREAD_SPEED)
    expect(out.at(-1)!.tail.x).toBeCloseTo(0)
    expect(out[0].head.x).toBeCloseTo(0.5)
  })

  it('bends at the ricochet: no piece cuts the corner', () => {
    const { out } = pieces((10 + 0.5) / SPREAD_SPEED)
    expect(out[0].head.x).toBeCloseTo(9.5)
    for (const piece of out) expect(Math.max(piece.head.x, piece.tail.x)).toBeLessThanOrEqual(10 + 1e-9)
    expect(out.some((piece) => Math.abs(piece.tail.x - 10) < 1e-6 || Math.abs(piece.head.x - 10) < 1e-6)).toBe(true)
    const length = out.reduce((n, piece) => n + piece.head.distanceTo(piece.tail), 0)
    expect(length).toBeCloseTo(SPREAD_TRAIL)
  })

  it('drains into the end of the flight, then is gone', () => {
    const end = boltEndAge(p)
    expect(pieces(end + 0.5 / SPREAD_SPEED).shown).toBe(true)
    expect(pieces(end + (SPREAD_TRAIL + 1e-3) / SPREAD_SPEED).shown).toBe(false)
  })
})