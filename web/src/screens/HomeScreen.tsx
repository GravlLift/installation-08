// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * HomeScreen — the broadcast desk (docs/UI-DESIGN.md 4.1, brief 123): the main menu as a
 * FocusList on the left, the featured game on the right (a sharp map still with its plate
 * over the lower left), the TopBar with the sign-in state and the Ticker with the server
 * state and the stored-match count. When coatings are off and the in-app setup can fix it,
 * the "Set up coatings" control (the match viewer's `CoatingsSetupControl`) takes a stable
 * row above the ticker and the ticker drops its copy of the notice; otherwise the notice
 * sits in the ticker as before. While the server's first-start work runs (coatings, announcer,
 * weapons, armor, first-person arms), the "Getting ready" plate (`FirstRunPanel`) shows its
 * progress; the coatings control then shows only its button for a failed setup.
 *
 * The page's backdrop is the ring-world art (RingBackdrop), not the featured map, which
 * stays in the featured card.
 *
 * Signed out, the home is a sign-in page: one plate saying what signing in does, wired to the
 * match select page's device-code flow (SIGN_IN_ROUTE); a read-only server never signs in,
 * so it keeps the desk with the Watch list (homeMode).
 *
 * The featured match is the most recently played stored match; the pure picks and
 * formatting live in `homeScreenModel.ts`. There is no match-select page yet, so every
 * menu row goes to the match list (`#/matches`), where the account panel and the stored
 * list live.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchMatches, type MatchSummary } from '../lib/api/standalone'
import { CoatingsSetupControl } from './CoatingsSetupControl'
import { FirstRunPanel } from './FirstRunPanel'
import { useFirstRunProgress } from './useFirstRunProgress'
import { FocusList } from '../ui/FocusList'
import { Plate } from '../ui/Plate'
import { RingBackdrop } from '../ui/RingBackdrop'
import { Screen } from '../ui/Screen'
import { TickerDot } from '../ui/Ticker'
import { useAuthState } from './useAuthState'
import { useCoatingsNotice } from './useCoatingsNotice'
import {
  featuredFacts,
  featuredMatch,
  homeMenu,
  homeMode,
  SIGN_IN_ROUTE,
  tickerItems,
  type FeaturedFacts,
} from './homeScreenModel'

type MatchesState =
  | { phase: 'loading' }
  | { phase: 'unreachable' }
  | { phase: 'ready'; matches: MatchSummary[] }

const SERVER_LABEL: Record<MatchesState['phase'], string> = {
  loading: 'Connecting to server',
  unreachable: 'Server not reachable',
  ready: 'Server connected',
}

function navigate(path: string): void {
  window.location.hash = path
}

export function HomeScreen() {
  const [state, setState] = useState<MatchesState>({ phase: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const matches = await fetchMatches(controller.signal)
        if (controller.signal.aborted) return
        setState({ phase: 'ready', matches })
      } catch {
        if (controller.signal.aborted) return
        setState({ phase: 'unreachable' })
      }
    })()
    return () => controller.abort()
  }, [])

  const auth = useAuthState()
  const coatings = useCoatingsNotice()
  const firstRun = useFirstRunProgress()
  const signedIn = auth.phase.phase === 'signed_in'
  const gamertag = auth.phase.phase === 'signed_in' ? auth.phase.gamertag : null

  const mode = homeMode(auth.phase.phase, auth.readOnly)
  const menu = useMemo(() => homeMenu(signedIn, auth.readOnly), [signedIn, auth.readOnly])
  const onMenuSelect = useCallback((index: number) => {
    const item = menu[index]
    if (item) navigate(item.route)
  }, [menu])

  const onSignIn = useCallback(() => navigate(SIGN_IN_ROUTE), [])

  const matches = state.phase === 'ready' ? state.matches : []
  const featured = featuredMatch(matches)
  const featuredId = featured?.matchId
  const onWatch = useCallback(() => {
    if (featuredId) navigate(`/matches/${encodeURIComponent(featuredId)}`)
  }, [featuredId])
  const facts: FeaturedFacts | null = featured ? featuredFacts(featured) : null
  const backdropUrl = featured?.mapImageUrl ?? null

  // With the "Set up coatings" control showing, the ticker drops its copy of the notice
  // (the control carries the same text next to its button).
  const tickerText = tickerItems(matches.length, coatings.notice, coatings.canSetUp)

  return (
    <Screen
      id="home"
      gamertag={gamertag}
      onSignIn={onSignIn}
      backdropUrl={null}
      items={[
        <span key="server">
          <TickerDot bad={state.phase !== 'ready'} />
          {SERVER_LABEL[state.phase]}
        </span>,
        ...tickerText.map((text) => <span key={text}>{text}</span>),
      ]}
      keys={[['Up/Down', 'Move'], ['Enter', 'Select']]}
    >
      <RingBackdrop />
      <div className="bc-home">
        {mode === 'signin' && (
          <div className="bc-home-signin">
            <Plate eyebrow="Welcome" title="Sign in">
              <p className="bc-home-signin-text">
                Signing in lets the app fetch your own matches from your Xbox account. The app never sees your password.
              </p>
              <button type="button" className="bc-cta" onClick={onSignIn}>
                Sign in with Xbox
              </button>
            </Plate>
          </div>
        )}
        {mode === 'desk' && (
          <>
            <div>
              <img className="bc-home-logo" src="/installation-08-wordmark.png" alt="Installation 08" />
              <div className="bc-eyebrow">Main menu</div>
              <div className="bc-menu">
                <FocusList
                  items={menu.map((m) => ({ name: m.name, sub: m.sub }))}
                  onSelect={onMenuSelect}
                />
              </div>
            </div>
            <div className="bc-feature">
              {featured ? (
                <>
                  <div
                    className="bc-shot"
                    style={backdropUrl ? { backgroundImage: `url("${backdropUrl}")` } : undefined}
                  />
                  <Plate eyebrow="Featured game" title={facts?.mapName ?? ''}>
                    <div className="bc-facts">
                      {facts?.facts.map((f) => (
                        <div className="bc-fact" key={f.label}>
                          <span>{f.label}</span>
                          <b>{f.value}</b>
                        </div>
                      ))}
                    </div>
                    <button type="button" className="bc-cta" onClick={onWatch}>
                      &#9654; Watch
                    </button>
                  </Plate>
                </>
              ) : (
                <Plate eyebrow="Featured game" title="No matches yet">
                  {signedIn && (
                    <div className="bc-facts">
                      <div className="bc-fact">
                        <span>Step 1</span>
                        <b>Fetch a match</b>
                      </div>
                      <div className="bc-fact">
                        <span>Step 2</span>
                        <b>Watch</b>
                      </div>
                    </div>
                  )}
                </Plate>
              )}
            </div>
          </>
        )}
        <FirstRunPanel view={firstRun.view} />
        {coatings.notice && coatings.canSetUp && (
          <div className="bc-coatings">
            <CoatingsSetupControl notice={coatings.notice} showProgress={false} onStarted={firstRun.refresh} />
          </div>
        )}
      </div>
    </Screen>
  )
}
