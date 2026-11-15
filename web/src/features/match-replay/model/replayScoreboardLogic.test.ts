import type { MatchScoreboardRow } from '@/lib/api/types'
import { testReplayDoc } from '../test/testDoc'
import { modeStatOf, readReplayScoreboard } from './replayScoreboardLogic'

/** A scoreboard sheet row, with only the fields the model reads. */
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

/** A score series: the steps of `total`, and empty round-by-round. */
function series(total: { t: number; v: number }[]) {
  return { rounds: [], total }
}

/**
 * A team-mode document: two camps (A/B on 0, C/D on 1), a team score, and the four player
 * counters stepped mid-match.
 */
function teamDoc() {
  return testReplayDoc({
    roster: [
      { filmIndex: 0, xuid: 'a', name: 'Alpha', team: 0 },
      { filmIndex: 1, xuid: 'b', name: 'Bravo', team: 0 },
      { filmIndex: 2, xuid: 'c', name: 'Charlie', team: 1 },
      { filmIndex: 3, xuid: 'd', name: 'Delta', team: 1 },
    ],
    scoreTimeline: {
      teams: [
        { teamId: 0, rounds: [], total: [{ t: 100, v: 100 }] },
        { teamId: 1, rounds: [], total: [{ t: 150, v: 32 }] },
      ],
      players: [
        { xuid: 'a', score: series([{ t: 100, v: 300 }]), kills: series([{ t: 100, v: 4 }]), deaths: series([{ t: 100, v: 2 }]), assists: series([{ t: 100, v: 3 }]) },
        { xuid: 'b', score: series([{ t: 100, v: 100 }]), kills: series([{ t: 100, v: 2 }]), deaths: series([{ t: 100, v: 4 }]), assists: series([]) },
        { xuid: 'c', score: series([{ t: 100, v: 200 }]), kills: series([{ t: 100, v: 3 }]), deaths: series([{ t: 100, v: 1 }]), assists: series([]) },
        { xuid: 'd', score: series([{ t: 100, v: 50 }]), kills: series([{ t: 100, v: 1 }]), deaths: series([{ t: 100, v: 3 }]), assists: series([]) },
      ],
    },
  })
}

const sheet: MatchScoreboardRow[] = [
  row({ xuid: 'a', gamertag: 'Alpha', team_side: 't0' }),
  row({ xuid: 'b', gamertag: 'Bravo', team_side: 't0' }),
  row({ xuid: 'c', gamertag: 'Charlie', team_side: 't1' }),
  row({ xuid: 'd', gamertag: 'Delta', team_side: 't1' }),
]

it('reads nothing at a frame before the first published step', () => {
  const reading = readReplayScoreboard(teamDoc(), sheet, 50)
  expect(reading).not.toBeNull()
  if (!reading) return
  expect(reading.ffa).toBe(false)
  expect(reading.teams.map((t) => t.score)).toEqual([0, 0])
  const a = reading.teams[0].players.find((p) => p.xuid === 'a')
  expect(a?.counters).toEqual({ score: 0, kills: 0, deaths: 0, assists: 0 })
})

it('reads the team score and the per-player counters at a mid-match frame', () => {
  const reading = readReplayScoreboard(teamDoc(), sheet, 150)
  expect(reading).not.toBeNull()
  if (!reading) return
  expect(reading.teams.map((t) => t.score)).toEqual([100, 32])
  const a = reading.teams[0].players.find((p) => p.xuid === 'a')
  expect(a?.counters).toEqual({ score: 300, kills: 4, deaths: 2, assists: 3 })
  expect(a?.name).toBe('Alpha')
})

it('keeps the last step held at the final frame', () => {
  const reading = readReplayScoreboard(teamDoc(), sheet, 199)
  expect(reading).not.toBeNull()
  if (!reading) return
  expect(reading.teams.map((t) => t.score)).toEqual([100, 32])
  const a = reading.teams[0].players.find((p) => p.xuid === 'a')
  expect(a?.counters?.kills).toBe(4)
})

it('orders a team by score descending when the film records score', () => {
  const reading = readReplayScoreboard(teamDoc(), sheet, 150)
  expect(reading).not.toBeNull()
  if (!reading) return
  expect(reading.teams[0].players.map((p) => p.xuid)).toEqual(['a', 'b'])
  // 3 kills on C, 1 on D: C first.
  expect(reading.teams[1].players.map((p) => p.xuid)).toEqual(['c', 'd'])
})

it('reads a camp that never scored as 0 (a measure, not a gap)', () => {
  const doc = teamDoc()
  doc.scoreTimeline!.teams = [{ teamId: 0, rounds: [], total: [{ t: 100, v: 100 }] }]
  const reading = readReplayScoreboard(doc, sheet, 199)
  expect(reading).not.toBeNull()
  expect(reading?.teams.map((t) => t.score)).toEqual([100, 0])
})

it('renders one list for free-for-all, not teams', () => {
  const doc = testReplayDoc({
    roster: [
      { filmIndex: 0, xuid: 'a', name: 'Alpha', team: -1 },
      { filmIndex: 1, xuid: 'b', name: 'Bravo', team: -1 },
    ],
    scoreTimeline: {
      teams: [],
      players: [
        { xuid: 'a', score: series([]), kills: series([{ t: 100, v: 2 }]), deaths: series([]), assists: series([]) },
        { xuid: 'b', score: series([]), kills: series([]), deaths: series([]), assists: series([]) },
      ],
    },
  })
  const reading = readReplayScoreboard(doc, [row({ xuid: 'a' }), row({ xuid: 'b' })], 150)
  expect(reading).not.toBeNull()
  if (!reading) return
  expect(reading.ffa).toBe(true)
  expect(reading.teams).toEqual([])
  expect(reading.players.map((p) => p.xuid)).toEqual(['a', 'b'])
})

it('hides the assists column when the film records none', () => {
  const doc = testReplayDoc({
    roster: [
      { filmIndex: 0, xuid: 'a', name: 'Alpha', team: 0 },
      { filmIndex: 1, xuid: 'b', name: 'Bravo', team: 1 },
    ],
    scoreTimeline: {
      teams: [
        { teamId: 0, rounds: [], total: [] },
        { teamId: 1, rounds: [], total: [] },
      ],
      players: [
        { xuid: 'a', score: series([]), kills: series([{ t: 100, v: 1 }]), deaths: series([]), assists: series([]) },
        { xuid: 'b', score: series([]), kills: series([]), deaths: series([]), assists: series([]) },
      ],
    },
  })
  const reading = readReplayScoreboard(doc, [row({ xuid: 'a' }), row({ xuid: 'b' })], 150)
  expect(reading).not.toBeNull()
  expect(reading?.hasAssists).toBe(false)
})

it('shows the assists column when the film records any assist', () => {
  const doc = teamDoc()
  doc.scoreTimeline!.players[1]!.assists.total = [{ t: 150, v: 1 }]
  const reading = readReplayScoreboard(doc, sheet, 199)
  expect(reading?.hasAssists).toBe(true)
})

it('returns null when the document carries no score timeline', () => {
  const doc = testReplayDoc({ roster: [{ filmIndex: 0, xuid: 'a', name: 'Alpha', team: 0 }] })
  expect(readReplayScoreboard(doc, [], 0)).toBeNull()
})

it('returns null when the film clock is not trusted', () => {
  const doc = testReplayDoc({
    ...teamDoc(),
    coverage: { originResolved: false } as never,
  })
  expect(readReplayScoreboard(doc, sheet, 150)).toBeNull()
})

it('leaves a player the film does not publish at null, never zeros', () => {
  const doc = teamDoc()
  doc.scoreTimeline!.players = doc.scoreTimeline!.players.filter((p) => p.xuid !== 'd')
  const reading = readReplayScoreboard(doc, sheet, 150)
  expect(reading).not.toBeNull()
  const d = reading?.teams[1].players.find((p) => p.xuid === 'd')
  expect(d?.counters).toBeNull()
})

it('orders by kills, then deaths, when the film records no score', () => {
  const doc = teamDoc()
  for (const p of doc.scoreTimeline!.players) p.score.total = []
  doc.scoreTimeline!.players[1]!.kills.total = [{ t: 100, v: 9 }]
  const reading = readReplayScoreboard(doc, sheet, 150)
  expect(reading?.hasScore).toBe(false)
  expect(reading?.teams[0].players.map((p) => p.xuid)).toEqual(['b', 'a'])
})

it('ranks by score over kills', () => {
  const doc = teamDoc()
  // B: fewer kills (2) but more score than A once B scores 500.
  doc.scoreTimeline!.players[1]!.score.total = [{ t: 100, v: 500 }]
  const reading = readReplayScoreboard(doc, sheet, 150)
  expect(reading?.hasScore).toBe(true)
  expect(reading?.teams[0].players.map((p) => p.xuid)).toEqual(['b', 'a'])
  expect(reading?.teams[0].players[0]?.counters?.score).toBe(500)
})

it('adds no mode column for a sheet without objective stats', () => {
  const reading = readReplayScoreboard(teamDoc(), sheet, 150)
  expect(reading?.modeStat).toBeNull()
  expect(reading?.teams[0].players.every((p) => p.modeValue === null)).toBe(true)
})

it('reads CTF captures from the sheet as match totals, null for a player without one', () => {
  const ctf = sheet.map((r) => (r.xuid === 'd' ? r : { ...r, objective: { flag_captures: r.xuid === 'a' ? 2 : 0, flag_grabs: 5 } }))
  const reading = readReplayScoreboard(teamDoc(), ctf, 50)
  expect(reading?.modeStat).toEqual({ kind: 'captures', label: 'Caps', seconds: false })
  const value = (xuid: string) => reading?.teams.flatMap((t) => t.players).find((p) => p.xuid === xuid)?.modeValue
  expect(value('a')).toBe(2)
  expect(value('b')).toBe(0)
  expect(value('d')).toBeNull()
})

it('picks ball time in Oddball and hill time in zone modes', () => {
  expect(modeStatOf([row({ xuid: 'a', objective: { time_as_skull_carrier_seconds: 83.4, skull_grabs: 3 } })])?.stat)
    .toEqual({ kind: 'ballTime', label: 'Ball time', seconds: true })
  const zones = modeStatOf([row({ xuid: 'a', objective: { time_in_zones_seconds: 83.4, zone_captures: 0 } })])
  expect(zones?.stat).toEqual({ kind: 'zoneTime', label: 'Hill time', seconds: true })
  expect(zones?.valueOf('a')).toBe(83.4)
  expect(modeStatOf([row({ xuid: 'a', objective: { vip_kills: 2 } })])).toBeNull()
})