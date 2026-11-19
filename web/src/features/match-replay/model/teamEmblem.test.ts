// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import { teamEmblemUrl } from './teamEmblem'

describe('teamEmblemUrl', () => {
  it('serves TeamEmblem<N>.png for integer team ids 0..8', () => {
    for (let n = 0; n <= 8; n++) {
      expect(teamEmblemUrl(n)).toBe(`/static/weapons-assets/halo_infinite/hud/TeamEmblem${n}.png`)
    }
  })

  it('has no emblem outside 0..8, for a non-integer, or for a missing id', () => {
    expect(teamEmblemUrl(9)).toBeNull()
    expect(teamEmblemUrl(-1)).toBeNull()
    expect(teamEmblemUrl(0.5)).toBeNull()
    expect(teamEmblemUrl(null)).toBeNull()
    expect(teamEmblemUrl(undefined)).toBeNull()
  })
})
