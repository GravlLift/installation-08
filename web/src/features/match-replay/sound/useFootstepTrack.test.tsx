/**
 * useFootstepTrack.test.tsx — WHEN THE FOOT SOUNDS ARE READ: only when the sound is on, and a
 * machine with nothing extracted (a null manifest) leaves them silent, without a retry.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useFootstepTrack } from './useFootstepTrack'
import type { FootstepManifest } from './footstepManifest'

const MANIFEST: FootstepManifest = {
  version: 1,
  feet: { default: { walk: { takes: [{ file: 'foot_00000001.ogg', media: 1, durationMs: 180 }] } } },
  movement: {},
}

afterEach(() => vi.unstubAllGlobals())

describe('useFootstepTrack', () => {
  it('reads nothing before the sound is on', () => {
    const load = vi.fn(async () => MANIFEST)
    const { result } = renderHook(() => useFootstepTrack(false, { load }))
    expect(result.current).toBeUndefined()
    expect(load).not.toHaveBeenCalled()
  })

  it('reads once when the sound turns on, and reports the manifest', async () => {
    const load = vi.fn(async () => MANIFEST)
    const src = { load }
    const { result } = renderHook(() => useFootstepTrack(true, src))
    await act(async () => {
      await Promise.resolve()
    })
    expect(load).toHaveBeenCalledTimes(1)
    expect(result.current).toBe(MANIFEST)
  })

  it('a machine with nothing extracted stays silent (undefined), no error', async () => {
    const load = vi.fn(async () => null)
    const { result } = renderHook(() => useFootstepTrack(true, { load }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current).toBeUndefined()
  })
})
