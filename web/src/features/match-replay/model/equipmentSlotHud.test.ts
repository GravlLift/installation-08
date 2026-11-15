import { describe, expect, it } from 'vitest'

import { testReplayDoc } from '../test/testDoc'
import { equipmentSlotAt } from './equipmentSlotHud'

const LABELS = {
  '5': { en: 'Thruster', fr: 'propulseur', family: 'thruster' },
  '8': { en: 'Active Camouflage', fr: 'camouflage actif', family: 'powerup_camo' },
  '12': { en: 'Threat Seeker', fr: 'traqueur de menaces', family: 'threat_seeker' },
}

/** One life (slot 516) from frame 0 to 600, and a recycled slot 516 from 700 on. */
function doc(over: Record<string, unknown> = {}) {
  return testReplayDoc({
    frameIntervalMs: 33,
    tracks: [
      { slot: 516, xuid: 'A', team: 0, startFrame: 0, endFrame: 600, points: [{ t: 0, x: 0, y: 0 }, { t: 600, x: 0, y: 0 }] },
      { slot: 516, xuid: 'A', team: 0, startFrame: 700, endFrame: 900, points: [{ t: 700, x: 0, y: 0 }, { t: 900, x: 0, y: 0 }] },
    ],
    abilityLabels: LABELS,
    ...over,
  })
}

describe('equipmentSlotAt', () => {
  // The camo of the reported film: taken 429, activated 439, energy to 0 at 473, spent 508.
  const camo = doc({
    abilities: [{ t: 429, slot: 516, r: 8, src: 'i48' }],
    equipmentChanges: [{ t: 429, slot: 516, kind: 'taken', r: 8, from: -1 }, { t: 508, slot: 516, kind: 'spent', r: -1, from: 8 }],
    carriedEquipment: [{ slot: 516, r: 8, t0: 429, t1: 508, energy: [{ t: 429, e: 1, n: 1, tag: true }, { t: 473, e: 0, n: 0 }], uses: [439] }],
  })

  it('is empty before the pickup, even with the reading ahead', () => {
    expect(equipmentSlotAt(camo, 516, 428)).toBeNull()
  })

  it('shows the picked-up equipment and its uses left from the carried object, until spent', () => {
    expect(equipmentSlotAt(camo, 516, 429)).toEqual({ rank: 8, uses: 1 })
    expect(equipmentSlotAt(camo, 516, 472)).toEqual({ rank: 8, uses: 1 })
    expect(equipmentSlotAt(camo, 516, 480)).toEqual({ rank: 8, uses: 0 })
    expect(equipmentSlotAt(camo, 516, 508)).toBeNull()
  })

  it('never crosses a death: the next life of the same slot starts empty', () => {
    const kept = doc({
      abilities: [{ t: 100, slot: 516, r: 12, src: 'i48' }],
      equipmentChanges: [{ t: 100, slot: 516, kind: 'taken', r: 12, from: -1 }],
    })
    expect(equipmentSlotAt(kept, 516, 500)).toEqual({ rank: 12, uses: null })
    expect(equipmentSlotAt(kept, 516, 650)).toBeNull()
    expect(equipmentSlotAt(kept, 516, 750)).toBeNull()
  })

  it('counts the thruster by its charge readings, within the life', () => {
    const thruster = doc({
      abilities: [{ t: 100, slot: 516, r: 5, src: 'i48' }],
      equipmentChanges: [{ t: 100, slot: 516, kind: 'taken', r: 5, from: -1 }, { t: 720, slot: 516, kind: 'taken', r: 5, from: -1 }],
      abilityCharges: [{ t: 100, slot: 516, family: 'thruster', charges: 3 }, { t: 200, slot: 516, family: 'thruster', charges: 2 }],
    })
    expect(equipmentSlotAt(thruster, 516, 150)).toEqual({ rank: 5, uses: 3 })
    expect(equipmentSlotAt(thruster, 516, 250)).toEqual({ rank: 5, uses: 2 })
    expect(equipmentSlotAt(thruster, 516, 750)).toEqual({ rank: 5, uses: null })
  })
})
