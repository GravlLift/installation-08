// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * PreGameQualityChoice.test.tsx — the texture-quality choice the pre-game offers before a first
 * build: when the map is not built at the stored quality, both qualities are offered with their
 * rough cost; a pick stores the preference and builds ONLY that quality (the build request's
 * `?quality=` query); when the map is already built, there is no choice and the viewer mounts.
 * Every request goes to a mocked `fetch`.
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

/** A server where `built` lists the qualities whose map is on disk; a build request moves its
 *  quality to `building`. Every call is recorded as "METHOD url". */
function serve(built: Array<'standard' | 'high'>) {
  const calls: string[] = []
  const building = new Set<string>()
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${url}`)
    const high = url.includes('quality=high')
    const q = high ? 'high' : 'standard'
    if (url === '/api/auth/state') return json({ state: 'signed_out' })
    if (url === `/api/matches/${ID}/replay`) return json({ id: ID })
    if (url === '/api/matches') return json([{ matchId: ID, mapName: 'Streets', players: [], readyStandard: built.includes('standard'), readyHigh: built.includes('high') }])
    if (url.startsWith(`/api/matches/${ID}/mesh.glb`)) {
      if (built.includes(q)) return json(null, 200)
      return json({ error: 'mesh_not_built', moduleKey: 'streets' }, 404)
    }
    if (url.startsWith(`/api/matches/${ID}/mesh/state`)) {
      if (built.includes(q)) return json({ state: 'ready', moduleKey: 'streets' })
      return json({ state: building.has(q) ? 'building' : 'absent', moduleKey: 'streets' })
    }
    if (url.startsWith(`/api/matches/${ID}/mesh/build`) && method === 'POST') {
      building.add(q)
      return json({ state: 'building', moduleKey: 'streets', progress: 0.01, elapsedMs: 1000 }, 202)
    }
    return json({ error: 'not found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

const builds = (calls: string[]) => calls.filter((c) => c.startsWith('POST ') && c.includes('/mesh/build'))

describe('the pre-game quality choice', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.removeItem(QUALITY_KEY)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    localStorage.removeItem(QUALITY_KEY)
  })

  it('offers both qualities with their rough cost when the map is not built', async () => {
    serve([])
    render(<PreGameScreen matchId={ID} onBack={vi.fn()} />)
    await flush()
    await flush()

    expect(screen.getByTestId('quality-choice')).toBeInTheDocument()
    expect(screen.getByTestId('build-quality-standard').textContent).toContain('about 2 min')
    expect(screen.getByTestId('build-quality-standard').textContent).toContain('850 MB')
    expect(screen.getByTestId('build-quality-high').textContent).toContain('about 8 min')
    expect(screen.getByTestId('build-quality-high').textContent).toContain('1.4 GB')
    // The default (Standard) is the marked one.
    expect(screen.getByTestId('build-quality-standard')).toHaveClass('on')
    expect(screen.queryByTestId('replay-viewer')).toBeNull()
  })

  it('marks the quality already built as Load and says it waits for a pick', async () => {
    serve(['standard'])
    localStorage.setItem(QUALITY_KEY, 'high')
    render(<PreGameScreen matchId={ID} onBack={vi.fn()} />)
    await flush()
    await flush()

    expect(screen.getByTestId('quality-choice').textContent).toContain('not built at High yet')
    expect(screen.getByTestId('build-quality-standard').textContent).toContain('Load Standard')
    expect(screen.getByTestId('build-quality-standard').textContent).toContain('already built')
    expect(screen.getByTestId('build-quality-high').textContent).toContain('Build High')
    expect(document.body.textContent).toContain('Waiting for a texture quality pick')
    expect(document.body.textContent).not.toContain('Match loading')
  })

  it('picking High stores it and builds only High', async () => {
    const calls = serve([])
    render(<PreGameScreen matchId={ID} onBack={vi.fn()} />)
    await flush()
    await flush()

    fireEvent.click(screen.getByTestId('build-quality-high'))
    await flush()
    await flush()
    await flush()

    expect(localStorage.getItem(QUALITY_KEY)).toBe('high')
    expect(builds(calls)).toEqual([`POST /api/matches/${ID}/mesh/build?quality=high`])
    // The build runs: the choice is gone and the progress line shows the build.
    expect(screen.queryByTestId('quality-choice')).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    // The document was not fetched again for the new quality.
    expect(calls.filter((c) => c === `GET /api/matches/${ID}/replay`)).toHaveLength(1)
  })

  it('picking Standard builds only Standard', async () => {
    const calls = serve([])
    render(<PreGameScreen matchId={ID} onBack={vi.fn()} />)
    await flush()
    await flush()

    fireEvent.click(screen.getByTestId('build-quality-standard'))
    await flush()
    await flush()

    expect(localStorage.getItem(QUALITY_KEY)).toBe('standard')
    expect(builds(calls)).toEqual([`POST /api/matches/${ID}/mesh/build`])
    expect(screen.queryByTestId('quality-choice')).toBeNull()
  })

  it('picking High when High is already built builds nothing and mounts the viewer', async () => {
    const calls = serve(['high'])
    render(<PreGameScreen matchId={ID} onBack={vi.fn()} />)
    await flush()
    await flush()

    fireEvent.click(screen.getByTestId('build-quality-high'))
    await flush()
    await flush()

    expect(builds(calls)).toEqual([])
    expect(screen.getByTestId('replay-viewer')).toBeInTheDocument()
  })

  it('skips the choice when the map is already built at the stored quality', async () => {
    const calls = serve(['standard'])
    render(<PreGameScreen matchId={ID} onBack={vi.fn()} />)
    await flush()
    await flush()

    expect(screen.queryByTestId('quality-choice')).toBeNull()
    expect(screen.getByTestId('replay-viewer')).toBeInTheDocument()
    expect(builds(calls)).toEqual([])
  })
})
