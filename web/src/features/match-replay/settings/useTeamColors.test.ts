/**
 * useTeamColors.test.ts — the persisted team color preference: defaults, persistence,
 * invalid stored values falling back to the defaults, the CSS variables being set on the
 * document root, and the shared-key subscription letting a second reader follow a change.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { TEAM_ALLY_DEFAULT, TEAM_ENEMY_DEFAULT, isTeamColor, useTeamColors } from './useTeamColors'

const ALLEY_KEY = 'replay-team-color-ally'
const ENEMY_KEY = 'replay-team-color-enemy'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  document.documentElement.style.removeProperty('--team-ally')
  document.documentElement.style.removeProperty('--team-enemy')
})

describe('defaults', () => {
  it('serves the index.css palette when nothing is stored', () => {
    const { result } = renderHook(() => useTeamColors())
    expect(result.current.ally).toBe(TEAM_ALLY_DEFAULT)
    expect(result.current.enemy).toBe(TEAM_ENEMY_DEFAULT)
  })

  it('falls back to the defaults when a stored value is not a team color', () => {
    localStorage.setItem(ALLEY_KEY, 'not a color')
    localStorage.setItem(ENEMY_KEY, '#12345')
    const { result } = renderHook(() => useTeamColors())
    expect(result.current.ally).toBe(TEAM_ALLY_DEFAULT)
    expect(result.current.enemy).toBe(TEAM_ENEMY_DEFAULT)
  })
})

describe('isTeamColor', () => {
  it('accepts only a #rrggbb hex', () => {
    expect(isTeamColor('#22c55e')).toBe(true)
    expect(isTeamColor('#EF4444')).toBe(true)
    expect(isTeamColor('#12345')).toBe(false)
    expect(isTeamColor('22c55e')).toBe(false)
    expect(isTeamColor('#1234567')).toBe(false)
    expect(isTeamColor('red')).toBe(false)
  })
})

describe('setting a color', () => {
  it('updates state, persists to localStorage, and sets the CSS variables on the root', () => {
    const { result } = renderHook(() => useTeamColors())
    act(() => {
      result.current.setAlly('#3b82f6')
    })
    expect(result.current.ally).toBe('#3b82f6')
    expect(localStorage.getItem(ALLEY_KEY)).toBe('#3b82f6')
    const root = getComputedStyle(document.documentElement)
    expect(root.getPropertyValue('--team-ally')).toBe('#3b82f6')
    expect(root.getPropertyValue('--team-enemy')).toBe(TEAM_ENEMY_DEFAULT)
  })

  it('ignores an invalid value', () => {
    const { result } = renderHook(() => useTeamColors())
    act(() => {
      result.current.setEnemy('red')
    })
    expect(result.current.enemy).toBe(TEAM_ENEMY_DEFAULT)
    expect(localStorage.getItem(ENEMY_KEY)).toBeNull()
  })
})

describe('reset', () => {
  it('restores both defaults and persists them', () => {
    const { result } = renderHook(() => useTeamColors())
    act(() => {
      result.current.setAlly('#3b82f6')
      result.current.setEnemy('#f59e0b')
    })
    act(() => {
      result.current.reset()
    })
    expect(result.current.ally).toBe(TEAM_ALLY_DEFAULT)
    expect(result.current.enemy).toBe(TEAM_ENEMY_DEFAULT)
    expect(localStorage.getItem(ALLEY_KEY)).toBe(TEAM_ALLY_DEFAULT)
    expect(localStorage.getItem(ENEMY_KEY)).toBe(TEAM_ENEMY_DEFAULT)
  })
})

describe('shared key', () => {
  it('lets a second reader follow a change made through the first', () => {
    const first = renderHook(() => useTeamColors())
    const second = renderHook(() => useTeamColors())
    act(() => {
      first.result.current.setEnemy('#f59e0b')
    })
    expect(second.result.current.enemy).toBe('#f59e0b')
  })

  it('reads a persisted value on mount', () => {
    localStorage.setItem(ALLEY_KEY, '#a855f7')
    const { result } = renderHook(() => useTeamColors())
    expect(result.current.ally).toBe('#a855f7')
  })
})
