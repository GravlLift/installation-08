/**
 * useReloadTrack.test.tsx — nothing is read before the sound is on; once on, the match's
 * weapons get their reloads with a measured gain; nothing extracted leaves them silent.
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { testReplayDoc } from '../test/testDoc'
import type { ReloadManifest } from './reloadManifest'
import { useReloadTrack, type ReloadSources } from './useReloadTrack'

const VENT = (animation: string) => ({
  enter: { animation: `${animation}:vent_enter`, durationMs: 700, sounds: [{ atMs: 0, takes: [{ file: 'reload_00000010.ogg', durationMs: 400 }] }] },
  loop: { animation: `${animation}:vent_loop`, durationMs: 500, sounds: [] },
  exit: { animation: `${animation}:vent_exit`, durationMs: 400, sounds: [{ atMs: 50, takes: [{ file: 'reload_00000011.ogg', durationMs: 300 }] }] },
})

const MANIFEST: ReloadManifest = {
  version: 2,
  weapons: {
    '2b1824d5': { combat: { animation: 'a', durationMs: 1900, sounds: [{ atMs: 0, takes: [{ file: 'reload_00000001.ogg', durationMs: 300 }] }] } },
    '0a1992bc': { combat: { animation: 'b', durationMs: 2100, sounds: [{ atMs: 0, takes: [{ file: 'reload_00000002.ogg', durationMs: 300 }] }] } },
  },
  vents: {
    daf193c7: { combat: VENT('combat:pistol:stalker') },
  },
}

const DOC = testReplayDoc({ weaponLabels: { '0x2B1824D542C9679F': { en: 'BR75', fr: 'BR75', tint: 'kinetic', key: 'hinf_br75' } } })
const STALKER_DOC = testReplayDoc({ weaponLabels: { '0xDAF193C742C9679F': { en: 'Stalker', fr: 'Stalker', tint: 'plasma', key: 'hinf_stalker' } } })

function sources(manifest: ReloadManifest | null): ReloadSources {
  return { load: vi.fn(async () => manifest), measure: vi.fn(async () => ({ rmsDb: -20, peakDb: -3 })) }
}

describe('useReloadTrack', () => {
  it('sound off: nothing read', () => {
    const src = sources(MANIFEST)
    const { result } = renderHook(() => useReloadTrack(DOC, false, src))
    expect(src.load).not.toHaveBeenCalled()
    expect(result.current).toBeUndefined()
  })

  it('sound on: the match weapons only, their takes measured', async () => {
    const src = sources(MANIFEST)
    const { result } = renderHook(() => useReloadTrack(DOC, true, src))
    await act(async () => {})
    expect([...(result.current?.reloads.keys() ?? [])]).toEqual(['2b1824d5'])
    expect(result.current?.vents.size).toBe(0)
    expect(src.measure).toHaveBeenCalledTimes(1)
    expect(src.measure).toHaveBeenCalledWith('reload_00000001.ogg')
  })

  it('a match with a heat weapon reads its vent takes', async () => {
    const src = sources(MANIFEST)
    const { result } = renderHook(() => useReloadTrack(STALKER_DOC, true, src))
    await act(async () => {})
    expect([...(result.current?.vents.keys() ?? [])]).toEqual(['daf193c7'])
    expect(result.current?.reloads.size).toBe(0)
    expect(src.measure).toHaveBeenCalledTimes(2)
    expect(src.measure).toHaveBeenCalledWith('reload_00000010.ogg')
    expect(src.measure).toHaveBeenCalledWith('reload_00000011.ogg')
  })

  it('a match that names no weapon reads nothing', async () => {
    const src = sources(MANIFEST)
    renderHook(() => useReloadTrack(testReplayDoc(), true, src))
    await act(async () => {})
    expect(src.load).not.toHaveBeenCalled()
  })

  it('nothing extracted: no reloads', async () => {
    const src = sources(null)
    const { result } = renderHook(() => useReloadTrack(DOC, true, src))
    await act(async () => {})
    expect(result.current).toBeUndefined()
    expect(src.measure).not.toHaveBeenCalled()
  })
})
