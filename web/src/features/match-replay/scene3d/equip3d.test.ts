// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { EQUIP_FAMILY_CAMO, EQUIP_FAMILY_OVERSHIELD } from '../model/equipmentFx'
import { equipFxAt, NO_EQUIP_FX, type EquipFx } from './equip3d'

const FPS = 10
const fresh = (): EquipFx => ({ ...NO_EQUIP_FX })
const episodes = [
  { slot: 3, t0: 100, t1: 200, fam: EQUIP_FAMILY_CAMO },
  { slot: 3, t0: 300, t1: 400, fam: EQUIP_FAMILY_OVERSHIELD },
  { slot: 4, t0: 0, t1: 1000, fam: EQUIP_FAMILY_CAMO },
  { slot: 3, t0: 0, t1: 1000, fam: 'other' },
]

describe('equipFxAt', () => {
  it("nothing outside the life's episodes, nor for an unknown family", () => {
    for (const f of [50, 99.9, 200.1, 250, 400.1]) expect(equipFxAt(episodes, 3, f, FPS, fresh())).toEqual(NO_EQUIP_FX)
    expect(equipFxAt(episodes, 9, 150, FPS, fresh())).toEqual(NO_EQUIP_FX)
  })

  it('camouflage fades in at the start, holds, then fades back at the end of the episode', () => {
    const at = (f: number) => equipFxAt(episodes, 3, f, FPS, fresh()).camo
    expect(at(100)).toBe(0)
    expect(at(102)).toBeCloseTo(0.5)
    expect(at(104)).toBe(1)
    expect(at(150)).toBe(1)
    expect(at(198)).toBeCloseTo(0.5)
    expect(at(200)).toBe(0)
    expect(equipFxAt(episodes, 3, 150, FPS, fresh()).overshield).toBe(0)
  })

  it('overshield lights up fast then holds to the end of the episode', () => {
    const at = (f: number) => equipFxAt(episodes, 3, f, FPS, fresh()).overshield
    expect(at(301)).toBeCloseTo(0.5)
    expect(at(302)).toBe(1)
    expect(at(400)).toBe(1)
    expect(equipFxAt(episodes, 3, 350, FPS, fresh()).camo).toBe(0)
  })

  it('overwrites its output: a frame with no effect erases the previous one', () => {
    const out = fresh()
    equipFxAt(episodes, 3, 150, FPS, out)
    expect(out.camo).toBe(1)
    equipFxAt(episodes, 3, 250, FPS, out)
    expect(out).toEqual(NO_EQUIP_FX)
  })
})
