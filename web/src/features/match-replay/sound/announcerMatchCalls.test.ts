// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * announcerMatchCalls.test.ts — the calls about the match itself: the mode at kickoff, exactly the
 * game's time warnings on the HUD's clock, overtime at the end of regulation, the lost lead.
 */
import { describe, expect, it } from 'vitest'

import { testReplayDoc } from '../test/testDoc'
import { announcerMatchCalls, lostLeadCalls, modeCallKey, type AnnouncerMatch } from './announcerMatchCalls'

const gameplay = { startMs: 10_000, endMs: 10_000 + 12 * 60_000 }
const match = (over: Partial<AnnouncerMatch> = {}): AnnouncerMatch => ({
  mode: 'Slayer',
  timeLimitMs: 10 * 60_000,
  playWindow: gameplay,
  overtime: false,
  ...over,
})

/** A 10 Hz document: team 0 leads (frame 10), tie (30), team 1 leads (40), tie (50), team 1 (70), team 0 again (90). */
function leadDoc() {
  return testReplayDoc({
    frameIntervalMs: 100,
    scoreTimeline: {
      teams: [
        { teamId: 0, rounds: [], total: [{ t: 10, v: 1 }, { t: 50, v: 2 }, { t: 90, v: 4 }] },
        { teamId: 1, rounds: [], total: [{ t: 30, v: 1 }, { t: 40, v: 2 }, { t: 70, v: 3 }] },
      ],
    },
  })
}

describe('announcerMatchCalls', () => {
  it('the mode at kickoff, then the game\'s five warnings on the HUD clock', () => {
    const calls = announcerMatchCalls(testReplayDoc(), match(), null)
    expect(calls.map((c) => [c.ms, c.key])).toEqual([
      [10_000, 'mode.slayer'],
      [10_000 + 5 * 60_000, 'time.300'],
      [10_000 + 8 * 60_000, 'time.120'],
      [10_000 + 9 * 60_000, 'time.60'],
      [10_000 + 9 * 60_000 + 30_000, 'time.30'],
      [10_000 + 9 * 60_000 + 50_000, 'time.10'],
    ])
    expect(calls.every((c) => c.cls === 'match')).toBe(true)
  })

  it('a warning longer than the limit is not said; overtime falls at the end of regulation', () => {
    const calls = announcerMatchCalls(testReplayDoc(), match({ mode: null, timeLimitMs: 90_000, overtime: true }), null)
    expect(calls.map((c) => [c.ms, c.key])).toEqual([
      [10_000 + 30_000, 'time.60'],
      [10_000 + 60_000, 'time.30'],
      [10_000 + 80_000, 'time.10'],
      [10_000 + 90_000, 'overtime'],
    ])
  })

  it('no clock, no window or a round mode: no time call', () => {
    expect(announcerMatchCalls(testReplayDoc(), match({ timeLimitMs: null }), null).map((c) => c.key)).toEqual(['mode.slayer'])
    expect(announcerMatchCalls(testReplayDoc(), match({ playWindow: null }), null).map((c) => [c.ms, c.key])).toEqual([[0, 'mode.slayer']])
    const rounds = testReplayDoc({
      frameIntervalMs: 100,
      scoreTimeline: { teams: [{ teamId: 0, rounds: [{ round: 0, points: [{ t: 2, v: 1 }] }, { round: 1, points: [{ t: 40, v: 1 }] }], total: [] }] },
    })
    expect(announcerMatchCalls(rounds, match(), null).map((c) => c.key)).toEqual(['mode.slayer'])
  })

  it('the mode key is the display name in words', () => {
    expect(modeCallKey('King of the Hill')).toBe('mode.king_of_the_hill')
    expect(modeCallKey('CTF')).toBe('mode.ctf')
  })
})

describe('lostLeadCalls', () => {
  it('the lead passing from our team to another is a call, through a tie; regaining it is not', () => {
    // Team 0 led, the tie at frame 30 suspends it, team 1 takes it at 40: lost. The tie at 50 and
    // team 1 still ahead at 70 change nothing for team 0.
    expect(lostLeadCalls(leadDoc(), 0).map((c) => [c.ms, c.key])).toEqual([[4_000, 'score.lost_lead']])
    // Seen from team 1: it leads from frame 40 and loses the lead at 90.
    expect(lostLeadCalls(leadDoc(), 1).map((c) => c.ms)).toEqual([9_000])
  })

  it('no ally team, no lead call', () => {
    expect(lostLeadCalls(leadDoc(), null)).toEqual([])
  })
})
