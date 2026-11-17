// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import { readPlacedLights } from './placedLights'

describe('readPlacedLights', () => {
  it('passe des axes Halo au repère three et écarte les entrées inutilisables', () => {
    const lamps = readPlacedLights({
      levelupLights: [
        { type: 'spot', position: [1, 2, 3], direction: [0, 0, -1], color: [1, 0.5, 0], energy: 5, range: 4, cone: [70, 105] },
        { type: 'omni', position: [4, 5, 6], color: [1, 1, 1], energy: 1, range: 2 },
        { type: 'planar', position: [0, 0, 0], color: [1, 1, 1], energy: 1, range: 1 },
        { type: 'omni', position: [0, 0, 0], color: [1, 1, 1], energy: 0, range: 1 },
        { type: 'spot', position: [0, 0, 0], color: [1, 1, 1], energy: 1 },
      ],
    })
    expect(lamps).toHaveLength(2)
    expect(lamps[0].position.toArray()).toEqual([1, 3, -2])
    expect(lamps[0].direction.toArray()).toEqual([0, -1, -0])
    expect(lamps[0].cone).toEqual([70, 105])
    expect(lamps[1].kind).toBe('omni')
    expect(lamps[1].cone).toEqual([0, 90])
  })

  it('rend une liste vide sans lampes', () => {
    expect(readPlacedLights(null)).toEqual([])
    expect(readPlacedLights({})).toEqual([])
  })
})
