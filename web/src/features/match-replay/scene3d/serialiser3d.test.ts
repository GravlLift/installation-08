// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it, vi } from 'vitest'
import { serialiser } from './serialiser3d'

describe('serialiser', () => {
  it('regroupe les demandes pendant une exécution et attend la dernière', async () => {
    const fins: (() => void)[] = []
    const travail = vi.fn(() => new Promise<void>((resolve) => fins.push(resolve)))
    const lancer = serialiser(travail)
    const premier = lancer()
    const suivant = lancer()
    const dernier = lancer()
    expect(travail).toHaveBeenCalledTimes(1)
    fins.shift()!()
    await premier
    await Promise.resolve()
    expect(travail).toHaveBeenCalledTimes(2)
    let fini = false
    void dernier.then(() => { fini = true })
    await Promise.resolve()
    expect(fini).toBe(false)
    fins.shift()!()
    await Promise.all([suivant, dernier])
    expect(travail).toHaveBeenCalledTimes(2)
  })
})
