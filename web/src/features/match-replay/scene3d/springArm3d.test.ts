/** springArm3d.test.ts — the third-person spring arm: pull-in on a hit, eased release on a clear line. */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ARM_CLEARANCE, ARM_EASE_OUT_TIME, ARM_MIN_DISTANCE, springArmLength } from './springArm3d'

const head = new THREE.Vector3(0, 0, 0)
const desired = (len: number) => new THREE.Vector3(0, 0, -len)
const FULL = Math.hypot(1.05, 0.2)
const DT = 1 / 60

describe('springArmLength', () => {
  it('keeps the full arm length when the line is clear', () => {
    expect(springArmLength(head, desired(FULL), null, FULL, DT)).toBeCloseTo(FULL)
  })

  it('pulls in to the hit immediately, in front of it by the clearance', () => {
    const len = springArmLength(head, desired(FULL), 0.6, FULL, DT)
    expect(len).toBeCloseTo(0.6 - ARM_CLEARANCE)
  })

  it('honors the minimum distance when the hit is closer than the clearance allows', () => {
    expect(springArmLength(head, desired(FULL), ARM_MIN_DISTANCE + ARM_CLEARANCE - 0.01, FULL, DT)).toBe(ARM_MIN_DISTANCE)
    expect(springArmLength(head, desired(FULL), 0, FULL, DT)).toBe(ARM_MIN_DISTANCE)
  })

  it('eases back out after the line clears, not instantly', () => {
    let len = springArmLength(head, desired(FULL), 0.6, FULL, DT)
    const oneStep = springArmLength(head, desired(FULL), null, len, DT)
    expect(oneStep).toBeGreaterThan(len)
    expect(oneStep).toBeLessThan(FULL)
    for (let i = 0; i < Math.ceil(ARM_EASE_OUT_TIME / DT); i++) {
      len = springArmLength(head, desired(FULL), null, len, DT)
    }
    // ~95% of the way back after 0.3 s...
    expect(FULL - len).toBeLessThan(0.05)
    // ...and at full length once the release has time to finish.
    for (let i = 0; i < Math.ceil(ARM_EASE_OUT_TIME / DT); i++) {
      len = springArmLength(head, desired(FULL), null, len, DT)
    }
    expect(len).toBeCloseTo(FULL)
  })

  it('does not move with a zero frame time', () => {
    expect(springArmLength(head, desired(FULL), null, 0.4, 0)).toBeCloseTo(0.4)
  })

  it('never lengthens past the hit while it persists', () => {
    let len = FULL
    for (let i = 0; i < 20; i++) len = springArmLength(head, desired(FULL), 0.6, len, DT)
    expect(len).toBeCloseTo(0.6 - ARM_CLEARANCE)
  })
})
