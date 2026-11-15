/**
 * MatchNotFetched.test.tsx — a shared match link on an install that does not have the match:
 * the pre-game page shows the fetch panel instead of an error, the button queues the server's
 * fetch, the progress is the server's, the replay opens in place when the fetch is done, a
 * signed-out user gets the existing sign-in, and a 409 says the server is busy. Every request
 * goes to a mocked `fetch`; nothing reaches a real server.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PreGameScreen } from './PreGameScreen'

vi.mock('./MatchViewScreen', () => ({ ReplayViewer: () => <div data-testid="replay-viewer" /> }))
vi.mock('../lib/replay/replayNormalize', () => ({ normalizeReplayDocument: (raw: unknown) => raw }))

const ID = '11111111-2222-3333-4444-555555555555'

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

interface Script {
  auth: unknown
  /** Answers of `POST .../fetch`, in order (the last one repeats). */
  posts?: Response[]
  /** Answers of `GET .../fetch/state`, in order (the last one repeats). */
  states?: unknown[]
}

/** A fetch mock that routes by method and path; `stored` flips the replay route from 404 to
 *  200 (the match landed on disk). */
function routeFetch(script: Script) {
  const calls: { method: string; url: string }[] = []
  let posts = 0
  let polls = 0
  const state = { stored: false }
  const mock = vi.fn(async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const url = String(input)
    calls.push({ method, url })
    if (url === '/api/auth/state') return json(script.auth)
    if (url === '/api/auth/login' && method === 'POST') {
      return json({ state: 'pending', userCode: 'ABCD-EFGH', verificationUri: 'https://microsoft.com/link', expiresAt: new Date(Date.now() + 600_000).toISOString() }, 202)
    }
    if (url === '/api/matches') return json([])
    if (url === `/api/matches/${ID}/replay`) {
      return state.stored ? json({ id: ID }) : json({ error: 'match_not_found', id: ID }, 404)
    }
    if (url === `/api/matches/${ID}/mesh.glb` && method === 'HEAD') return json(null, 200)
    if (url === `/api/matches/${ID}/fetch` && method === 'POST') {
      const list = script.posts ?? [json({ state: 'queued', matchId: ID, done: 0, total: 0, position: 1 }, 202)]
      return list[Math.min(posts++, list.length - 1)]
    }
    if (url === `/api/matches/${ID}/fetch/state`) {
      const list = script.states ?? [{ state: 'idle', matchId: ID, done: 0, total: 0 }]
      const body = list[Math.min(polls++, list.length - 1)] as { state: string }
      if (body.state === 'ready') state.stored = true
      return json(body)
    }
    return json({ error: 'not found' }, 404)
  })
  return { mock, calls, state }
}

/** Lets the pending fetch promises settle and the effects re-render. */
async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('a shared match link to a match this install does not have', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows the fetch button, polls the real progress, and opens the replay in place when done', async () => {
    const { mock, calls } = routeFetch({
      auth: { state: 'signed_in', gamertag: 'Chief' },
      states: [
        { state: 'downloading', matchId: ID, done: 3, total: 12 },
        { state: 'building', matchId: ID, done: 12, total: 12 },
        { state: 'ready', matchId: ID, done: 12, total: 12 },
      ],
    })
    vi.stubGlobal('fetch', mock)
    render(<PreGameScreen matchId={ID} onBack={vi.fn()} />)
    await flush()

    expect(screen.getByTestId('match-not-fetched')).toBeInTheDocument()
    expect(screen.getByText(ID)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Fetch this match' }))
    await flush()
    expect(calls.filter((c) => c.method === 'POST' && c.url === `/api/matches/${ID}/fetch`)).toHaveLength(1)
    expect(screen.getByText('Queued…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fetch this match' })).toBeNull()

    await flush(2000)
    expect(screen.getByText('Downloading the film… 3/12')).toBeInTheDocument()
    await flush(2000)
    expect(screen.getByText('Building the replay…')).toBeInTheDocument()
    expect(screen.queryByTestId('replay-viewer')).toBeNull()

    // Ready: the page loads the stored document again (no reload) and mounts the viewer.
    await flush(2000)
    await flush()
    expect(screen.queryByTestId('match-not-fetched')).toBeNull()
    expect(screen.getByTestId('replay-viewer')).toBeInTheDocument()
    expect(calls.filter((c) => c.url === `/api/matches/${ID}/replay`)).toHaveLength(2)
  })

  it('asks a signed-out user to sign in through the existing sign-in plate', async () => {
    const { mock, calls } = routeFetch({ auth: { state: 'signed_out' } })
    vi.stubGlobal('fetch', mock)
    render(<PreGameScreen matchId={ID} onBack={vi.fn()} />)
    await flush()

    expect(screen.getByText(/Sign in with your Xbox account to fetch this match/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fetch this match' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await flush()
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/auth/login')).toBe(true)
    expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText('ABCD-EFGH')).toBeInTheDocument()
    // No fetch was queued while signed out.
    expect(calls.some((c) => c.url === `/api/matches/${ID}/fetch`)).toBe(false)
  })

  it('says the server is busy when the fetch answers 409', async () => {
    const { mock } = routeFetch({
      auth: { state: 'signed_in', gamertag: 'Chief' },
      posts: [json({ error: 'fetch in progress' }, 409)],
      states: [{ state: 'idle', matchId: ID, done: 0, total: 0 }],
    })
    vi.stubGlobal('fetch', mock)
    render(<PreGameScreen matchId={ID} onBack={vi.fn()} />)
    await flush()

    fireEvent.click(screen.getByRole('button', { name: 'Fetch this match' }))
    await flush()
    expect(screen.getByText(/The server is busy with another fetch/)).toBeInTheDocument()
    // The queue keeps polling and reads idle (another match is in flight): still busy.
    await flush(2000)
    expect(screen.getByText(/The server is busy with another fetch/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fetch this match' })).toBeNull()
  })

  it('reports a film the service no longer serves', async () => {
    const { mock } = routeFetch({
      auth: { state: 'signed_in', gamertag: 'Chief' },
      states: [{ state: 'failed', matchId: ID, done: 0, total: 0, error: 'film not available' }],
    })
    vi.stubGlobal('fetch', mock)
    render(<PreGameScreen matchId={ID} onBack={vi.fn()} />)
    await flush()

    fireEvent.click(screen.getByRole('button', { name: 'Fetch this match' }))
    await flush()
    await flush(2000)
    expect(screen.getByText('This film is no longer available on the Halo service.')).toBeInTheDocument()
  })
})
