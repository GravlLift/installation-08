// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { expect, it } from 'vitest'

import { hudLevelOf } from './hudLevel'

it('derives the HUD level from the view and the camera mode', () => {
  expect(hudLevelOf('3d', 'fp')).toBe('full')
  expect(hudLevelOf('3d', 'tp')).toBe('noReticle')
  expect(hudLevelOf('3d', 'free')).toBe('spectator')
})

it('keeps the score strip only in 2D, whatever the camera mode', () => {
  for (const mode of ['fp', 'tp', 'free'] as const) expect(hudLevelOf('top', mode)).toBe('score')
})
