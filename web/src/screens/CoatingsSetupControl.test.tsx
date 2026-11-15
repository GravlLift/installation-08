/**
 * CoatingsSetupControl.test.tsx — the "Set up coatings" control: the notice and button, the
 * progress through the server's stages to ready, the failure message with Retry, adopting a
 * setup already running on mount, and the read-only refusal worded. `fetch` is mocked by
 * route; nothing reaches a server.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CoatingsSetupControl } from './CoatingsSetupControl'
import { setupPhaseOf } from './useCoatingsSetup'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

/** A fetch mock that answers the setup routes: `states` are served in order to the state
 *  route (the last one repeats), `post` answers the start route. */
function routeFetch(states: unknown[], post: () => Response = () => jsonResponse({ state: 'extracting' }, 202)) {
  let i = 0
  const posts: string[] = []
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/coatings/setup' && init?.method === 'POST') {
      posts.push(url)
      return post()
    }
    if (url === '/api/coatings/setup/state') {
      const body = states[Math.min(i, states.length - 1)]
      i++
      return jsonResponse(body)
    }
    return jsonResponse({ error: 'not found' }, 404)
  })
  return { mock, posts }
}

const NOTICE = 'Coatings off: no Ekur export found'

describe('setupPhaseOf', () => {
  it('maps every server state to its phase', () => {
    expect(setupPhaseOf({ state: 'idle' })).toEqual({ phase: 'idle' })
    expect(setupPhaseOf({ state: 'extracting' })).toEqual({ phase: 'running', stage: 'extracting' })
    expect(setupPhaseOf({ state: 'ready' })).toEqual({ phase: 'ready' })
    expect(setupPhaseOf({ state: 'failed', error: 'boom' })).toEqual({ phase: 'failed', error: 'boom' })
    expect(setupPhaseOf({ state: 'failed' })).toEqual({ phase: 'failed', error: 'the setup failed' })
  })
})

describe('CoatingsSetupControl', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows the notice and the button, then the stages, then the ready text', async () => {
    const { mock, posts } = routeFetch([{ state: 'idle' }, { state: 'extracting' }, { state: 'queuing' }, { state: 'ready' }])
    vi.stubGlobal('fetch', mock)
    render(<CoatingsSetupControl notice={NOTICE} pollMs={10} />)

    expect(screen.getByTestId('coatings-notice').textContent).toBe(NOTICE)
    // Let the mount read (idle) settle before clicking.
    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.click(screen.getByTestId('coatings-setup-button'))

    await waitFor(() => expect(screen.getByTestId('coatings-setup-status').textContent).toContain('Setting up coatings'))
    await waitFor(() =>
      expect(screen.getByTestId('coatings-setup-status').textContent).toContain('the coating libraries are rebuilding'),
    )
    expect(screen.queryByTestId('coatings-setup-button')).toBeNull()
    expect(posts).toHaveLength(1)
  })

  it('shows the failure message and retries', async () => {
    const { mock, posts } = routeFetch([
      { state: 'idle' },
      { state: 'failed', error: 'the Ekur export failed: it exited with code 3' },
    ])
    vi.stubGlobal('fetch', mock)
    render(<CoatingsSetupControl notice={NOTICE} pollMs={10} />)
    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.click(screen.getByTestId('coatings-setup-button'))

    await waitFor(() =>
      expect(screen.getByTestId('coatings-setup-status').textContent).toBe(
        'Coatings setup failed: the Ekur export failed: it exited with code 3',
      ),
    )
    const retry = screen.getByTestId('coatings-setup-button')
    expect(retry.textContent).toBe('Retry')
    fireEvent.click(retry)
    await waitFor(() => expect(posts).toHaveLength(2))
  })

  it('follows a setup already running when it mounts, without starting one', async () => {
    const { mock, posts } = routeFetch([{ state: 'extracting' }, { state: 'validating' }, { state: 'ready' }])
    vi.stubGlobal('fetch', mock)
    render(<CoatingsSetupControl notice={NOTICE} pollMs={10} />)

    await waitFor(() =>
      expect(screen.getByTestId('coatings-setup-status').textContent).toBe(
        'Setting up coatings: reading coating data from the game (about half a minute)',
      ),
    )
    await waitFor(() =>
      expect(screen.getByTestId('coatings-setup-status').textContent).toContain('the coating libraries are rebuilding'),
    )
    expect(posts).toHaveLength(0)
  })

  it('sets the expectation for the read: its length', async () => {
    const { mock } = routeFetch([{ state: 'extracting' }])
    vi.stubGlobal('fetch', mock)
    render(<CoatingsSetupControl notice={NOTICE} pollMs={10} />)
    await waitFor(() => {
      const text = screen.getByTestId('coatings-setup-status').textContent ?? ''
      expect(text).toContain('about half a minute')
    })
  })

  it('words the read-only refusal', async () => {
    const { mock } = routeFetch([{ state: 'idle' }], () => jsonResponse({ error: 'read_only' }, 403))
    vi.stubGlobal('fetch', mock)
    render(<CoatingsSetupControl notice={NOTICE} pollMs={10} />)
    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.click(screen.getByTestId('coatings-setup-button'))
    await waitFor(() =>
      expect(screen.getByTestId('coatings-setup-status').textContent).toBe('Coatings setup failed: this server is read-only'),
    )
  })
})
