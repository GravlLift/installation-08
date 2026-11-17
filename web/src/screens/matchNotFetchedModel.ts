// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * matchNotFetchedModel — the words and the one action of the panel a shared match link shows
 * when the match is not stored on this install (`MatchNotFetched.tsx`). Pure: it turns the
 * sign-in phase and the match's fetch phase (`useMatchFetchQueue`) into what the panel renders,
 * so every state is tested without a network or a timer.
 *
 * The app has no string table: page copy is English, written in the model files beside the
 * screens (same as `matchSelectModel.ts` and `preGameModel.ts`).
 */
import type { AuthPhase } from './useAuthState'
import type { FetchRowPhase } from './useMatchFetchQueue'

/** The one button the panel can show. */
export type MatchNotFetchedAction = 'fetch' | 'retry' | 'signin' | null

export interface MatchNotFetchedView {
  /** The line under the title: what is going on, in words. */
  message: string
  /** Present while a fetch is in flight: the progress line's step label and its fraction
   *  (null: indeterminate; nothing invents a percentage). */
  progress: { label: string; fraction: number | null } | null
  action: MatchNotFetchedAction
  /** The button's label, when there is an action. */
  actionLabel: string | null
  /** True when the message reports a failure (styled as an error). */
  bad: boolean
}

export const NOT_FETCHED_TITLE = 'Match not on this install'
export const NOT_FETCHED_MESSAGE = 'This match is not stored here yet. Fetch it from the Halo service to watch it.'
export const SIGN_IN_MESSAGE = 'Sign in with your Xbox account to fetch this match from the Halo service.'
export const READ_ONLY_MESSAGE = 'This server is read-only: it cannot fetch matches.'
export const BUSY_MESSAGE = 'The server is busy with another fetch. This match can be fetched once that one is done.'
export const FILM_GONE_MESSAGE = 'This film is no longer available on the Halo service.'

/** The server words a fetch that failed at its sign-in step `sign-in failed: <cause>`
 *  (`fetchStepSignIn` in `cmd/infinite-theater-3d/fetch.go`). */
function isSignInFailure(error: string): boolean {
  return error.startsWith('sign-in failed')
}

function view(
  message: string,
  action: MatchNotFetchedAction = null,
  progress: MatchNotFetchedView['progress'] = null,
  bad = false,
): MatchNotFetchedView {
  const actionLabel =
    action === 'fetch' ? 'Fetch this match' : action === 'retry' ? 'Try again' : action === 'signin' ? 'Sign in' : null
  return { message, progress, action, actionLabel, bad }
}

/**
 * The panel's state. `busy` is true once this match's fetch answered 409 (an older server that
 * runs one fetch at a time refused it): the queue then keeps polling and reads `idle` while the
 * other match is the one in flight, which must not read as "never started".
 */
export function matchNotFetchedView(
  auth: AuthPhase,
  readOnly: boolean,
  fetch: FetchRowPhase,
  busy: boolean,
): MatchNotFetchedView {
  // A fetch already under way is reported first, whatever the sign-in state says.
  switch (fetch.phase) {
    case 'queued':
      return view(
        'Fetching the match…',
        null,
        { label: fetch.position > 1 ? `Queued (position ${fetch.position})…` : 'Queued…', fraction: null },
      )
    case 'downloading':
      return view('Fetching the match…', null, {
        label: fetch.total > 0 ? `Downloading the film… ${fetch.done}/${fetch.total}` : 'Downloading the film…',
        fraction: fetch.total > 0 ? fetch.done / fetch.total : null,
      })
    case 'building':
      return view('Fetching the match…', null, { label: 'Building the replay…', fraction: null })
    case 'ready':
      return view('Fetched.', null, { label: 'Opening the replay…', fraction: 1 })
    case 'blocked':
      return view(BUSY_MESSAGE, null, null, true)
    case 'idle':
      if (busy) return view(BUSY_MESSAGE, null, null, true)
      break
    case 'failed':
      if (fetch.error === 'film not available') return view(FILM_GONE_MESSAGE, null, null, true)
      // The fetch could not sign in: offer the sign-in, unless the page already reads a
      // signed-in account (then signing in again changes nothing, so offer another try).
      if (isSignInFailure(fetch.error) && auth.phase !== 'signed_in') {
        return view(SIGN_IN_MESSAGE, readOnly ? null : 'signin', null, true)
      }
      return view(`Fetch failed: ${fetch.error}`, 'retry', null, true)
  }

  if (readOnly) return view(READ_ONLY_MESSAGE)
  switch (auth.phase) {
    case 'loading':
      return view('Checking the sign-in…')
    case 'pending':
      return view('Finish signing in on Microsoft\'s page to fetch this match.')
    case 'signed_in':
      return view(NOT_FETCHED_MESSAGE, 'fetch')
    case 'signed_out':
      return view(SIGN_IN_MESSAGE, 'signin')
    case 'failed':
      return view(`${SIGN_IN_MESSAGE} (${auth.error})`, 'signin', null, true)
  }
}
