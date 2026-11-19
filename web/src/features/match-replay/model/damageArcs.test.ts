// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * damageArcs.test.ts — the data behind the HUD's directional damage indicator: which arcs are
 * live for the followed player at a frame, at what bearing relative to their view, and how old
 * they are. The heading convention is the one of `spatialOf` in soundSpatial.ts (heading 0
 * faces +X, right = (sin h, -cos h); hence a source to +Y is LEFT), pinned here too.
 */
import { describe, expect, it } from 'vitest'

import { testReplayDoc } from '../test/testDoc'
import { frameToMs } from '@/lib/replay/replayLogic'
import { DAMAGE_ARC_MS, damageArcsAt, type DamageArc } from './damageArcs'
import { prepareHud, readHud } from './hud3d_logic'

/** The followed player: slot 512, xuid 'A', alive frames 0-200, at the origin, with a heading. */
const PLAYER = { slot: 512, xuid: 'A', team: -1, startFrame: 0, endFrame: 200 }
/** The attacker: slot 99, xuid 'B', alive frames 0-200. */
const ATTACKER = { slot: 99, xuid: 'B', team: 1, startFrame: 0, endFrame: 200 }

/** The sentinel for "the damage has no author" — distinct from an omitted `by` (default slot 99). */
const NO_AUTHOR = Symbol('no author')

/**
 * A document whose player faces `heading` at the origin and is hit at `hitFrame` by `by` at
 * (attackerX, attackerY). The default author is slot 99; pass `by: NO_AUTHOR` to build a damage
 * with no author, and `attacker: false` to drop the attacker track.
 */
function hitDoc(over: { hitFrame?: number; by?: number | typeof NO_AUTHOR; attacker?: boolean; heading?: number; attackerX?: number; attackerY?: number; turnAt?: number; turnTo?: number } = {}) {
  const hitFrame = over.hitFrame ?? 10
  const heading = over.heading ?? 0
  const noAuthor = over.by === NO_AUTHOR
  const by: number = noAuthor ? 0 : (over.by as number | undefined) ?? 99
  const turnAt = over.turnAt
  const turnTo = over.turnTo ?? 90
  const points = turnAt == null
    ? [{ t: 0, x: 0, y: 0, h: heading }, { t: 200, x: 0, y: 0, h: heading }]
    : [{ t: 0, x: 0, y: 0, h: heading }, { t: turnAt, x: 0, y: 0, h: heading }, { t: turnAt + 10, x: 0, y: 0, h: turnTo }, { t: 200, x: 0, y: 0, h: turnTo }]
  return testReplayDoc({
    frameIntervalMs: 100,
    tracks: [
      { ...PLAYER, points },
      ...(over.attacker === false ? [] : [{ ...ATTACKER, points: [{ t: 0, x: over.attackerX ?? 10, y: over.attackerY ?? 0 }, { t: 200, x: over.attackerX ?? 10, y: over.attackerY ?? 0 }] }]),
    ],
    damages: noAuthor ? [{ t: hitFrame, slot: 512 }] : [{ t: hitFrame, slot: 512, by }],
  })
}

/** The single arc the document should carry, or null when it should carry none. */
function arcAt(doc: Parameters<typeof damageArcsAt>[0], frame: number, slot = 512): DamageArc | null {
  const arcs = damageArcsAt(doc, slot, frame)
  return arcs.length === 1 ? arcs[0] : arcs.length === 0 ? null : (new Error(`expected one arc, got ${arcs.length}`) as unknown as DamageArc)
}

describe('damageArcsAt: the bearing, by the convention of spatialOf', () => {
  // Facing +X (heading 0): right is (0, -1), so +Y is LEFT and -Y is RIGHT.
  it('is ~0 for an attacker straight ahead', () => {
    const arc = arcAt(hitDoc({ attackerX: 10, attackerY: 0 }), 10)
    expect(arc).not.toBeNull()
    expect(arc!.bearingDeg).toBeCloseTo(0, 6)
  })

  it('is ~+90 for an attacker to the right', () => {
    const arc = arcAt(hitDoc({ attackerX: 0, attackerY: -10 }), 10)
    expect(arc!.bearingDeg).toBeCloseTo(90, 6)
  })

  it('is ~-90 for an attacker to the left', () => {
    const arc = arcAt(hitDoc({ attackerX: 0, attackerY: 10 }), 10)
    expect(arc!.bearingDeg).toBeCloseTo(-90, 6)
  })

  it('is ~180 (or -180) for an attacker behind', () => {
    const arc = arcAt(hitDoc({ attackerX: -10, attackerY: 0 }), 10)
    expect(Math.abs(arc!.bearingDeg)).toBeCloseTo(180, 6)
  })

  it('is ~45 for an attacker between ahead and right', () => {
    const arc = arcAt(hitDoc({ attackerX: 10, attackerY: -10 }), 10)
    expect(arc!.bearingDeg).toBeCloseTo(45, 6)
  })
})

describe('damageArcsAt: the arc follows the view', () => {
  // A turn that completes by frame 11 (span 11 frames is beyond the heading interp max span of 10,
  // so the heading HOLDS at 0 until frame 11, then snaps to the new heading). Both check frames
  // sit inside the arc lifetime (hit at 10, lifetime 10 frames).
  it('swings when the victim turns after the hit: the same hit, a later frame, a different bearing', () => {
    // Hit at 10 by an attacker straight ahead (10, 0); the player snaps right (heading 90) at 11.
    const doc = testReplayDoc({
      frameIntervalMs: 100,
      tracks: [
        { ...PLAYER, points: [{ t: 0, x: 0, y: 0, h: 0 }, { t: 11, x: 0, y: 0, h: 90 }, { t: 200, x: 0, y: 0, h: 90 }] },
        { ...ATTACKER, points: [{ t: 0, x: 10, y: 0 }, { t: 200, x: 10, y: 0 }] },
      ],
      damages: [{ t: 10, slot: 512, by: 99 }],
    })
    // Still facing +X at the hit frame: the attacker is straight ahead.
    expect(arcAt(doc, 10)!.bearingDeg).toBeCloseTo(0, 6)
    // Facing +Y two frames later, the right is +X: the attacker at +X is to the player's RIGHT.
    expect(arcAt(doc, 12)!.bearingDeg).toBeCloseTo(90, 6)
    // A snap of 180 puts the attacker behind.
    const turned = testReplayDoc({
      frameIntervalMs: 100,
      tracks: [
        { ...PLAYER, points: [{ t: 0, x: 0, y: 0, h: 0 }, { t: 11, x: 0, y: 0, h: 180 }, { t: 200, x: 0, y: 0, h: 180 }] },
        { ...ATTACKER, points: [{ t: 0, x: 10, y: 0 }, { t: 200, x: 10, y: 0 }] },
      ],
      damages: [{ t: 10, slot: 512, by: 99 }],
    })
    expect(arcAt(turned, 12)!.bearingDeg).toBeCloseTo(180, 6)
  })
})

describe('damageArcsAt: the hits with no arc', () => {
  it('keeps no arc when the damage has no author (`by` absent)', () => {
    expect(damageArcsAt(hitDoc({ by: NO_AUTHOR }), 512, 10)).toEqual([])
  })

  it('keeps no arc for self damage (`by` equal to the slot)', () => {
    expect(damageArcsAt(hitDoc({ by: 512 }), 512, 10)).toEqual([])
  })

  it('keeps no arc when the attacker has no track on the document', () => {
    expect(damageArcsAt(hitDoc({ attacker: false }), 512, 10)).toEqual([])
  })

  it('keeps no arc before the hit, or for a damage to another life', () => {
    const doc = hitDoc({})
    expect(damageArcsAt(doc, 512, 9)).toEqual([])
    expect(damageArcsAt(doc, 10, 99)).toEqual([])
  })
})

describe('damageArcsAt: the lifetime', () => {
  it('is live at the hit frame and ages with the frame', () => {
    const doc = hitDoc({ hitFrame: 10 })
    expect(arcAt(doc, 10)!.ageMs).toBe(0)
    expect(arcAt(doc, 15)!.ageMs).toBe(frameToMs(15, doc) - frameToMs(10, doc))
  })

  it('is present just after the hit, gone at DAMAGE_ARC_MS', () => {
    const doc = hitDoc({ hitFrame: 10 })
    expect(arcAt(doc, 10 + DAMAGE_ARC_MS / 2 / 100)).not.toBeNull()
    expect(damageArcsAt(doc, 512, 10 + DAMAGE_ARC_MS / 100)).toEqual([])
  })
})

describe('damageArcsAt: one arc per attacker', () => {
  it('keeps the newest of several hits by the same attacker', () => {
    const doc = testReplayDoc({
      frameIntervalMs: 100,
      tracks: [
        { ...PLAYER, points: [{ t: 0, x: 0, y: 0, h: 0 }, { t: 200, x: 0, y: 0, h: 0 }] },
        { ...ATTACKER, points: [{ t: 0, x: 10, y: 0 }, { t: 20, x: -10, y: 0 }, { t: 200, x: -10, y: 0 }] },
      ],
      // Two hits, the document out of order on purpose: the newer one (t 20, attacker at -10, 0) must win.
      damages: [{ t: 20, slot: 512, by: 99 }, { t: 10, slot: 512, by: 99 }],
    })
    // Frame 25 is inside the lifetime of the newer hit (t 20) and of the older (t 10): the arc
    // must be the NEWER one, aged from frame 20, bearing toward the attacker's newer position.
    const arc = arcAt(doc, 25)
    expect(arc).not.toBeNull()
    expect(arc!.ageMs).toBe(frameToMs(25, doc) - frameToMs(20, doc))
    // The attacker is directly behind: ~180 or -180 (the sign of zero flips), assert on magnitude.
    expect(Math.abs(arc!.bearingDeg)).toBeCloseTo(180, 6)
  })

  it('keeps one arc per attacker when two attackers hit', () => {
    const doc = testReplayDoc({
      frameIntervalMs: 100,
      tracks: [
        { ...PLAYER, points: [{ t: 0, x: 0, y: 0, h: 0 }, { t: 200, x: 0, y: 0, h: 0 }] },
        { ...ATTACKER, points: [{ t: 0, x: 10, y: 0 }, { t: 200, x: 10, y: 0 }] },
        { slot: 98, xuid: 'C', team: 1, startFrame: 0, endFrame: 200, points: [{ t: 0, x: 0, y: -10 }, { t: 200, x: 0, y: -10 }] },
      ],
      damages: [{ t: 10, slot: 512, by: 99 }, { t: 12, slot: 512, by: 98 }],
    })
    const arcs = damageArcsAt(doc, 512, 12)
    expect(arcs).toHaveLength(2)
    expect(arcs.map((a) => a.by).sort()).toEqual([98, 99])
  })
})

describe('readHud: the damage arcs ride on the HUD read', () => {
  it('carries the arcs of the followed player at the frame', () => {
    const doc = testReplayDoc({
      frameIntervalMs: 100,
      tracks: [
        { ...PLAYER, points: [{ t: 0, x: 0, y: 0, h: 0 }, { t: 200, x: 0, y: 0, h: 0 }] },
        { ...ATTACKER, points: [{ t: 0, x: 10, y: 0 }, { t: 200, x: 10, y: 0 }] },
      ],
      damages: [{ t: 10, slot: 512, by: 99 }],
    })
    const hud = readHud(prepareHud(doc, 'A', []), 12, 'en')
    expect(hud).not.toBeNull()
    expect(hud!.damageArcs).toHaveLength(1)
    expect(hud!.damageArcs[0].by).toBe(99)
    expect(hud!.damageArcs[0].bearingDeg).toBeCloseTo(0, 6)
    expect(hud!.damageArcs[0].ageMs).toBe(frameToMs(12, doc) - frameToMs(10, doc))
    // Past the lifetime: the read keeps its shape, the ring empties.
    expect(readHud(prepareHud(doc, 'A', []), 10 + DAMAGE_ARC_MS / 100 + 1, 'en')!.damageArcs).toEqual([])
  })
})
