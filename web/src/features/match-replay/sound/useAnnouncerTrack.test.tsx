/**
 * useAnnouncerTrack.test.tsx — the extracted voice joins the announcer's input once the sound is
 * on, and nothing is read before (no language, sound off).
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { tableVoice } from './announcerVoice'
import { useAnnouncerTrack, type AnnouncerContext } from './useAnnouncerTrack'

const VOICE = tableVoice({ 'medal.double_kill': { en: { stem: 'announcer_doublekill_01', durationMs: 900 } } })
const CONTEXT: AnnouncerContext = { locale: 'en', followed: 'me', medals: [] }

describe('useAnnouncerTrack', () => {
  it('sound off: no load, the bundled lines only', () => {
    const load = vi.fn(async () => VOICE)
    const { result } = renderHook(() => useAnnouncerTrack(CONTEXT, false, load))
    expect(load).not.toHaveBeenCalled()
    expect(result.current?.voice).toBeUndefined()
  })

  it('no language: no announcer and no load', () => {
    const load = vi.fn(async () => VOICE)
    const { result } = renderHook(() => useAnnouncerTrack({ ...CONTEXT, locale: undefined }, true, load))
    expect(load).not.toHaveBeenCalled()
    expect(result.current).toBeUndefined()
  })

  it('sound on: the voice arrives in the input; nothing extracted leaves it bundled-only', async () => {
    const load = vi.fn(async () => VOICE)
    const { result } = renderHook(() => useAnnouncerTrack(CONTEXT, true, load))
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(1)
    expect(result.current?.voice).toBe(VOICE)
    const none = renderHook(() => useAnnouncerTrack(CONTEXT, true, async () => null))
    await act(async () => {})
    expect(none.result.current?.voice).toBeUndefined()
  })
})
