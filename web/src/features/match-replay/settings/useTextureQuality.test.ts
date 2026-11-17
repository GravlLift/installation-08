// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useTextureQuality.test.ts — the persisted texture-quality preference: the Standard default,
 * persistence, an invalid stored value falling back to the default, and the shared-key
 * subscription letting a second reader (the match view) follow the drawer's change in session.
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { TEXTURE_QUALITIES, useTextureQuality } from './useTextureQuality'

const QUALITY_KEY = 'replay-texture-quality'

beforeEach(() => {
  localStorage.clear()
})

describe('defaults', () => {
  it('serves Standard when nothing is stored', () => {
    const { result } = renderHook(() => useTextureQuality())
    expect(result.current.quality).toBe('standard')
  })

  it('falls back to Standard when a stored value is not a quality', () => {
    localStorage.setItem(QUALITY_KEY, 'ultra')
    const { result } = renderHook(() => useTextureQuality())
    expect(result.current.quality).toBe('standard')
  })

  it('reads a persisted High on mount', () => {
    localStorage.setItem(QUALITY_KEY, 'high')
    const { result } = renderHook(() => useTextureQuality())
    expect(result.current.quality).toBe('high')
  })
})

describe('setting a quality', () => {
  it('updates state and persists to localStorage', () => {
    const { result } = renderHook(() => useTextureQuality())
    act(() => {
      result.current.setQuality('high')
    })
    expect(result.current.quality).toBe('high')
    expect(localStorage.getItem(QUALITY_KEY)).toBe('high')
  })
})

describe('shared key', () => {
  it('lets a second reader follow a change made through the first', () => {
    const first = renderHook(() => useTextureQuality())
    const second = renderHook(() => useTextureQuality())
    act(() => {
      first.result.current.setQuality('high')
    })
    expect(second.result.current.quality).toBe('high')
  })
})

it('offers exactly the two qualities the server builds', () => {
  expect([...TEXTURE_QUALITIES]).toEqual(['standard', 'high'])
})
