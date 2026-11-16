/**
 * MatchSelectScreen — the match select page (docs/UI-DESIGN.md 4.2, brief 124): one list of
 * rows on the left (the stored matches and, when signed in, the account's recent matches not
 * stored yet), the focused row's map image and caption plate on the right, and the backdrop
 * following the focused row. Tabs above the list filter it; Enter opens a stored match or
 * starts a fetch of a recent one (the row turns into a stored row when it is ready); Escape
 * goes home. The sign-in flow is a plate over the page (brief 124, item 6). The head carries
 * the texture-quality toggle (`TextureQualityToggle`), the same stored preference the player's
 * settings drawer sets.
 *
 * The data flow is the one `MatchListScreen` had, unchanged: `fetchMatches` for the stored
 * list, `useAuthState`, `useRemoteMatches` and `useMatchFetchQueue` for the account's side.
 * The pure logic (merge, tabs, rows, preview, fetch labels) lives in `matchSelectModel.ts`.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'

import { fetchMatches, type MatchSummary } from '../lib/api/standalone'
import { FocusList } from '../ui/FocusList'
import { Plate } from '../ui/Plate'
import { Screen } from '../ui/Screen'
import { TickerDot } from '../ui/Ticker'
import {
  cleanMapName,
  fetchStateLabel,
  formatDuration,
  formatPlayedAt,
  filterByTab,
  indexOfRow,
  mergeMatchRows,
  previewOf,
  storedAside,
  visibleTabs,
  type MatchRow,
  type MatchTab,
} from './matchSelectModel'
import { listCaption, loadSavedGamertag, normalizeGamertag, saveGamertag, searchedRows } from './gamertagSearch'
import { SignInPlate } from './SignInPlate'
import { TextureQualityToggle } from './TextureQualityToggle'
import { useAuthState } from './useAuthState'
import { useMatchFetchQueue } from './useMatchFetchQueue'
import { useRemoteMatches } from './useRemoteMatches'

/** The stored-match list, as today: loading, unreachable (with the server's message) or ready. */
type MatchesState =
  | { phase: 'loading' }
  | { phase: 'unreachable'; message: string }
  | { phase: 'ready'; matches: MatchSummary[] }

function navigate(path: string): void {
  window.location.hash = path
}

/** The one list's rows as FocusList items: the row's text and its right side (the score, or
 *  the fetch state for a not-stored row). */
function listItemOf(
  row: MatchRow,
  phaseOf: (matchId: string) => import('./useMatchFetchQueue').FetchRowPhase,
): { id: string; name: string; sub: string; aside: ReactNode } {
  if (row.kind === 'stored') {
    const m = row.match
    const name = cleanMapName(m.mapName || m.mapModule || m.matchId)
    const sub = [m.modeName, formatPlayedAt(m.startTime ?? m.importedAt), formatDuration(m.durationMs)]
      .filter(Boolean)
      .join(' · ')
    const aside = storedAside(m)
    return {
      id: m.matchId,
      name,
      sub,
      aside: aside ? (
        <div className="bc-result">
          <span className="bc-result-score">{aside.score}</span>
          {aside.result ? (
            <small className={m.outcome === 'win' ? 'bc-result-win' : 'bc-result-loss'}>
              {aside.result}
            </small>
          ) : (
            <small>&nbsp;</small>
          )}
        </div>
      ) : undefined,
    }
  }
  const m = row.match
  const name = cleanMapName(m.map || m.id)
  const sub = [m.mode, formatPlayedAt(m.time)].filter(Boolean).join(' · ')
  return { id: m.id, name, sub, aside: <div className="bc-fetch-state">{fetchStateLabel(phaseOf(m.id))}</div> }
}

/** The right-hand preview: the map image sharp in the frame, the plate under it. A row with
 *  no image leaves the frame empty and shows the map name in it (never a broken image). */
function Preview({ row, gamertag }: { row: MatchRow; gamertag: string | null }) {
  const preview = previewOf(row, gamertag)
  return (
    <div className="bc-preview">
      <div
        className="bc-shot"
        style={preview.imageUrl ? { backgroundImage: `url("${preview.imageUrl}")` } : undefined}
      >
        {preview.imageUrl ? null : <div className="bc-shot-fallback">{preview.title}</div>}
      </div>
      <Plate eyebrow={preview.eyebrow ?? undefined} title={preview.title} as="h2">
        {preview.facts.length > 0 ? (
          <div className="bc-facts">
            {preview.facts.map((f) => (
              <div className="bc-fact" key={f.label}>
                <span>{f.label}</span>
                <b>{f.value}</b>
              </div>
            ))}
          </div>
        ) : null}
        {preview.rosters.length > 0 ? (
          <div className="bc-rosters">
            {preview.rosters.map((team, i) => (
              <div key={team.title} className={i === 0 ? 'bc-ally' : 'bc-enemy'}>
                <h4>{team.title}</h4>
                {team.names.map((name, j) => (
                  <div key={`${name}-${j}`}>{name}</div>
                ))}
              </div>
            ))}
          </div>
        ) : null}
        {preview.note ? <p className="bc-note">{preview.note}</p> : null}
      </Plate>
    </div>
  )
}

export function MatchSelectScreen() {
  const [matches, setMatches] = useState<MatchesState>({ phase: 'loading' })
  const [tab, setTab] = useState<MatchTab>('All')
  // The row the list must keep focused; null is "the first row".
  const [focusId, setFocusId] = useState<string | null>(null)

  const loadMatches = useCallback((signal: AbortSignal) => {
    setMatches({ phase: 'loading' })
    void (async () => {
      try {
        const list = await fetchMatches(signal)
        if (signal.aborted) return
        setMatches({ phase: 'ready', matches: list })
      } catch (err) {
        if (signal.aborted) return
        setMatches({
          phase: 'unreachable',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    })()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    loadMatches(controller.signal)
    return () => controller.abort()
  }, [loadMatches])

  const auth = useAuthState()
  const authPhase = auth.phase
  const signedIn = authPhase.phase === 'signed_in'
  const gamertag = signedIn ? authPhase.gamertag : null
  // Home's "Sign in" row and top bar button land here with ?signin=1: open the plate. The
  // hook's `login` is a no-op while a sign-in is already pending, so firing it again once
  // the state settles covers a state that had answered before this page mounted.
  useEffect(() => {
    if (window.location.hash.includes('signin=1')) auth.login()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authPhase.phase])

  // The gamertag search: the input's text (prefilled with the last search) and the gamertag
  // whose matches the list shows (null: the account's own, the default on every visit).
  const [gamertagDraft, setGamertagDraft] = useState(loadSavedGamertag)
  const [searched, setSearched] = useState<string | null>(null)
  const [searchHint, setSearchHint] = useState<string | null>(null)

  const remote = useRemoteMatches(signedIn, searched)

  const onSearch = useCallback(
    (event: FormEvent) => {
      event.preventDefault()
      const gt = normalizeGamertag(gamertagDraft)
      if (!gt) {
        setSearchHint('Enter a gamertag: up to 16 letters, digits, spaces or #.')
        return
      }
      setSearchHint(null)
      setGamertagDraft(gt)
      saveGamertag(gt)
      setFocusId(null)
      setTab('All')
      // The same gamertag again reloads it; a new one reloads through the hook.
      if (gt === searched) remote.refresh()
      else setSearched(gt)
      // Hand the keyboard back to the list (Up/Down, Enter to fetch).
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    },
    [gamertagDraft, searched, remote],
  )

  const onClearSearch = useCallback(() => {
    setGamertagDraft('')
    setSearchHint(null)
    saveGamertag(null)
    setFocusId(null)
    setSearched(null)
  }, [])

  const onSearchKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') event.currentTarget.blur()
  }, [])

  const onFetchReady = useCallback(() => {
    remote.refresh()
    const controller = new AbortController()
    loadMatches(controller.signal)
  }, [remote, loadMatches])
  const fetchQueue = useMatchFetchQueue(onFetchReady)

  // The list's rows and the focused row, from the model.
  const stored = matches.phase === 'ready' ? matches.matches : []
  // The remote state counts only when it answers for the list being asked for (the first
  // render after a new search still holds the previous answer).
  const remoteState = remote.loadedFor === searched ? remote.state : ({ phase: 'loading' } as const)
  const remoteMatches = remoteState.phase === 'ready' ? remoteState.matches : []
  // A gamertag search lists that player's matches only; the default merges the stored
  // library with the account's own recent matches.
  const rows = searched
    ? searchedRows(stored, remoteMatches, remote.localIds)
    : mergeMatchRows(stored, remoteMatches, remote.localIds)
  const filtered = filterByTab(rows, tab, signedIn)
  const tabs = visibleTabs(signedIn)
  const focusIndex = indexOfRow(filtered, focusId)
  const focused = filtered[focusIndex]
  const onFocusChange = useCallback(
    (i: number) => {
      const row = filtered[i]
      if (row) setFocusId(row.id)
    },
    [filtered],
  )
  const backdropUrl = focused ? previewOf(focused, gamertag).imageUrl : null

  // When a fetch becomes ready its row leaves the not-stored side: keep the focus on it,
  // on the (now stored) row, and switch off the Recent tab (the row is not recent any more).
  const readyRef = useRef<string | null>(null)
  useEffect(() => {
    const ready = readyRef.current
    if (ready === null) return
    readyRef.current = null
    if (rows.some((r) => r.id === ready)) {
      setFocusId(ready)
      setTab((t) => (t === 'Recent' ? 'All' : t))
    }
  }, [rows])

  const onMenuSelect = useCallback(
    (index: number) => {
      const row = filtered[index]
      if (!row) return
      if (row.kind === 'stored') {
        // From another player's list, the match opens following that player.
        const player = searched ? `?player=${encodeURIComponent(searched)}` : ''
        navigate(`/matches/${encodeURIComponent(row.id)}${player}`)
      } else {
        readyRef.current = row.id
        fetchQueue.start(row.id)
      }
    },
    [filtered, fetchQueue],
  )

  const onSignIn = useCallback(() => {
    auth.login()
  }, [auth])

  const onBack = useCallback(() => navigate('/'), [])
  const onSignOut = useCallback(() => {
    auth.logout()
  }, [auth])

  const ticker = [
    <span key="server">
      <TickerDot bad={matches.phase !== 'ready'} />
      {matches.phase === 'loading'
        ? 'Connecting to server'
        : matches.phase === 'unreachable'
          ? 'Server not reachable'
          : `${stored.length} match${stored.length === 1 ? '' : 'es'} stored`}
    </span>,
  ]
  const recentLabel = searched ? listCaption(searched) : 'recent matches'
  if (remoteState.phase === 'loading') ticker.push(<span key="recent">Loading {recentLabel}…</span>)
  if (remoteState.phase === 'error') {
    ticker.push(<span key="recent">Could not load {recentLabel}: {remoteState.message}</span>)
  }

  // What the list area shows while a search runs: its own loading, error and empty states
  // (the list is that player's matches alone, so it waits on them).
  const searchStatus: ReactNode =
    searched === null ? null : remoteState.phase === 'loading' || remoteState.phase === 'idle' ? (
      <div className="bc-empty">Loading {listCaption(searched)}…</div>
    ) : remoteState.phase === 'error' ? (
      <div className="bc-empty bc-empty-bad">{remoteState.message}</div>
    ) : filtered.length === 0 ? (
      <div className="bc-empty">No recent matches for {searched} in this list.</div>
    ) : null

  const keys = (
    [
      ['Up/Down', 'Move'],
      ['Left/Right', 'Tab'],
      ['Enter', focused?.kind === 'stored' ? 'Watch' : 'Fetch'],
      ['Esc', 'Back'],
    ] as [string, string][]
  )

  return (
    <Screen
      id="select"
      gamertag={gamertag}
      onSignIn={onSignIn}
      backdropUrl={backdropUrl}
      items={ticker}
      keys={keys}
    >
      <div className="bc-select">
        <div className="bc-select-head">
          <div>
            <div className="bc-eyebrow">Select a match</div>
            <h1 className="bc-title">Match library</h1>
          </div>
          <div className="bc-tabs" role="tablist">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={t === tab}
                className={'bc-tab' + (t === tab ? ' on' : '')}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <TextureQualityToggle />
          {gamertag ? (
            <button type="button" className="bc-signout" onClick={onSignOut}>
              Sign out
            </button>
          ) : null}
        </div>

        <div className={'bc-list-wrap' + (signedIn ? ' bc-has-search' : '')}>
          {signedIn ? (
            <div className="bc-list-head">
              <form className="bc-gt-search" role="search" onSubmit={onSearch}>
                <div className="bc-gt-field">
                  <input
                    className="bc-gt-input"
                    type="text"
                    value={gamertagDraft}
                    onChange={(e) => setGamertagDraft(e.target.value)}
                    onKeyDown={onSearchKeyDown}
                    placeholder="Any player's gamertag"
                    aria-label="Gamertag"
                    maxLength={32}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  {gamertagDraft || searched ? (
                    <button
                      type="button"
                      className="bc-gt-clear"
                      aria-label="Back to my matches"
                      title="Back to my matches"
                      onClick={onClearSearch}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
                <button type="submit" className="bc-gt-submit">
                  Search
                </button>
              </form>
              {searchHint ? <div className="bc-gt-hint">{searchHint}</div> : null}
              <div className="bc-eyebrow bc-list-caption">{listCaption(searched)}</div>
            </div>
          ) : null}
          <div className="bc-list-body">
            {matches.phase === 'loading' && <div className="bc-empty">Loading matches…</div>}
            {matches.phase === 'unreachable' && (
              <div className="bc-empty bc-empty-bad">
                Could not reach the server: {matches.message}
                <br />
                Is `it3d.exe serve` running on 127.0.0.1:8177?
              </div>
            )}
            {matches.phase === 'ready' && searchStatus}
            {matches.phase === 'ready' && searched === null && filtered.length === 0 && (
              <div className="bc-empty">
                {signedIn ? (
                  <div>No matches in this list.</div>
                ) : (
                  <div>
                    No matches yet.
                    <br />
                    Sign in, fetch a match, then watch it.
                  </div>
                )}
              </div>
            )}
            {matches.phase === 'ready' && searchStatus === null && filtered.length > 0 && (
              <FocusList
                className="bc-select-list"
                items={filtered.map((r) => listItemOf(r, fetchQueue.phaseOf))}
                onSelect={onMenuSelect}
                onBack={onBack}
                index={focusIndex}
                onIndexChange={onFocusChange}
              />
            )}
          </div>
        </div>

        {matches.phase === 'ready' && searchStatus === null && focused ? (
          <Preview row={focused} gamertag={gamertag} />
        ) : null}
      </div>

      {authPhase.phase === 'pending' ? (
        <SignInPlate phase={authPhase} onCancel={auth.logout} />
      ) : null}
    </Screen>
  )
}
