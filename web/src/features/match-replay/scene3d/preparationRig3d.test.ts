// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { expect, it, vi } from 'vitest'
import type { SpartanArmory, Dress } from './armory3d'
import type { Coat } from './armorCoat3d'
import { PreparationRig3d } from './preparationRig3d'

it('abandons an old coat even when the player keeps the same xuid', async () => {
  let resolveCoat!: (coat: Coat | null) => void
  const previous = new Promise<Coat | null>((resolve) => { resolveCoat = resolve })
  const peindreBras = vi.fn().mockReturnValueOnce(previous).mockResolvedValue(null)
  const armory = { regions: () => null, dress: () => ({} as Dress), peindreBras } as unknown as SpartanArmory
  const preparation = new PreparationRig3d({
    fichiersCharges: () => ['a'], materiauxDe: () => [], indexPieces: async () => null,
    piece: async () => null, armurerie: () => armory, xuid: () => '1',
    cleArmeDe: () => 'cle-a',
  })
  preparation.changerJoueur()
  await Promise.resolve()
  preparation.changerJoueur()
  resolveCoat(new Map())
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  expect(preparation.coat('a')).toBeNull()
  expect(peindreBras).toHaveBeenCalledTimes(2)
})

it('abandonner keeps a prepared coat that no longer covers the rig\'s materials', () => {
  const preparation = new PreparationRig3d({
    fichiersCharges: () => ['a'], materiauxDe: () => [], indexPieces: async () => null,
    piece: async () => null, armurerie: () => null, xuid: () => '1',
    cleArmeDe: () => 'cle-a',
  })
  const coat = new Map()
  ;(preparation as unknown as { coats: Map<string, unknown> }).coats.set('a', coat)
  expect(preparation.coat('a')).toBe(coat)
  preparation.abandonner('a')
  expect(preparation.coat('a')).toBeNull()
})
