// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { expect, it, vi } from 'vitest'
import type { SpartanArmory, Dress } from './armory3d'
import type { Coat } from './armorCoat3d'
import { RigPreparation3d } from './rigPreparation3d'

it('abandons an old coat even when the player keeps the same xuid', async () => {
  let resolveCoat!: (coat: Coat | null) => void
  const previous = new Promise<Coat | null>((resolve) => { resolveCoat = resolve })
  const paintArms = vi.fn().mockReturnValueOnce(previous).mockResolvedValue(null)
  const armory = { regions: () => null, dress: () => ({} as Dress), paintArms } as unknown as SpartanArmory
  const preparation = new RigPreparation3d({
    loadedFiles: () => ['a'], materialsFor: () => [], armIndex: async () => null,
    piece: async () => null, armory: () => armory, xuid: () => '1',
    weaponKeyFor: () => 'key-a',
  })
  preparation.changePlayer()
  await Promise.resolve()
  preparation.changePlayer()
  resolveCoat(new Map())
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  expect(preparation.coat('a')).toBeNull()
  expect(paintArms).toHaveBeenCalledTimes(2)
})

it('abandon keeps a prepared coat that no longer covers the rig\'s materials', () => {
  const preparation = new RigPreparation3d({
    loadedFiles: () => ['a'], materialsFor: () => [], armIndex: async () => null,
    piece: async () => null, armory: () => null, xuid: () => '1',
    weaponKeyFor: () => 'key-a',
  })
  const coat = new Map()
  ;(preparation as unknown as { coats: Map<string, unknown> }).coats.set('a', coat)
  expect(preparation.coat('a')).toBe(coat)
  preparation.abandon('a')
  expect(preparation.coat('a')).toBeNull()
})
