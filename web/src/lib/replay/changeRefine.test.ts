/**
 * Tests: a pickup onto an occupied slot replaces the weapon the row says that slot held.
 */
import { describe, expect, it } from 'vitest'

import type { ReplayWeaponChange } from '@/lib/api/types'

import { refineWeaponsReading } from './changeRefine'

const FUEL_ROD = '0x9D6AAED2'
const AVENGER = '0xF5C335DF'
const SENTINEL = 'a0955e9e'

describe('refineWeaponsReading, a pickup onto an occupied slot', () => {
  // Match 05dfe4e9 (Outlook), TasteThePainbow: the keyframe at frame 5185 reads the Fuel Rod
  // SPNKr in slot 0; the emptied Fuel Rod leaves without a dated drop and the Sentinel Beam is
  // `taken` onto slot 0 at frame 5347; the next keyframe (5791) reads the Sentinel Beam there.
  const taken: ReplayWeaponChange = { t: 5347, slot: 555, kind: 'taken', w: SENTINEL, k: 0 }

  it('puts the picked weapon at the slot index of a keyframe row', () => {
    const got = refineWeaponsReading({ weapons: [FUEL_ROD, AVENGER], age: 215 }, [taken], 555, 5400)
    expect(got).toEqual({ weapons: ['0xA0955E9E', AVENGER], age: 53 })
  })

  it('finds the slot by its emplacement on a placed row', () => {
    const got = refineWeaponsReading({ weapons: [AVENGER, FUEL_ROD], age: 300, src: 'birth', k: [1, 0] }, [taken], 555, 5400)
    expect(got.weapons).toEqual([AVENGER, '0xA0955E9E'])
    expect(got.k).toEqual([1, 0])
  })

  it('does not apply before the pickup, nor to another slot', () => {
    const base = { weapons: [FUEL_ROD, AVENGER], age: 100 }
    expect(refineWeaponsReading(base, [taken], 555, 5300)).toBe(base)
    expect(refineWeaponsReading(base, [{ ...taken, slot: 556 }], 555, 5400)).toBe(base)
  })

  it('leaves a keyframe row alone when the slot is past its end (an object slot)', () => {
    const base = { weapons: [FUEL_ROD, AVENGER], age: 215 }
    expect(refineWeaponsReading(base, [{ ...taken, w: '2a392328', k: 2 }], 555, 5400)).toBe(base)
  })
})
