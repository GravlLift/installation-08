/**
 * The spread shot (the Heatwave): a level fan of bolts around the aim, each flying to the first
 * face, ricocheting once, and drawn as a streak at its projectile speed.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { familyOf } from '../layers/shotEffects'
import { formeVol } from './shots3d'
import {
  boltEndAge,
  boltPath,
  boltStreak,
  spreadDirections,
  SPREAD_BOLTS,
  SPREAD_BOUNCE_RANGE,
  SPREAD_HALF_ANGLE_DEG,
  SPREAD_RANGE,
  SPREAD_SPEED,
  SPREAD_STREAK,
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

describe('boltStreak — a streak at the projectile speed', () => {
  const p = boltPath(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), wall)
  const tail = new THREE.Vector3()
  const head = new THREE.Vector3()

  it('nothing before the pull', () => {
    expect(boltStreak(p, -0.01, tail, head)).toBe(false)
  })

  it('flies out at its speed, its tail a streak behind', () => {
    expect(boltStreak(p, 0.1, tail, head)).toBe(true)
    expect(head.x).toBeCloseTo(0.1 * SPREAD_SPEED)
    expect(head.x - tail.x).toBeCloseTo(SPREAD_STREAK)
  })

  it('comes back off the wall after the ricochet, its tail not bent around it', () => {
    const age = (10 + 0.2) / SPREAD_SPEED
    expect(boltStreak(p, age, tail, head)).toBe(true)
    expect(head.x).toBeCloseTo(9.8)
    expect(tail.x).toBeCloseTo(10)
    boltStreak(p, (10 + 1) / SPREAD_SPEED, tail, head)
    expect(tail.x - head.x).toBeCloseTo(SPREAD_STREAK)
  })

  it('is gone at the end of its flight', () => {
    expect(boltStreak(p, boltEndAge(p) + 1e-6, tail, head)).toBe(false)
  })
})
