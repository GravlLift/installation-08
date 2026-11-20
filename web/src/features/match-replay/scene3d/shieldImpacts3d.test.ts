// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import type { ShotFxEntry } from '../model/shotFx'
import { BODY_CENTER, EYE_HEIGHT } from './body3d'
import {
  carryWithBody, pairShot, passesThroughBody, raySegmentDistance, ShieldImpacts, SHOT_PAIR_FRAMES,
  type FlightLine, type ImpactSources,
} from './shieldImpacts3d'
import { aimDirThree, toThree, type PlayerState3d } from './tracks3d'

const VICTIM = 1
const SHOOTER = 2
const FPS = 30
const LIFE = 1
const FLOOR = 0.1

function shot(frame: number, over: Partial<ShotFxEntry> = {}): ShotFxEntry {
  return { frame, time: frame, slot: SHOOTER, x: 10, y: 0, h: 180, fam: 'light', tint: 'kinetic', seed: 1, vehicleShot: null, ...over } as ShotFxEntry
}

function state(slot: number, x: number, y: number, h = 0): PlayerState3d {
  return { x, y, z: FLOOR, h, p: 0, crouch: false, dropOeil: 0, slot }
}

/** A victim at the origin facing heading 0, a shooter 10 u away; `moved` places the victim from frame 20. */
function sources(damages: unknown[], opts: { sh?: number; moved?: PlayerState3d; flightLine?: FlightLine } = {}): ImpactSources {
  const doc = {
    damages,
    tracks: [
      { slot: VICTIM, points: [{ t: 0, sh: opts.sh ?? 1 }] },
      { slot: SHOOTER, points: [{ t: 0 }] },
    ],
  } as unknown as ReplayDocumentReady
  return {
    doc,
    originAboveFloor: FLOOR,
    slotState: (slot, f) => (slot === VICTIM ? (opts.moved && f >= 20 ? opts.moved : state(VICTIM, 0, 0)) : state(SHOOTER, 10, 0, 180)),
    flightLine: opts.flightLine,
  }
}

function feet(x: number, y: number): THREE.Vector3 {
  const [tx, , tz] = toThree(x, y, 0)
  return new THREE.Vector3(tx, 0, tz)
}

describe('pairShot', () => {
  it('pairs a damage with its author shot of the same frame, else of the frame before', () => {
    const d = { slot: VICTIM, by: SHOOTER, t: 10 }
    expect(pairShot([shot(10)], d)?.frame).toBe(10)
    expect(pairShot([shot(10 - SHOT_PAIR_FRAMES)], d)?.frame).toBe(10 - SHOT_PAIR_FRAMES)
    expect(pairShot([shot(9), shot(10)], d)?.frame).toBe(10)
    expect(pairShot([shot(8)], d)).toBeNull()
    expect(pairShot([shot(11)], d)).toBeNull()
  })
})

describe('the ray geometry', () => {
  it('raySegmentDistance and passesThroughBody', () => {
    const a = new THREE.Vector3(0, 0, 0)
    const b = new THREE.Vector3(0, 1, 0)
    expect(raySegmentDistance(new THREE.Vector3(5, 0.5, 0), new THREE.Vector3(-1, 0, 0), a, b)).toBeCloseTo(0, 6)
    expect(raySegmentDistance(new THREE.Vector3(5, 0.5, 0.3), new THREE.Vector3(-1, 0, 0), a, b)).toBeCloseTo(0.3, 6)
    // Pointing away: the ray starts beside the segment.
    expect(raySegmentDistance(new THREE.Vector3(5, 0.5, 0), new THREE.Vector3(1, 0, 0), a, b)).toBeCloseTo(5, 6)
    const f = new THREE.Vector3(0, 0, 0)
    expect(passesThroughBody(new THREE.Vector3(5, BODY_CENTER, 0), new THREE.Vector3(-1, 0, 0), f)).toBe(true)
    expect(passesThroughBody(new THREE.Vector3(5, BODY_CENTER, 0.5), new THREE.Vector3(-1, 0, 0), f)).toBe(false)
  })

  it('carryWithBody moves a point and a direction with the body', () => {
    const then = new THREE.Vector3(0, 0, 0)
    const now = new THREE.Vector3(3, 0, -2)
    const ahead = new THREE.Vector3(...aimDirThree(0, 0))
    const p = carryWithBody(ahead.clone(), false, then, 0, now, 90)
    const want = new THREE.Vector3(...aimDirThree(90, 0)).add(now)
    expect(p.distanceTo(want)).toBeLessThan(1e-9)
    const d = carryWithBody(ahead.clone(), true, then, 0, now, 90)
    expect(d.distanceTo(new THREE.Vector3(...aimDirThree(90, 0)))).toBeLessThan(1e-9)
  })
})

describe('ShieldImpacts', () => {
  const hit = { slot: VICTIM, by: SHOOTER, t: 10 }

  it('a shielded hit with its shot: the eye ray toward the body center, aged from the shot', () => {
    const out = new ShieldImpacts(sources([hit])).at(VICTIM, 13, FPS, LIFE, [shot(10)])
    expect(out).toHaveLength(1)
    expect(out[0].age).toBeCloseTo(3 / FPS, 9)
    const eye = feet(10, 0).setY(EYE_HEIGHT)
    expect(out[0].origin.distanceTo(eye)).toBeLessThan(1e-9)
    const toCenter = new THREE.Vector3(0, BODY_CENTER, 0).sub(eye).normalize()
    expect(out[0].dir.distanceTo(toCenter)).toBeLessThan(1e-9)
  })

  it('draws nothing for a hit with no attributable shot, no author, self damage, bare health, or past its life', () => {
    expect(new ShieldImpacts(sources([hit])).at(VICTIM, 13, FPS, LIFE, [])).toHaveLength(0)
    expect(new ShieldImpacts(sources([hit])).at(VICTIM, 13, FPS, LIFE, [shot(7)])).toHaveLength(0)
    expect(new ShieldImpacts(sources([{ slot: VICTIM, t: 10 }])).at(VICTIM, 13, FPS, LIFE, [shot(10)])).toHaveLength(0)
    expect(new ShieldImpacts(sources([{ slot: VICTIM, by: VICTIM, t: 10 }])).at(VICTIM, 13, FPS, LIFE, [shot(10, { slot: VICTIM })])).toHaveLength(0)
    expect(new ShieldImpacts(sources([hit], { sh: 0 })).at(VICTIM, 13, FPS, LIFE, [shot(10)])).toHaveLength(0)
    expect(new ShieldImpacts(sources([hit])).at(VICTIM, 10 + LIFE * FPS, FPS, LIFE, [shot(10)])).toHaveLength(0)
    // Before the shot: nothing yet.
    expect(new ShieldImpacts(sources([hit])).at(VICTIM, 9, FPS, LIFE, [shot(10)])).toHaveLength(0)
  })

  it('several hits overlap, the youngest first, and the answer is the same on every call (frozen frame)', () => {
    const impacts = new ShieldImpacts(sources([hit, { slot: VICTIM, by: SHOOTER, t: 14 }]))
    const shots = [shot(10), shot(14, { time: 14.4 })]
    const ages = impacts.at(VICTIM, 16, FPS, LIFE, shots).map((i) => i.age)
    expect(ages[0]).toBeCloseTo(1.6 / FPS, 9)
    expect(ages[1]).toBeCloseTo(6 / FPS, 9)
    expect(impacts.at(VICTIM, 16, FPS, LIFE, shots).map((i) => i.age)).toEqual(ages)
  })

  it('follows the drawn tracer when it crosses the body, else aims from its muzzle at the body center', () => {
    const muzzle = feet(10, 0).setY(0.5)
    const through: FlightLine = () => ({ from: muzzle, to: new THREE.Vector3(-20, 0.5, 0) })
    const along = new ShieldImpacts(sources([hit], { flightLine: through })).at(VICTIM, 12, FPS, LIFE, [shot(10)])[0]
    expect(along.origin.distanceTo(muzzle)).toBeLessThan(1e-9)
    expect(along.dir.distanceTo(new THREE.Vector3(-20, 0.5, 0).sub(muzzle).normalize())).toBeLessThan(1e-9)
    const wide: FlightLine = () => ({ from: muzzle, to: new THREE.Vector3(-20, 0.5, 8) })
    const aimed = new ShieldImpacts(sources([hit], { flightLine: wide })).at(VICTIM, 12, FPS, LIFE, [shot(10)])[0]
    expect(aimed.dir.distanceTo(new THREE.Vector3(0, BODY_CENTER, 0).sub(muzzle).normalize())).toBeLessThan(1e-9)
  })

  it('carries the ray with the victim body when it moves after the hit', () => {
    const moved = state(VICTIM, 2, 1, 90)
    const out = new ShieldImpacts(sources([hit], { moved })).at(VICTIM, 20, FPS, LIFE, [shot(10)])[0]
    const eye = feet(10, 0).setY(EYE_HEIGHT)
    const want = carryWithBody(eye.clone(), false, feet(0, 0), 0, feet(2, 1), 90)
    expect(out.origin.distanceTo(want)).toBeLessThan(1e-9)
  })
})
