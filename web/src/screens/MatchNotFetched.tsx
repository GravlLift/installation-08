// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * MatchNotFetched — what a match link shows when the match is not stored on this install
 * (another user's shared `#/matches/<id>`): the match id, a button that queues the server's
 * fetch-by-id (`POST /api/matches/{id}/fetch`, through `useMatchFetchQueue`, the same hook and
 * poller as the match list's Fetch rows), the job's real progress, and its errors (sign-in
 * needed, film no longer available, server busy with another fetch). When the job reports
 * `ready` it calls `onFetched`, and the pre-game page loads the replay in place.
 *
 * Signed out, it offers the app's existing sign-in (`useAuthState().login` and its
 * `SignInPlate`), so the page stays on this match while the user signs in. The words and the
 * action per state are `matchNotFetchedModel.ts`, tested there.
 */
import { useEffect, useState } from 'react'

import { matchNotFetchedView, NOT_FETCHED_TITLE } from './matchNotFetchedModel'
import { ProgressLine } from './ProgressLine'
import { SignInPlate } from './SignInPlate'
import type { UseAuthStateResult } from './useAuthState'
import { useMatchFetchQueue } from './useMatchFetchQueue'

export interface MatchNotFetchedProps {
  matchId: string
  /** The page's sign-in state (one `useAuthState` per page, owned by the caller). */
  auth: UseAuthStateResult
  /** Called once, when the fetch job reports `ready`. */
  onFetched: () => void
  onBack: () => void
  /** The fetch-state polling interval (tests shorten it). */
  pollMs?: number
}

export function MatchNotFetched({ matchId, auth, onFetched, onBack, pollMs }: MatchNotFetchedProps) {
  const queue = useMatchFetchQueue(() => onFetched(), pollMs)
  const phase = queue.phaseOf(matchId)

  // A 409 from an older server leaves the queue polling this id, which reads `idle` while the
  // other match is in flight: remember the conflict so that `idle` still says "busy".
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (phase.phase === 'blocked') setBusy(true)
    else if (phase.phase !== 'idle') setBusy(false)
  }, [phase.phase])

  const view = matchNotFetchedView(auth.phase, auth.readOnly, phase, busy)
  const onAction = () => {
    if (view.action === 'signin') auth.login()
    else if (view.action === 'fetch' || view.action === 'retry') queue.start(matchId)
  }

  return (
    <div data-testid="match-not-fetched" className="bc-not-fetched">
      <div className="bc-eyebrow">{NOT_FETCHED_TITLE}</div>
      <h1 className="bc-title bc-title-id">{matchId}</h1>
      <p className={view.bad ? 'bc-pregame-error' : 'bc-signin-text'}>{view.message}</p>
      {view.progress ? <ProgressLine label={view.progress.label} fraction={view.progress.fraction} /> : null}
      <div className="bc-pregame-actions">
        {view.action ? (
          <button type="button" className="bc-cta" onClick={onAction}>
            {view.actionLabel}
          </button>
        ) : null}
        <button type="button" className="bc-signout" onClick={onBack}>
          Back to matches
        </button>
      </div>
      {auth.phase.phase === 'pending' ? <SignInPlate phase={auth.phase} onCancel={auth.logout} /> : null}
    </div>
  )
}
