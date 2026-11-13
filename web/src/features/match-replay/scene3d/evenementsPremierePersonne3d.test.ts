import { expect, it } from 'vitest'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import { preparerEvenementsPremierePersonne } from './evenementsPremierePersonne3d'

it('range les événements par emplacement et ne garde que les changements réels', () => {
  const doc = {
    grenades: [{ slot: 1, t: 30 }, { slot: 1, t: 10 }],
    stances: [{ slot: 1, kind: 'sprint', t0: 40, t1: 50 }, { slot: 1, kind: 'sprint', t0: 10, t1: 20 }],
    loadouts: [{ slot: 1, t: 20 }, { slot: 1, t: 10 }], inventory: [], weaponChanges: [{ slot: 1, t: 30 }],
    drawnWeapons: [], ammoReads: [],
  } as unknown as ReplayDocumentReady
  const result = preparerEvenementsPremierePersonne(doc, (_slot, t) => ({ id: t < 20 ? 'a' : 'b', name: '', tint: 'kinetic' }))
  expect(result.grenades.get(1)).toEqual([10, 30])
  expect(result.changements.get(1)).toEqual([{ frame: 20, avant: null, apres: null }])
  expect(result.sprints.get(1)?.map((s) => s.t0)).toEqual([10, 40])
})

it('voit la bascule entre deux armes portées : sélecteur et lecture de chargeur', () => {
  const doc = {
    grenades: [], stances: [], loadouts: [{ slot: 1, t: 0 }], inventory: [], weaponChanges: [],
    drawnWeapons: [{ slot: 1, t: 20, d: 1 }], ammoReads: [{ slot: 2, t: 39, ms: 3950, src: 'delta' }, { slot: 2, t: 10, ms: 1000, src: 'key' }],
  } as unknown as ReplayDocumentReady
  const held = (slot: number, t: number) => ({ id: t < (slot === 1 ? 20 : 40) ? 'a' : 'b', name: '', tint: 'kinetic' as const })
  const result = preparerEvenementsPremierePersonne(doc, held)
  expect(result.changements.get(1)?.map((c) => c.frame)).toEqual([20])
  expect(result.changements.get(2)?.map((c) => c.frame)).toEqual([40])
})
