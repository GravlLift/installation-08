// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { flyDelta } from './freeFly3d'

describe('flyDelta', () => {
  const ahead = new THREE.Vector3(0, 0, -1)

  it('advances along the aim, at 4 units per second', () => {
    const d = flyDelta(new Set(['KeyW']), ahead, 0.05, false)!
    expect(d.z).toBeCloseTo(-0.2)
    expect(d.x).toBeCloseTo(0)
  })

  it('strafes right, rises, and Shift triples the speed', () => {
    expect(flyDelta(new Set(['KeyD']), ahead, 0.05, false)!.x).toBeCloseTo(0.2)
    expect(flyDelta(new Set(['KeyE']), ahead, 0.05, true)!.y).toBeCloseTo(0.6)
  })

  it('a diagonal moves at the same speed, two opposite keys cancel out', () => {
    expect(flyDelta(new Set(['KeyW', 'KeyD']), ahead, 0.05, false)!.length()).toBeCloseTo(0.2)
    expect(flyDelta(new Set(['KeyW', 'KeyS']), ahead, 0.05, false)).toBeNull()
    expect(flyDelta(new Set(['KeyK']), ahead, 0.05, false)).toBeNull()
  })

  it("a skipped frame doesn't teleport: the step is capped", () => {
    expect(flyDelta(new Set(['KeyW']), ahead, 5, false)!.length()).toBeCloseTo(0.4)
  })
})
