/**
 * grenadeSound.test.ts — the throw and the explosion of a grenade: the throw stays without a
 * place for the followed player's own hand (same reasoning as a shot's muzzle), the explosion
 * always keeps its place — it lands away from the thrower, never "inside" him.
 */
import { describe, expect, it } from 'vitest'

import type { ReplayDocument } from '@/lib/api/types'
import { testReplayDoc } from '../test/testDoc'
import { grenadeSoundEvents } from './grenadeSound'

function doc(over: Partial<ReplayDocument> = {}) {
  return testReplayDoc({
    frameIntervalMs: 100,
    frameCount: 50,
    tracks: [{ slot: 1, team: 0, xuid: 'A', startFrame: 0, endFrame: 40, points: [{ t: 0, x: 3, y: 4, h: 0 }] }],
    grenades: [{ t: 0, i: 0, s: 'thrown', slot: 1, rank: 0, x: 3, y: 4 }],
    ...over,
  })
}

describe('grenadeSoundEvents', () => {
  it('without a followed player, the throw carries the thrower\'s position', () => {
    const [throwEv] = grenadeSoundEvents(doc(), [], null)
    expect(throwEv.stem).toBe('throw_frag')
    expect(throwEv.at).toEqual({ x: 3, y: 4 })
  })

  it("the followed player's own throw has no place", () => {
    const [throwEv] = grenadeSoundEvents(doc(), [], 'A')
    expect(throwEv.at).toBeUndefined()
  })
})
