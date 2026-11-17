// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { followedPlayer, povPickerValue, reduceCameraChoice, type CameraChoice } from './cameraChoiceLogic'

const start: CameraChoice = { mode: 'fp', lastFollow: 'fp', player: 'A' }

describe('reduceCameraChoice', () => {
  it('free view from the segment and from the picker is the same state', () => {
    const fromSegment = reduceCameraChoice(start, { kind: 'mode', mode: 'free' })
    const fromPicker = reduceCameraChoice(start, { kind: 'pov', xuid: null })
    expect(fromSegment).toEqual(fromPicker)
    expect(fromSegment.mode).toBe('free')
    expect(followedPlayer(fromSegment)).toBeNull()
    expect(povPickerValue(fromSegment)).toBe('')
  })

  it('keeps the last followed player as the reference in free view', () => {
    const free = reduceCameraChoice(start, { kind: 'pov', xuid: null })
    expect(free.player).toBe('A')
  })

  it('picking a player from free view returns to the last follow mode', () => {
    const tp = reduceCameraChoice(start, { kind: 'mode', mode: 'tp' })
    const free = reduceCameraChoice(tp, { kind: 'mode', mode: 'free' })
    const back = reduceCameraChoice(free, { kind: 'pov', xuid: 'B' })
    expect(back).toEqual({ mode: 'tp', lastFollow: 'tp', player: 'B' })
    expect(povPickerValue(back)).toBe('B')
  })

  it('picking 1st or 3rd person from free view follows the reference player again', () => {
    const free = reduceCameraChoice(start, { kind: 'mode', mode: 'free' })
    const fp = reduceCameraChoice(free, { kind: 'mode', mode: 'tp' })
    expect(followedPlayer(fp)).toBe('A')
    expect(fp.lastFollow).toBe('tp')
  })

  it('picking a player while following keeps the mode', () => {
    const tp = reduceCameraChoice(start, { kind: 'mode', mode: 'tp' })
    expect(reduceCameraChoice(tp, { kind: 'pov', xuid: 'B' })).toEqual({ mode: 'tp', lastFollow: 'tp', player: 'B' })
  })
})
