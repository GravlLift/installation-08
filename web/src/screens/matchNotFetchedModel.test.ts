// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import {
  BUSY_MESSAGE,
  FILM_GONE_MESSAGE,
  matchNotFetchedView,
  NOT_FETCHED_MESSAGE,
  READ_ONLY_MESSAGE,
  SIGN_IN_MESSAGE,
} from './matchNotFetchedModel'
import type { AuthPhase } from './useAuthState'

const signedIn: AuthPhase = { phase: 'signed_in', gamertag: 'Chief' }
const signedOut: AuthPhase = { phase: 'signed_out' }
const idle = { phase: 'idle' } as const

describe('matchNotFetchedView', () => {
  it('offers the fetch to a signed-in account', () => {
    const v = matchNotFetchedView(signedIn, false, idle, false)
    expect(v).toMatchObject({ message: NOT_FETCHED_MESSAGE, action: 'fetch', actionLabel: 'Fetch this match', progress: null, bad: false })
  })

  it('asks a signed-out user to sign in, and offers nothing on a read-only server', () => {
    expect(matchNotFetchedView(signedOut, false, idle, false)).toMatchObject({ message: SIGN_IN_MESSAGE, action: 'signin', actionLabel: 'Sign in' })
    expect(matchNotFetchedView({ phase: 'failed', error: 'x' }, false, idle, false).action).toBe('signin')
    expect(matchNotFetchedView(signedOut, true, idle, false)).toMatchObject({ message: READ_ONLY_MESSAGE, action: null })
    expect(matchNotFetchedView({ phase: 'loading' }, false, idle, false).action).toBeNull()
  })

  it('reports the real progress of each fetch step', () => {
    expect(matchNotFetchedView(signedIn, false, { phase: 'queued', position: 1 }, false).progress).toEqual({ label: 'Queued…', fraction: null })
    expect(matchNotFetchedView(signedIn, false, { phase: 'queued', position: 3 }, false).progress?.label).toBe('Queued (position 3)…')
    expect(matchNotFetchedView(signedIn, false, { phase: 'downloading', done: 3, total: 12 }, false).progress).toEqual({
      label: 'Downloading the film… 3/12',
      fraction: 0.25,
    })
    expect(matchNotFetchedView(signedIn, false, { phase: 'downloading', done: 0, total: 0 }, false).progress).toEqual({
      label: 'Downloading the film…',
      fraction: null,
    })
    expect(matchNotFetchedView(signedIn, false, { phase: 'building' }, false).progress).toEqual({ label: 'Building the replay…', fraction: null })
    const inFlight = matchNotFetchedView(signedIn, false, { phase: 'building' }, false)
    expect(inFlight.action).toBeNull()
  })

  it('says the server is busy after a 409, also while the queue reads idle', () => {
    expect(matchNotFetchedView(signedIn, false, { phase: 'blocked' }, true)).toMatchObject({ message: BUSY_MESSAGE, action: null, bad: true })
    expect(matchNotFetchedView(signedIn, false, idle, true)).toMatchObject({ message: BUSY_MESSAGE, action: null })
  })

  it('words the failures: film gone, sign-in failed, anything else with a retry', () => {
    expect(matchNotFetchedView(signedIn, false, { phase: 'failed', error: 'film not available' }, false)).toMatchObject({ message: FILM_GONE_MESSAGE, action: null, bad: true })
    expect(matchNotFetchedView(signedOut, false, { phase: 'failed', error: 'sign-in failed: no token' }, false)).toMatchObject({ message: SIGN_IN_MESSAGE, action: 'signin' })
    // Signed in already: signing in again changes nothing, so the page offers another try.
    expect(matchNotFetchedView(signedIn, false, { phase: 'failed', error: 'sign-in failed: expired' }, false).action).toBe('retry')
    expect(matchNotFetchedView(signedIn, false, { phase: 'failed', error: 'boom' }, false)).toMatchObject({ message: 'Fetch failed: boom', action: 'retry', actionLabel: 'Try again' })
  })
})
