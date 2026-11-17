// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import {
  dodgeShots,
  evadeDirection,
  firstPersonUses,
  FP_GRAPPLE_FIRE_ACTION,
  FP_USE_ACTION,
  fpEvadeAction,
  useAt,
} from './equipmentUse3d_logic'

type Doc = Parameters<typeof firstPersonUses>[0]

function doc(over: Partial<Doc> = {}): Doc {
  return {
    carriedEquipment: [],
    abilityLabels: {
      '3': { family: 'repulsor' }, '5': { family: 'shroud_screen' }, '7': { family: 'sensor' },
      '9': { family: 'powerup_camo' }, '11': { family: 'translocator_beacon' },
    },
    grappleLines: [],
    ...over,
  } as Doc
}

describe('evadeDirection', () => {
  it('reads the push relative to where the player faces (+ = left)', () => {
    expect(evadeDirection(1, 0, 0)).toBe('front')
    expect(evadeDirection(0, 1, 0)).toBe('left')
    expect(evadeDirection(0, -1, 0)).toBe('right')
    expect(evadeDirection(-1, 0, 0)).toBe('back')
    // Facing +Y: a push along +X goes to the right, one along -X to the left.
    expect(evadeDirection(1, 0, 90)).toBe('right')
    expect(evadeDirection(-1, 0, 90)).toBe('left')
    // Headings past a turn wrap.
    expect(evadeDirection(1, 0, 720)).toBe('front')
    expect(evadeDirection(Math.cos(0.7), Math.sin(0.7), 0)).toBe('front')
  })
})

describe('dodgeShots', () => {
  it('turns each thruster burst with a heading into a dodge, by slot and in frame order', () => {
    const bursts = [{ t: 40, slot: 2, dx: 0, dy: 1 }, { t: 10, slot: 2, dx: 1, dy: 0 }, { t: 20, slot: 4, dx: 1, dy: 0 }]
    const out = dodgeShots(bursts, (slot) => (slot === 4 ? null : 0))
    expect(out.get(2)).toEqual([{ t: 10, dir: 'front' }, { t: 40, dir: 'left' }])
    expect(out.has(4)).toBe(false)
  })
})

describe('firstPersonUses', () => {
  it('names the game clip of each carried equipment activation, the grapple fire and the thruster', () => {
    const d = doc({
      carriedEquipment: [
        { slot: 1, r: 3, t0: 0, energy: [], uses: [120, 30], tracked: [] },
        { slot: 1, r: 7, t0: 0, energy: [], uses: [60], tracked: [] },
        { slot: 1, r: 5, t0: 0, energy: [], uses: [90], tracked: [] },
        { slot: 2, r: 9, t0: 0, energy: [], uses: [45], tracked: [] },
        { slot: 2, r: 11, t0: 0, energy: [], uses: [15], tracked: [] },
      ],
      grappleLines: [{ slot: 1, t0: 75, t1: 80, ax: 0, ay: 0, az: 0 }],
    } as Partial<Doc>)
    const uses = firstPersonUses(d, new Map([[1, [{ t: 100, dir: 'back' as const }]]]))
    expect(uses.get(1)).toEqual([
      { frame: 30, action: FP_USE_ACTION.repulsor },
      { frame: 60, action: FP_USE_ACTION.sensor },
      { frame: 75, action: FP_GRAPPLE_FIRE_ACTION },
      { frame: 90, action: FP_USE_ACTION.shroud_screen },
      { frame: 100, action: fpEvadeAction('back') },
      { frame: 120, action: FP_USE_ACTION.repulsor },
    ])
    // Active camo and the translocator activate through their own clips, sorted with the rest.
    expect(uses.get(2)).toEqual([
      { frame: 15, action: FP_USE_ACTION.translocator_beacon },
      { frame: 45, action: FP_USE_ACTION.powerup_camo },
    ])
    // The clip names are the baked actions, `<set>:equipment_activate`.
    expect(FP_USE_ACTION.repulsor).toBe('knockback:equipment_activate')
    expect(FP_USE_ACTION.sensor).toBe('location:equipment_activate')
    expect(FP_USE_ACTION.powerup_camo).toBe('camo:equipment_activate')
    expect(FP_USE_ACTION.translocator_beacon).toBe('quantum:equipment_activate')
  })
})

describe('useAt', () => {
  it('gives the latest use started at or before the frame', () => {
    const list = [{ frame: 10, action: 'a' }, { frame: 20, action: 'b' }]
    expect(useAt(list, 9)).toBeNull()
    expect(useAt(list, 10)?.action).toBe('a')
    expect(useAt(list, 19.5)?.action).toBe('a')
    expect(useAt(list, 25)?.action).toBe('b')
  })
})

describe('FP_USE_ACTION sets', () => {
  it('plays the set the game data names for each family, shared sets included', () => {
    expect(FP_USE_ACTION.shroud_screen).toBe(FP_USE_ACTION.sensor)
    expect(FP_USE_ACTION.threat_seeker).toBe(FP_USE_ACTION.sensor)
    expect(FP_USE_ACTION.powerup_overshield).toBe('camo:equipment_activate')
    expect(FP_USE_ACTION.wall).toBe('#6132b1e2:equipment_activate')
    expect(FP_USE_ACTION.repair_field).toBe(FP_USE_ACTION.wall)
    // The grapple and the thruster have no set: their uses come from the grapple lines and the bursts.
    expect(FP_USE_ACTION.grapple).toBeUndefined()
    expect(FP_USE_ACTION.thruster).toBeUndefined()
  })

  it('gives every equipment family of a document its use clip, by its palette rank', () => {
    const families = ['wall', 'repair_field', 'threat_seeker', 'powerup_overshield']
    const d = doc({
      abilityLabels: Object.fromEntries(families.map((family, r) => [String(r), { en: family, fr: family, family }])),
      carriedEquipment: families.map((_, r) => ({ slot: 4, r, t0: 0, energy: [], uses: [10 * (r + 1)], tracked: [] })),
    } as Partial<Doc>)
    expect(firstPersonUses(d, new Map()).get(4)).toEqual(
      families.map((family, r) => ({ frame: 10 * (r + 1), action: FP_USE_ACTION[family] })),
    )
  })
})
