// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { expect, it, vi } from 'vitest'
import type { SpartanArmory, Dress } from './armory3d'
import type { Coat } from './armorCoat3d'
import { PreparationRig3d } from './preparationRig3d'

it('abandonne un ancien revêtement même si le joueur garde son xuid', async () => {
  let resoudre!: (coat: Coat | null) => void
  const ancien = new Promise<Coat | null>((resolve) => { resoudre = resolve })
  const peindreBras = vi.fn().mockReturnValueOnce(ancien).mockResolvedValue(null)
  const armurerie = { regions: () => null, dress: () => ({} as Dress), peindreBras } as unknown as SpartanArmory
  const preparation = new PreparationRig3d({
    fichiersCharges: () => ['a'], materiauxDe: () => [], indexPieces: async () => null,
    piece: async () => null, armurerie: () => armurerie, xuid: () => '1',
    cleArmeDe: () => 'cle-a',
  })
  preparation.changerJoueur()
  await Promise.resolve()
  preparation.changerJoueur()
  resoudre(new Map())
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  expect(preparation.coat('a')).toBeNull()
  expect(peindreBras).toHaveBeenCalledTimes(2)
})

it('abandonner retient un revêtement préparé qui ne couvre plus les matériaux du rig', () => {
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
