import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MatchScoreboardRow } from '../lib/api/types'
import { testReplayDoc } from '../features/match-replay/test/testDoc'
import { ReplayViewer } from './MatchViewScreen'

vi.mock('../features/match-replay/ui/Replay3DView', () => ({ Replay3DView: () => <div>3D view</div> }))
vi.mock('./useVariantLayer', () => ({ useVariantLayer: () => null }))
vi.mock('./useMatchSummary', () => ({ useMatchSummary: () => null, useRemoteMatch: () => null }))
vi.mock('../features/match-replay/sound/useReplaySound', () => ({ useReplaySound: () => ({ available: false, setTransportPlaying: vi.fn(), seek: vi.fn(), wake: vi.fn(), intro: vi.fn() }) }))

// The match context is per-test: each test sets `contextValue` before mounting.
const contextValue = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('./useMatchReplayContext', () => ({
  useMatchReplayContext: () => ({ kills: [], medals: [], context: contextValue.value, playWindow: null, timeLimitMs: null }),
}))

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => {
  contextValue.value = null
  vi.unstubAllGlobals()
})

function row(over: Partial<MatchScoreboardRow> & { xuid: string }): MatchScoreboardRow {
  return {
    gamertag: over.xuid,
    team_side: null,
    rank: null,
    score: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    shots_fired: 0,
    shots_hit: 0,
    accuracy: 0,
    damage_dealt: 0,
    damage_taken: 0,
    average_life: null,
    headshot_kills: 0,
    max_killing_spree: 0,
    perfect_kills: 0,
    power_weapon_kills: 0,
    melee_kills: 0,
    is_me: false,
    ...over,
  }
}

function series(total: { t: number; v: number }[]) {
  return { rounds: [], total }
}

/**
 * A film that scores at frame 100: 100-40 on the team totals, 3 kills for Alpha. The
 * viewer opens at frame 0, where every counter is 0 — which is exactly the "never show a
 * final-only value as live" check.
 */
const scoreboardDoc = () =>
  testReplayDoc({
    roster: [
      { filmIndex: 0, xuid: 'a', name: 'Alpha', team: 0 },
      { filmIndex: 1, xuid: 'b', name: 'Bravo', team: 1 },
    ],
    scoreTimeline: {
      teams: [
        { teamId: 0, rounds: [], total: [{ t: 100, v: 100 }] },
        { teamId: 1, rounds: [], total: [{ t: 100, v: 40 }] },
      ],
      players: [
        { xuid: 'a', score: series([]), kills: series([{ t: 100, v: 3 }]), deaths: series([]), assists: series([]) },
        { xuid: 'b', score: series([]), kills: series([]), deaths: series([]), assists: series([]) },
      ],
    },
  })

const sheet: MatchScoreboardRow[] = [
  row({ xuid: 'a', gamertag: 'Alpha', team_side: 't0' }),
  row({ xuid: 'b', gamertag: 'Bravo', team_side: 't1' }),
]

function renderViewer(withSheet: boolean) {
  contextValue.value = withSheet
    ? {
        header: { t0_ms: 0 },
        scoreboard: sheet,
        highlight_events: [],
        media: { media_items: [] },
        source_unavailable: false,
      }
    : null
  return render(<ReplayViewer matchId="test" doc={scoreboardDoc()} onBack={vi.fn()} />)
}

it('renders no scoreboard by default', () => {
  renderViewer(true)
  expect(screen.queryByTestId('replay-scoreboard')).toBeNull()
})

it('shows the scoreboard while Tab is held and hides it on release', () => {
  renderViewer(true)
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
  })
  const overlay = screen.getByTestId('replay-scoreboard')
  // At the current frame (0) the film has not scored yet: the counters read 0, and the
  // final values (3 kills, 100-40) are NOT shown as live.
  expect(overlay).not.toHaveTextContent('3')
  expect(overlay).not.toHaveTextContent('100')
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab' }))
  })
  expect(screen.queryByTestId('replay-scoreboard')).toBeNull()
})

it('toggles the scoreboard with the Scoreboard button', () => {
  renderViewer(true)
  const button = screen.getByRole('button', { name: 'Scoreboard' })
  expect(button).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(button)
  expect(screen.getByTestId('replay-scoreboard')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Scoreboard' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(button)
  expect(screen.queryByTestId('replay-scoreboard')).toBeNull()
})

it('highlights the followed player', () => {
  renderViewer(true)
  fireEvent.click(screen.getByRole('button', { name: 'Scoreboard' }))
  const overlay = screen.getByTestId('replay-scoreboard')
  const followed = overlay.querySelector('td')!
  expect(followed.textContent).toBe('Alpha')
  expect(followed.closest('tr')).toHaveClass('bc-sb-followed')
  const rows = [...overlay.querySelectorAll('tr')]
  const otherRow = rows.find((tr) => tr.textContent?.includes('Bravo'))!
  expect(otherRow).not.toHaveClass('bc-sb-followed')
})

it('draws the teams as columns of one connected panel, each header striped with its team color', () => {
  renderViewer(true)
  fireEvent.click(screen.getByRole('button', { name: 'Scoreboard' }))
  const overlay = screen.getByTestId('replay-scoreboard')
  const panels = overlay.querySelectorAll('.bc-sb')
  expect(panels).toHaveLength(1)
  const teams = panels[0].querySelectorAll('.bc-sb-teams > .bc-sb-team')
  expect(teams).toHaveLength(2)
  expect(teams[0]).toHaveTextContent('Alpha')
  expect(teams[1]).toHaveTextContent('Bravo')
  for (const team of teams) expect((team as HTMLElement).style.getPropertyValue('--bc-sb-team')).not.toBe('')
})

it('renders nothing before the match sheet has loaded', () => {
  renderViewer(false)
  fireEvent.click(screen.getByRole('button', { name: 'Scoreboard' }))
  expect(screen.queryByTestId('replay-scoreboard')).toBeNull()
})

it('adds the Score column and the mode stat, marked as match totals, when the data has them', () => {
  contextValue.value = {
    header: { t0_ms: 0 },
    scoreboard: [
      row({ xuid: 'a', gamertag: 'Alpha', team_side: 't0', objective: { flag_captures: 2 } }),
      row({ xuid: 'b', gamertag: 'Bravo', team_side: 't1', objective: { flag_captures: 0 } }),
    ],
    highlight_events: [],
    media: { media_items: [] },
    source_unavailable: false,
  }
  const doc = scoreboardDoc()
  doc.scoreTimeline!.players[0]!.score = series([{ t: 0, v: 150 }])
  render(<ReplayViewer matchId="test" doc={doc} onBack={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Scoreboard' }))
  const overlay = screen.getByTestId('replay-scoreboard')
  const heads = [...overlay.querySelectorAll('.bc-sb-cols')][0]!
  expect([...heads.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Player', 'Score', 'K', 'D', 'Caps'])
  const alpha = [...overlay.querySelectorAll('tr')].find((tr) => tr.textContent?.includes('Alpha'))!
  expect([...alpha.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['Alpha', '150', '0', '0', '2'])
  expect(overlay).toHaveTextContent('Caps: match totals')
})

it('reads caps live from the film and drops the match-totals note', () => {
  contextValue.value = {
    header: { t0_ms: 0 },
    scoreboard: [
      row({ xuid: 'a', gamertag: 'Alpha', team_side: 't0', objective: { flag_captures: 1 } }),
      row({ xuid: 'b', gamertag: 'Bravo', team_side: 't1', objective: { flag_captures: 0 } }),
    ],
    highlight_events: [],
    media: { media_items: [] },
    source_unavailable: false,
  }
  const doc = scoreboardDoc()
  doc.flagCarries = [
    {
      team: 0,
      spans: [
        { state: 'home', xuid: null, t0: 0, t1: 90, x: 0, y: 0, returnProgress: [] },
        { state: 'carried', xuid: 'a', t0: 90, t1: 100, x: 0, y: 0, returnProgress: [] },
        { state: 'home', xuid: null, t0: 102, t1: 200, x: 0, y: 0, returnProgress: [] },
      ],
    },
  ]
  doc.scoreTimeline!.teams = [
    { teamId: 0, rounds: [], total: [{ t: 102, v: 1 }] },
    { teamId: 1, rounds: [], total: [] },
  ]
  render(<ReplayViewer matchId="test" doc={doc} onBack={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Scoreboard' }))
  const overlay = screen.getByTestId('replay-scoreboard')
  // At the current frame (0) the capture has not happened: caps read live at 0, and the
  // "match totals" note is gone (the final 1-0 is NOT shown as live).
  const alpha = [...overlay.querySelectorAll('tr')].find((tr) => tr.textContent?.includes('Alpha'))!
  expect([...alpha.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['Alpha', '0', '0', '0'])
  expect(overlay).not.toHaveTextContent('match totals')
})