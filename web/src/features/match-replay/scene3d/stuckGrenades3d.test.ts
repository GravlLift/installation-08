// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import type { ReplayGrenadeReady } from '@/lib/replay/replayReadyTypes'

import { stuckGrenadesOf, stuckPointAt, type BodyAt } from './stuckGrenades3d'

// The game winner of 9220185c: KamUz (613) sticks BC0R (606) at 13193, it goes off at 13222.
const STICK = { t: 13193, slot: 613, i: 3, x: 10.15, y: 5.3, rank: 1, s: 'biped', deto: { t: 13222, x: 9.69, y: 5.09, z: 5.02 } } as unknown as ReplayGrenadeReady

/** Bodies: the victim walks +x and turns from heading 0 to 90; the thrower dies at 13195. */
function sample(slot: number, f: number): BodyAt | null {
  if (slot === 606 && f >= 13000 && f <= 13222) return { x: 9.5 + (f - 13193) * 0.001, y: 5.0, z: 4.6, h: f < 13222 ? 0 : 0 }
  if (slot === 613 && f >= 13000 && f <= 13195) return { x: 10.3, y: 5.4, z: 4.6, h: 180 }
  return null
}

describe('stuckGrenadesOf', () => {
  it('places a point-blank stick on the living body nearest its detonation, from the throw to the explosion', () => {
    const [s] = stuckGrenadesOf([STICK], [606, 613], sample)
    expect(s).toMatchObject({ from: 13193, detoT: 13222, slot: 606, rank: 1 })
    // At the detonation it lands exactly on the film's published point.
    const p = stuckPointAt(s, sample(606, 13222)!)
    expect(p.x).toBeCloseTo(9.69, 6)
    expect(p.y).toBeCloseTo(5.09, 6)
    expect(p.z).toBeCloseTo(5.02, 6)
  })

  it('turns with the body: the same offset in the body frame at another heading', () => {
    const [s] = stuckGrenadesOf([STICK], [606, 613], sample)
    const p = stuckPointAt(s, { x: 0, y: 0, z: 0, h: 90 })
    // Forward (+x at heading 0) becomes +y at heading 90; left (+y) becomes -x.
    expect(p.y).toBeCloseTo(s.local.fwd, 6)
    expect(p.x).toBeCloseTo(-s.local.left, 6)
  })

  it('leaves out a flight, a non-body stick, and a stick no body is near', () => {
    expect(stuckGrenadesOf([{ ...STICK, proj: 4 } as ReplayGrenadeReady], [606], sample)).toEqual([])
    expect(stuckGrenadesOf([{ ...STICK, s: 'projectile' } as unknown as ReplayGrenadeReady], [606], sample)).toEqual([])
    const far = { ...STICK, deto: { ...STICK.deto!, x: 20 } } as ReplayGrenadeReady
    expect(stuckGrenadesOf([far], [606, 613], sample)).toEqual([])
  })
})
