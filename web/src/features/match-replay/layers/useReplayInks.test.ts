/**
 * useReplayInks.test.ts — the team inks of the canvas/3D follow the team color preference
 * live: the memo is keyed on the two colors, so a change made through the preference
 * (the drawer's pickers) is served by `teamColorOf` without a reload, and the CSS
 * variables on the document root carry the same values for the CSS consumers.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useReplayInks } from './useReplayInks'
import { useTeamColors } from '../settings/useTeamColors'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  document.documentElement.style.removeProperty('--team-ally')
  document.documentElement.style.removeProperty('--team-enemy')
})

describe('team inks', () => {
  it('serves the defaults before any change', () => {
    const { result } = renderHook(() => useReplayInks(0))
    expect(result.current.teamColorOf(true)).toBe('#22c55e')
    expect(result.current.teamColorOf(false)).toBe('#ef4444')
  })

  it('serves the new colors after the preference changes, without a reload', () => {
    const inks = renderHook(() => useReplayInks(0))
    const colors = renderHook(() => useTeamColors())
    act(() => {
      colors.result.current.setAlly('#3b82f6')
      colors.result.current.setEnemy('#f59e0b')
    })
    expect(inks.result.current.teamColorOf(true)).toBe('#3b82f6')
    expect(inks.result.current.teamColorOf(false)).toBe('#f59e0b')
    const root = getComputedStyle(document.documentElement)
    expect(root.getPropertyValue('--team-ally')).toBe('#3b82f6')
    expect(root.getPropertyValue('--team-enemy')).toBe('#f59e0b')
  })

  it('follows a reset back to the defaults', () => {
    const inks = renderHook(() => useReplayInks(0))
    const colors = renderHook(() => useTeamColors())
    act(() => {
      colors.result.current.setAlly('#3b82f6')
      colors.result.current.reset()
    })
    expect(inks.result.current.teamColorOf(true)).toBe('#22c55e')
  })
})
