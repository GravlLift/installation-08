// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { formatViewGrip, tuneViewGrip, viewGripOf, viewGripStep } from './viewGrip3d'

describe('viewGripStep', () => {
  it('moves right toward the cone\'s -X, Shift enlarges the step', () => {
    expect(viewGripStep('KeyL', false)).toEqual({ x: -0.005, y: 0, z: 0, roll: 0 })
    expect(viewGripStep('KeyI', true)).toEqual({ x: 0, y: 0.02, z: 0, roll: 0 })
    expect(viewGripStep('KeyM', false)).toEqual({ x: 0, y: 0, z: 0.005, roll: 0 })
    expect(viewGripStep('KeyO', false)?.roll).toBeCloseTo(Math.PI / 90)
  })

  it('ignores other keys', () => {
    expect(viewGripStep('KeyA', false)).toBeNull()
  })
})

describe('viewGripOf / tuneViewGrip', () => {
  it('each model has its own grip, the default grip otherwise', () => {
    expect(viewGripOf('1a22fee6')).not.toEqual(viewGripOf(null))
    expect(viewGripOf('00000000')).toEqual(viewGripOf(null))
  })

  it('tuning touches only the tuned model', () => {
    const before = viewGripOf(null)
    const tuned = tuneViewGrip('0000beef', { x: 0.01, y: 0, z: 0, roll: 0 })
    expect(tuned.x).toBeCloseTo(before.x + 0.01)
    expect(viewGripOf('0000beef')).toEqual(tuned)
    expect(viewGripOf(null)).toEqual(before)
  })
})

describe('formatViewGrip', () => {
  it('writes the grip as a table line', () => {
    expect(formatViewGrip('1a22fee6', 'Shock Rifle', { x: -0.03, y: -0.085, z: 0.045, roll: 0.1 })).toBe(
      "'1a22fee6': { x: -0.030, y: -0.085, z: 0.045, roll: 0.100 }, // Shock Rifle",
    )
  })
})
