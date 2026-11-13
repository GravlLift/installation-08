import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReplayDocumentReady } from '../lib/replay/replayNormalize'
import { useMatchReplayContext } from './useMatchReplayContext'

vi.mock('./useAuthState', () => ({ useAuthState: () => ({ phase: { phase: 'signed_in', gamertag: 'Alpha' } }) }))
afterEach(() => vi.unstubAllGlobals())

it('loads the selected player context and derives the replay window and time limit', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    header: { t0_ms: 20000, playable_duration_seconds: 30 }, scoreboard: [], highlight_events: [],
    media: { media_items: [] }, source_unavailable: false, regulation_seconds: 720,
  }) })
  vi.stubGlobal('fetch', fetchMock)
  const doc = { roster: [{ xuid: '123', name: 'Alpha' }], tracks: [], originMs: 0, frameCount: 1000, frameIntervalMs: 100 } as unknown as ReplayDocumentReady
  const { result } = renderHook(() => useMatchReplayContext('abc', doc))
  await waitFor(() => expect(result.current.timeLimitMs).toBe(720000))
  expect(fetchMock).toHaveBeenCalledWith('/api/matches/abc/context?xuid=123', expect.any(Object))
  expect(result.current.playWindow?.startMs).toBe(20000)
})
