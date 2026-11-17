// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { DEFAULT_WEAPON_CLASS, weaponClassOfKey } from './weaponClass3d'

describe('weaponClassOfKey', () => {
  it("gives the animation class by the weapon label's key", () => {
    expect(weaponClassOfKey('hinf_br75')).toBe('rifle')
    expect(weaponClassOfKey('hinf_sidekick')).toBe('pistol')
    expect(weaponClassOfKey('hinf_m41_spnkr')).toBe('missile')
    expect(weaponClassOfKey('hinf_gravity_hammer')).toBe('hammer')
    expect(weaponClassOfKey('hinf_energy_sword')).toBe('sword')
    expect(weaponClassOfKey('hinf_turret_plasma')).toBe('turret')
  })

  it('an unknown weapon or one with no key is held like a rifle', () => {
    expect(DEFAULT_WEAPON_CLASS).toBe('rifle')
    expect(weaponClassOfKey('hinf_unknown')).toBe('rifle')
    expect(weaponClassOfKey(undefined)).toBe('rifle')
    expect(weaponClassOfKey('')).toBe('rifle')
  })
})
