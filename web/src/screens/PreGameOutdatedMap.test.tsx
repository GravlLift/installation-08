/**
 * PreGameOutdatedMap.test.tsx — a map file that is on disk but not `ready` to the build runner (an
 * older build format, or an update queued or running) must not mount the viewer: the viewer's gate
 * would drop the scene and show its Update map button underneath this screen, where it cannot be
 * clicked (Streets High after the format 3 upgrade). The pre-game keeps it in its own build step,
 * whose button works, and mounts the viewer once the file is ready. Every request goes to a mocked
 * `fetch`.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PreGameScreen } from './PreGameScreen'

vi.mock('./MatchViewScreen', () => ({ ReplayViewer: () => <div data-testid="replay-viewer" /> }))
vi.mock('../lib/replay/replayNormalize', () => ({ normalizeReplayDocument: (raw: unknown) => raw }))

const ID = '11111111-2222-3333-4444-555555555555'
const QUALITY_KEY = 'replay-texture-quality'

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** A server whose High map file is on disk (HEAD 200) in the state `state` says; a build request
 *  starts the update, and the next state poll answers `ready`. */
function serve(state: () => string) {
  const calls: string[] = []
  let built = false
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${url}`)
    if (url === '/api/auth/state') return json({ state: 'signed_out' })
    if (url === `/api/matches/${ID}/replay`) return json({ id: ID })
    if (url.startsWith(`/api/matches/${ID}/mesh.glb`)) return json(null, 200)
    if (url.startsWith(`/api/matches/${ID}/mesh/state`)) {
      return json({ state: built ? 'ready' : state(), moduleKey: 'sgh_streets.high', quality: 'high' })
    }
    if (url.startsWith(`/api/matches/${ID}/mesh/build`) && method === 'POST') {
      built = true
      return json({ state: 'building', moduleKey: 'sgh_streets.high', quality: 'high', progress: 0.5, elapsedMs: 500 }, 202)
    }
    return json({ error: 'not found' }, 404)
  }))
  return calls
}

describe('a map file on disk that is not ready', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.setItem(QUALITY_KEY, 'high')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    localStorage.removeItem(QUALITY_KEY)
  })

  it('outdated: offers Update map on the pre-game, and mounts the viewer once updated', async () => {
    const calls = serve(() => 'outdated')
    render(<PreGameScreen matchId={ID} onBack={vi.fn()} />)
    await flush()
    await flush()

    expect(screen.queryByTestId('replay-viewer')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Update map' }))
    await flush()
    expect(calls).toContain(`POST /api/matches/${ID}/mesh/build?quality=high`)
    await flush(2000)
    await flush()

    expect(screen.getByTestId('replay-viewer')).toBeInTheDocument()
  })

  it('queued: shows the queue on the pre-game and mounts the viewer when the update is done', async () => {
    let state = 'queued'
    serve(() => state)
    render(<PreGameScreen matchId={ID} onBack={vi.fn()} />)
    await flush()
    await flush()

    expect(screen.queryByTestId('replay-viewer')).toBeNull()
    expect(screen.getByText(/Queued/)).toBeInTheDocument()
    state = 'ready'
    await flush(2000)
    await flush()

    expect(screen.getByTestId('replay-viewer')).toBeInTheDocument()
  })
})
