// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * Tests — replayFullRate / replayNormalize : le vol au débit du film (schema 127) se relit
 * UNE FOIS, à la frontière.
 *
 * `normalizeReplayDocument` lit les colonnes différentielles de `projectiles[].fullRate` et publie
 * la forme décodée (`ReplayFullRateFlightReady`), `t` en images fractionnaires ABSOLUES
 * (ms depuis l'origine de la grille / frameIntervalMs) : les calques la lisent telle quelle,
 * sans re-décodage.
 */
import { describe, expect, it } from 'vitest'

import type { ReplayDocument } from '@/lib/api/types'

import { normalizeReplayDocument } from './replayNormalize'

describe('normalizeReplayDocument — projectiles[].fullRate (schema 127)', () => {
  it('decodes the differential fullRate once, at the boundary', () => {
    const frameIntervalMs = 100
    // Differential columns: the first value of each is absolute, the following ones are gaps.
    // The flight starts at absolute frame 100 (t = 10000 ms since the grid origin, at 100 ms/frame).
    const raw = {
      frameIntervalMs,
      bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
      projectiles: [
        {
          t0: 100,
          p: [[0, 0, 0], [2, 1, 0]],
          z: [1.0, 0.5],
          fullRate: {
            t: [10000, 100, 100],
            x: [0, 100, 100],
            y: [0, 30, 40],
            z: [100, -15, -15],
          },
          detoT: 160,
          detoX: 4,
          detoY: 0,
        },
      ],
    }
    const doc = normalizeReplayDocument(raw as unknown as ReplayDocument)
    const fr = doc.projectiles[0].fullRate
    expect(fr).toBeDefined()
    // t: cumulative ms / frameIntervalMs = absolute fractional frames, starting at 100.
    expect(fr!.t).toEqual([100, 101, 102])
    // x/y/z: cumulative centi-units / 100 = world units.
    expect(fr!.x).toEqual([0, 1, 2])
    expect(fr!.y).toEqual([0, 0.3, 0.7])
    expect(fr!.z).toEqual([1.0, 0.85, 0.7])
  })

  it('leaves fullRate absent on an artifact without it', () => {
    const raw = {
      frameIntervalMs: 100,
      bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
      projectiles: [{ t0: 0, p: [[0, 0, 0], [1, 1, 0]], detoT: 10, detoX: 1, detoY: 0 }],
    }
    const doc = normalizeReplayDocument(raw as unknown as ReplayDocument)
    expect(doc.projectiles[0].fullRate).toBeUndefined()
  })
})
