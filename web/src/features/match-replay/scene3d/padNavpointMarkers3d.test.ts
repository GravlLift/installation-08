// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import { navpointDistanceText } from './padNavpointMarkers3d'

describe('navpointDistanceText', () => {
  it('writes world units as meters with one decimal and the unit, as the game does ("53.8m")', () => {
    expect(navpointDistanceText(17.65)).toBe('53.8m')
    expect(navpointDistanceText(0)).toBe('0.0m')
  })
})
