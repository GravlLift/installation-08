// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import { normalizeScoreTimeline, type ReplayScoreTimelineReady } from '@/lib/replay/scoreTimeline'
import { hillHoldFill, readScoreBanner, type ScoreBannerFilm } from './scoreBannerLogic'

// Camp 0 is the watched player's, camp 1 the opponent.
const film = { camps: [{ team: 0 }, { team: 1 }], ofTeam: (t: number | null | undefined) => (t === 0 ? true : t === 1 ? false : null) } as unknown as ScoreBannerFilm

const tick = (t: number, v: number) => ({ t, v })
const steps = (pts: [number, number][]) => pts.map(([t, v]) => tick(t, v))

function timeline(raw: object): ReplayScoreTimelineReady {
  return normalizeScoreTimeline(raw as never)!
}

describe('score bar fill per mode', () => {
  it('Strongholds: score over the published target (points accumulate toward 250)', () => {
    const tl = timeline({
      targetScore: 250,
      teams: [
        { teamId: 0, total: steps([[10, 1], [20, 100], [30, 125]]), rounds: [] },
        { teamId: 1, total: steps([[15, 1], [25, 50]]), rounds: [] },
      ],
    })
    const r = readScoreBanner(tl, film, 30)!
    expect(r.ally).toEqual({ teamId: 0, score: 125, fill: 0.5 })
    expect(r.enemy).toEqual({ teamId: 1, score: 50, fill: 0.2 })
  })

  it('Strongholds without a target (older artifact): the winner final stays the denominator', () => {
    const tl = timeline({
      teams: [
        { teamId: 0, total: steps([[10, 125], [40, 250]]), rounds: [] },
        { teamId: 1, total: steps([[10, 50]]), rounds: [] },
      ],
    })
    const r = readScoreBanner(tl, film, 10)!
    expect(r.ally.fill).toBe(0.5)
    expect(r.enemy.fill).toBe(0.2)
  })

  it('King of the Hill without the hold series (older artifact): hills over the target, as before', () => {
    const tl = timeline({
      targetScore: 4,
      teams: [
        { teamId: 0, total: steps([[100, 1]]), rounds: [] },
        { teamId: 1, total: [], rounds: [] },
      ],
    })
    const r = readScoreBanner(tl, film, 150)!
    expect(r.ally).toEqual({ teamId: 0, score: 1, fill: 0.25 })
    expect(r.enemy).toEqual({ teamId: 1, score: 0, fill: 0 })
  })

  // Hold ticks per camp, cumulative; 4 ticks are worth a hill. Camp 0 scores at frame 100
  // after 4 ticks (camp 1 took 1 on that hill), then camp 1 holds the next hill for 2 ticks.
  const koth = () =>
    timeline({
      targetScore: 4,
      holdTicksPerPoint: 4,
      holdTicks: [
        { teamId: 0, ticks: steps([[40, 1], [50, 2], [60, 3], [100, 4], [130, 5]]) },
        { teamId: 1, ticks: steps([[70, 1], [110, 2], [120, 3]]) },
      ],
      teams: [
        { teamId: 0, total: steps([[100, 1]]), rounds: [] },
        { teamId: 1, total: [], rounds: [] },
      ],
    })

  it('King of the Hill: the bar is the current hill hold progress, the number the hills scored', () => {
    const tl = koth()
    let r = readScoreBanner(tl, film, 70)!
    expect(r.ally).toEqual({ teamId: 0, score: 0, fill: 0.75 })
    expect(r.enemy).toEqual({ teamId: 1, score: 0, fill: 0.25 })
    // On the point frame the hill is scored and both bars restart from zero.
    r = readScoreBanner(tl, film, 100)!
    expect(r.ally).toEqual({ teamId: 0, score: 1, fill: 0 })
    expect(r.enemy.fill).toBe(0)
    // Next hill: camp 1 holds two ticks, camp 0 one.
    r = readScoreBanner(tl, film, 130)!
    expect(r.ally).toEqual({ teamId: 0, score: 1, fill: 0.25 })
    expect(r.enemy).toEqual({ teamId: 1, score: 0, fill: 0.5 })
  })

  it('hillHoldFill: nothing before the first tick, a camp without series is empty, never above full', () => {
    const tl = koth()
    expect(hillHoldFill(tl, 0, 10)).toBe(0)
    expect(hillHoldFill(tl, 7, 130)).toBe(0)
    const over = timeline({ holdTicksPerPoint: 2, holdTicks: [{ teamId: 0, ticks: steps([[1, 5]]) }], teams: [{ teamId: 0, total: [], rounds: [] }] })
    expect(hillHoldFill(over, 0, 5)).toBe(1)
  })

  it('a hold series without its threshold is ignored: the score reading stays', () => {
    const tl = timeline({
      targetScore: 4,
      holdTicks: [{ teamId: 0, ticks: steps([[40, 3]]) }],
      teams: [{ teamId: 0, total: steps([[100, 2]]), rounds: [] }, { teamId: 1, total: [], rounds: [] }],
    })
    expect(readScoreBanner(tl, film, 100)!.ally.fill).toBe(0.5)
  })
})
