/**
 * announcerSound.test.ts — the announcer's rules: whose calls, which variant, one line, no
 * overlap, and the bundled lines. The table used by most cases is a test table: the bundled set
 * has no medal or objective voice line, and the rules must hold the day one is added.
 */
import { describe, expect, it } from 'vitest'

import type { ReplayFeedEntry } from '../model/killFeedLogic'
import { testReplayDoc } from '../test/testDoc'
import {
  ANNOUNCER_LINES,
  ANNOUNCER_MAX_WAIT_MS,
  announcerCalls,
  announcerSoundEvents,
  announcerStems,
  medalCallKey,
  medalsOfFeed,
  objectiveCallKey,
  scheduleAnnouncer,
  type AnnouncerCall,
  type AnnouncerLines,
} from './announcerSound'
import type { ObjectiveSide } from './objectiveSound'

/** A 10 Hz document whose score layer has two rounds: the transition falls at frame 10 = 1,000 ms. */
function twoRoundDoc(objectives: { stat: string; t: number; timeMs: number; xuid: string }[] = []) {
  return testReplayDoc({
    frameIntervalMs: 100,
    objectives,
    scoreTimeline: {
      teams: [
        { teamId: 0, rounds: [{ round: 0, points: [{ t: 2, v: 1 }, { t: 10, v: 2 }] }, { round: 1, points: [{ t: 40, v: 1 }] }], total: [] },
      ],
    },
  })
}

const LINES: AnnouncerLines = {
  round_over: { en: { stem: 'round_over_en', durationMs: 1_700 } },
  'medal.double_kill': { en: { stem: 'double_kill_en', durationMs: 1_000 } },
  'medal.triple_kill': { en: { stem: 'triple_kill_en', durationMs: 1_000 } },
  'objective.flag_captures.ours': { en: { stem: 'flag_captured_ours_en', durationMs: 1_500 } },
  'objective.flag_captures.theirs': { en: { stem: 'flag_captured_theirs_en', durationMs: 1_500 } },
}

const durationIn = (lines: AnnouncerLines) => (key: string) => lines[key]?.en?.durationMs

const sides: Record<string, ObjectiveSide> = { me: 'ally', mate: 'ally', foe: 'enemy' }
const sideOfXuid = (xuid: string): ObjectiveSide => sides[xuid] ?? 'unknown'

describe('announcerCalls — whose calls', () => {
  it('keeps only the FOLLOWED player own medals', () => {
    const medals = [
      { ms: 500, xuid: 'me', name: 'Double Kill' },
      { ms: 600, xuid: 'mate', name: 'Double Kill' },
      { ms: 700, xuid: 'foe', name: 'Triple Kill' },
    ]
    const calls = announcerCalls({ doc: testReplayDoc(), followed: 'me', medals })
    expect(calls).toEqual([{ ms: 500, key: 'medal.double_kill', cls: 'medal' }])
  })

  it('changing the followed player changes the medal calls; nobody followed = no medal call', () => {
    const medals = [{ ms: 500, xuid: 'me', name: 'Double Kill' }, { ms: 900, xuid: 'foe', name: 'Triple Kill' }]
    expect(announcerCalls({ doc: testReplayDoc(), followed: 'foe', medals }).map((c) => c.key)).toEqual(['medal.triple_kill'])
    expect(announcerCalls({ doc: testReplayDoc(), followed: null, medals })).toEqual([])
  })

  it('an objective call plays for both sides, with the variant of the followed player side', () => {
    const doc = twoRoundDoc([
      { stat: 'flag_captures', t: 20, timeMs: 0, xuid: 'mate' },
      { stat: 'flag_captures', t: 30, timeMs: 0, xuid: 'foe' },
      { stat: 'flag_captures', t: 35, timeMs: 0, xuid: 'stranger' },
    ])
    const keys = announcerCalls({ doc, followed: 'me', medals: [], sideOfXuid }).filter((c) => c.cls === 'objective').map((c) => c.key)
    expect(keys).toEqual(['objective.flag_captures.ours', 'objective.flag_captures.theirs']) // unknown side: no call
  })

  it('one call per objective moment, however many players the statistic credits', () => {
    const doc = twoRoundDoc([
      { stat: 'zone_captures', t: 20, timeMs: 0, xuid: 'me' },
      { stat: 'zone_captures', t: 20, timeMs: 0, xuid: 'mate' },
    ])
    expect(announcerCalls({ doc, followed: 'me', medals: [], sideOfXuid }).filter((c) => c.cls === 'objective')).toHaveLength(1)
  })

  it('every round transition is a call, for everyone', () => {
    const calls = announcerCalls({ doc: twoRoundDoc(), followed: null, medals: [] })
    expect(calls).toEqual([{ ms: 1_000, key: 'round_over', cls: 'round' }])
  })
})

describe('scheduleAnnouncer — one line, no overlap', () => {
  const call = (ms: number, key: string, cls: AnnouncerCall['cls']): AnnouncerCall => ({ ms, key, cls })

  it('a call that comes while another plays waits for its end', () => {
    const cues = scheduleAnnouncer([call(0, 'medal.double_kill', 'medal'), call(400, 'medal.triple_kill', 'medal')], durationIn(LINES))
    expect(cues).toEqual([
      { timeMs: 0, soundKey: 'medal.double_kill' },
      { timeMs: 1_000, soundKey: 'medal.triple_kill' },
    ])
  })

  it('when the line frees, the higher class goes first, whatever its arrival order', () => {
    const cues = scheduleAnnouncer(
      [call(0, 'medal.double_kill', 'medal'), call(200, 'medal.triple_kill', 'medal'), call(300, 'round_over', 'round')],
      durationIn(LINES),
    )
    expect(cues.map((c) => [c.timeMs, c.soundKey])).toEqual([
      [0, 'medal.double_kill'],
      [1_000, 'round_over'],
      [2_700, 'medal.triple_kill'],
    ])
  })

  it('a call that waited longer than the bound is dropped', () => {
    const cues = scheduleAnnouncer(
      [call(0, 'round_over', 'round'), call(100, 'objective.flag_captures.ours', 'objective'), call(200, 'medal.double_kill', 'medal')],
      durationIn(LINES),
      1_700,
    )
    // round 0..1700, the objective call (waited 1,600 ms) plays 1700..3200; the medal would wait 3,000 ms > 1,700.
    expect(cues.map((c) => c.soundKey)).toEqual(['round_over', 'objective.flag_captures.ours'])
    expect(ANNOUNCER_MAX_WAIT_MS).toBeGreaterThan(0)
  })

  it('a call without a file never delays an audible one', () => {
    const cues = scheduleAnnouncer([call(0, 'medal.perfect', 'medal'), call(100, 'medal.double_kill', 'medal')], durationIn(LINES))
    expect(cues).toEqual([{ timeMs: 100, soundKey: 'medal.double_kill' }])
  })
})

describe('announcerSoundEvents — the track events', () => {
  it('flat announcer events (no position), in the interface language', () => {
    const events = announcerSoundEvents({ doc: twoRoundDoc(), followed: null, medals: [] }, 'en', LINES)
    expect(events).toEqual([{ ms: 1_000, stem: 'round_over_en', announcer: true }])
  })

  it('no language, no voice', () => {
    expect(announcerSoundEvents({ doc: twoRoundDoc(), followed: null, medals: [] }, undefined, LINES)).toEqual([])
  })

  it('the bundled set: the round end plays in both languages, medals stay silent (no file)', () => {
    const input = { doc: twoRoundDoc(), followed: 'me', medals: [{ ms: 1_200, xuid: 'me', name: 'Double Kill' }] }
    expect(announcerSoundEvents(input, 'fr').map((e) => e.stem)).toEqual(['round_over_fr'])
    expect(announcerSoundEvents(input, 'en').map((e) => e.stem)).toEqual(['round_over_en'])
    expect(announcerStems('fr', ANNOUNCER_LINES)).toEqual(['round_over_fr'])
  })
})

describe('keys and the feed', () => {
  it('a medal key is its English name; an objective key names the side as ours or theirs', () => {
    expect(medalCallKey('Double Kill')).toBe('medal.double_kill')
    expect(medalCallKey("Odin's Raven")).toBe('medal.odin_s_raven')
    expect(medalCallKey('360')).toBe('medal.360')
    expect(objectiveCallKey('flag_captures', 'enemy')).toBe('objective.flag_captures.theirs')
  })

  it('medalsOfFeed keeps an attached medal offset from its kill, and a lone medal at its line', () => {
    const medal = (tMs: number, name: string) => ({ tMs, xuid: 'me', gamertag: 'Me', name, label: '', description: '', imageUrl: '' })
    const entries = [
      { key: 'k', replayMs: 5_000, kill: { tMs: 4_000, medals: [medal(4_200, 'Double Kill')] }, medal: null, death: null },
      { key: 'm', replayMs: 9_000, kill: null, medal: medal(8_000, 'Wingman'), death: null },
    ] as unknown as ReplayFeedEntry[]
    expect(medalsOfFeed(entries)).toEqual([
      { ms: 5_200, xuid: 'me', name: 'Double Kill' },
      { ms: 9_000, xuid: 'me', name: 'Wingman' },
    ])
  })
})
