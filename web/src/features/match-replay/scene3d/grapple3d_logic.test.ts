import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { FP_LEFT_HAND_IN_VIEW, fpCableStart, GRAPPLE_HOOK_FLIGHT_MS, grapplePhaseAt } from './grapple3d_logic'

/** 30 ms per frame: the 150 ms flight is five frames. */
const FRAME_MS = 30

describe('grapplePhaseAt — the hook flies, then holds, inside the measured pull', () => {
  const pull = { t0: 100, t1: 140 }

  it('shows nothing before the fire, after the arrival, or on an empty pull', () => {
    expect(grapplePhaseAt(pull, 99, FRAME_MS)).toBeNull()
    expect(grapplePhaseAt(pull, 140.01, FRAME_MS)).toBeNull()
    expect(grapplePhaseAt({ t0: 50, t1: 50 }, 50, FRAME_MS)).toBeNull()
  })

  it('the hook leaves the hand at the fire and reaches the anchor one measured flight later', () => {
    const flightFrames = GRAPPLE_HOOK_FLIGHT_MS / FRAME_MS
    expect(grapplePhaseAt(pull, 100, FRAME_MS)).toEqual({ reach: 0, attached: false })
    expect(grapplePhaseAt(pull, 100 + flightFrames / 2, FRAME_MS)?.reach).toBeCloseTo(0.5)
    expect(grapplePhaseAt(pull, 100 + flightFrames, FRAME_MS)).toEqual({ reach: 1, attached: true })
    expect(grapplePhaseAt(pull, 140, FRAME_MS)).toEqual({ reach: 1, attached: true })
  })

  it('a pull shorter than the flight lands its hook at the arrival', () => {
    const short = { t0: 10, t1: 12 }
    expect(grapplePhaseAt(short, 11, FRAME_MS)?.reach).toBeCloseTo(0.5)
    expect(grapplePhaseAt(short, 12, FRAME_MS)?.attached).toBe(true)
  })

  it('is a function of the frame alone (seeking back gives the same phase)', () => {
    const a = grapplePhaseAt(pull, 102, FRAME_MS)
    grapplePhaseAt(pull, 130, FRAME_MS)
    expect(grapplePhaseAt(pull, 102, FRAME_MS)).toEqual(a)
  })
})

describe('fpCableStart — the first-person cable leaves the viewer\'s left hand', () => {
  const eye = new THREE.Vector3(10, 2, -5)

  it('takes the rig\'s left hand when one is drawn', () => {
    const hand = new THREE.Vector3(9.8, 1.8, -5.3)
    expect(fpCableStart(eye, new THREE.Quaternion(), hand, new THREE.Vector3()).toArray()).toEqual(hand.toArray())
  })

  it('without a rig: low on the left of the view and in front of the eye, carried by the camera', () => {
    // A camera at rest looks along -Z with +X to its right.
    const rest = fpCableStart(eye, new THREE.Quaternion(), null, new THREE.Vector3())
    expect(rest.x).toBeLessThan(eye.x)
    expect(rest.y).toBeLessThan(eye.y)
    expect(rest.z).toBeLessThan(eye.z)
    expect(rest.distanceTo(eye)).toBeCloseTo(Math.hypot(FP_LEFT_HAND_IN_VIEW.x, FP_LEFT_HAND_IN_VIEW.y, FP_LEFT_HAND_IN_VIEW.z))
    // Turned 90 degrees to its left (now looking along -X, its right is -Z): the hand follows.
    const left = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
    const turned = fpCableStart(eye, left, null, new THREE.Vector3())
    expect(turned.x).toBeCloseTo(eye.x + FP_LEFT_HAND_IN_VIEW.z)
    expect(turned.z).toBeCloseTo(eye.z - FP_LEFT_HAND_IN_VIEW.x)
    expect(turned.y).toBeCloseTo(eye.y + FP_LEFT_HAND_IN_VIEW.y)
  })

  it('never starts from the body point behind the camera: the start is in front of the eye', () => {
    const look = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.1)
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(look)
    const start = fpCableStart(eye, look, null, new THREE.Vector3())
    expect(start.clone().sub(eye).dot(forward)).toBeGreaterThan(0)
  })
})