// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * PreGameQualitySwitch.test.tsx — switching the texture quality while the viewer is mounted must
 * not drop the viewer. The pre-game used to follow the live preference: a switch re-ran the
 * document load, the viewer unmounted while it reloaded, and the page went blank for good. The
 * viewer handles a switch itself (its in-viewer build gate); the pre-game keeps the quality it
 * mounted with. Every request goes to a mocked `fetch`.
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { persistPreference } from '../features/match-replay/settings/replayPreferences'
import { PreGameScreen } from './PreGameScreen'

vi.mock('./MatchViewScreen', () => ({ ReplayViewer: () => <div data-testid="replay-viewer" /> }))
vi.mock('../lib/replay/replayNormalize', () => ({ normalizeReplayDocument: (raw: unknown) => raw }))

const ID = '11111111-2222-3333-4444-555555555555'

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('a texture-quality switch with the viewer mounted', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.setItem('replay-texture-quality', 'standard')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    localStorage.removeItem('replay-texture-quality')
  })

  it('keeps the viewer mounted and does not reload the match', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url === '/api/auth/state') return json({ state: 'signed_in', gamertag: 'Chief' })
      if (url === `/api/matches/${ID}/replay`) return json({ id: ID })
      // Standard is built; High is not (the case that blanked the page).
      if (url === `/api/matches/${ID}/mesh.glb` && init?.method === 'HEAD') return json(null, 200)
      if (url.startsWith(`/api/matches/${ID}/mesh.glb?quality=high`)) return json(null, 404)
      return json({ error: 'not found' }, 404)
    }))
    render(<PreGameScreen matchId={ID} onBack={vi.fn()} />)
    await flush()
    expect(screen.getByTestId('replay-viewer')).toBeInTheDocument()
    const replayLoads = calls.filter((c) => c.endsWith(`/api/matches/${ID}/replay`)).length

    act(() => persistPreference('replay-texture-quality', 'high'))
    await flush()
    await flush(2000)

    expect(screen.getByTestId('replay-viewer')).toBeInTheDocument()
    expect(calls.filter((c) => c.endsWith(`/api/matches/${ID}/replay`))).toHaveLength(replayLoads)
    expect(calls.some((c) => c.includes('quality=high'))).toBe(false)
  })
})
