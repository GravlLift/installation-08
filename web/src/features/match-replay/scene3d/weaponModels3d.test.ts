import { describe, expect, it } from 'vitest'
import { WeaponModels } from './weaponModels3d'

describe('WeaponModels.sourcesChargees', () => {
  it('rend les modèles chargés, vide sans modèle chargé', () => {
    const models = new WeaponModels('/weapons')
    expect(models.sourcesChargees()).toEqual([])
    models.dispose()
    expect(models.sourcesChargees()).toEqual([])
  })
})
