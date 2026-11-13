import { describe, expect, it } from 'vitest'

import { DEFAULT_WEAPON_CLASS, weaponClassOfKey } from './weaponClass3d'

describe('weaponClassOfKey', () => {
  it('donne la classe d’animation par la clé du libellé d’arme', () => {
    expect(weaponClassOfKey('hinf_br75')).toBe('rifle')
    expect(weaponClassOfKey('hinf_sidekick')).toBe('pistol')
    expect(weaponClassOfKey('hinf_m41_spnkr')).toBe('missile')
    expect(weaponClassOfKey('hinf_gravity_hammer')).toBe('hammer')
    expect(weaponClassOfKey('hinf_energy_sword')).toBe('sword')
    expect(weaponClassOfKey('hinf_turret_plasma')).toBe('turret')
  })

  it('une arme inconnue ou sans clé se tient comme un fusil', () => {
    expect(DEFAULT_WEAPON_CLASS).toBe('rifle')
    expect(weaponClassOfKey('hinf_inconnue')).toBe('rifle')
    expect(weaponClassOfKey(undefined)).toBe('rifle')
    expect(weaponClassOfKey('')).toBe('rifle')
  })
})
