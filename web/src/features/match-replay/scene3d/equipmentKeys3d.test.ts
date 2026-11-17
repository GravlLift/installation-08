// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it, vi } from 'vitest'

import { EquipmentKeys, parseEquipmentKeys } from './equipmentKeys3d'
import { WeaponModels } from './weaponModels3d'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('parseEquipmentKeys', () => {
  it('reads family -> tag key, dropping malformed keys', () => {
    expect(parseEquipmentKeys({ equipment: { powerup_camo: 'e7be9f5c', bad: 'E7BE9F5C', short: '1234', n: 3 } })).toEqual({
      powerup_camo: 'e7be9f5c',
    })
  })

  it('is null for an index without the field (built before it)', () => {
    expect(parseEquipmentKeys({ weapons: [] })).toBeNull()
    expect(parseEquipmentKeys(null)).toBeNull()
  })
})

describe('EquipmentKeys', () => {
  it('answers the model key of a family once the index is read', async () => {
    const fetchJson = vi.fn((_url: string, _signal: AbortSignal) =>
      Promise.resolve<unknown>({ equipment: { powerup_camo: 'e7be9f5c' } }),
    )
    const keys = new EquipmentKeys('/api/weapons', fetchJson)
    expect(keys.key('powerup_camo')).toBeNull() // not loaded yet
    await flush()
    expect(keys.key('powerup_camo')).toBe('e7be9f5c')
    expect(keys.key('powerup_overshield')).toBeNull()
    expect(keys.key('constructor')).toBeNull()
    expect(fetchJson).toHaveBeenCalledTimes(1)
    keys.dispose()
  })
})

describe('EquipmentKeys, the equipment pad items', () => {
  it('maps each family an equipment pad publishes to its pickup model', async () => {
    // The table the library build wrote from the installed game (2026-11-15).
    const equipment = {
      grapple: '273fe0eb',
      powerup_camo: 'e7be9f5c',
      powerup_overshield: 'b781197a',
      repulsor: '7ca85adc',
      sensor: '72199cba',
      thruster: '430dda48',
      translocator_beacon: '730dc70f',
      wall: '2974c233',
    }
    const keys = new EquipmentKeys('/api/weapons', () => Promise.resolve<unknown>({ equipment }))
    expect(keys.key('wall')).toBeNull() // read on first use
    await flush()
    for (const [family, key] of Object.entries(equipment)) expect(keys.key(family)).toBe(key)
    expect(keys.key('unknown_item')).toBeNull()
    keys.dispose()
  })
})

describe('WeaponModels.model', () => {
  it('resolves an identifier that is not a weapon through the equipment table', () => {
    const equipment = new EquipmentKeys('/api/weapons', () => new Promise(() => {}))
    const key = vi.spyOn(equipment, 'key')
    const models = new WeaponModels('/api/weapons', undefined, undefined, undefined, equipment)
    expect(models.model('powerup_camo')).toBeNull() // index not read yet
    expect(key).toHaveBeenCalledWith('powerup_camo')
    models.dispose()
  })
})
