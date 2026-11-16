/**
 * useReplay3dLook.test.ts — the persisted Bloom setting: on by default, persisted when toggled,
 * read back on mount, and followed by a second reader of the same key (the 3D view).
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { LOOK3D_DEFAULT } from '../scene3d/look3d'
import { BLOOM_KEY, useReplay3dLook } from './useReplay3dLook'

beforeEach(() => {
  localStorage.clear()
})

describe('the Bloom setting', () => {
  it('is on by default', () => {
    expect(LOOK3D_DEFAULT.bloom).toBe(true)
    const { result } = renderHook(() => useReplay3dLook())
    expect(result.current.look.bloom).toBe(true)
  })

  it('persists a toggle and reads it back on mount', () => {
    const { result, unmount } = renderHook(() => useReplay3dLook())
    act(() => result.current.toggleBloom())
    expect(result.current.look.bloom).toBe(false)
    expect(localStorage.getItem(BLOOM_KEY)).toBe('false')
    unmount()
    const again = renderHook(() => useReplay3dLook())
    expect(again.result.current.look.bloom).toBe(false)
    // The other settings are untouched.
    expect(again.result.current.look).toEqual({ ...LOOK3D_DEFAULT, bloom: false })
  })

  it('lets a second reader (the 3D view) follow the drawer', () => {
    const drawer = renderHook(() => useReplay3dLook())
    const view = renderHook(() => useReplay3dLook())
    act(() => drawer.result.current.toggleBloom())
    expect(view.result.current.look.bloom).toBe(false)
    act(() => drawer.result.current.toggleBloom())
    expect(view.result.current.look.bloom).toBe(true)
    expect(localStorage.getItem(BLOOM_KEY)).toBe('true')
  })
})
