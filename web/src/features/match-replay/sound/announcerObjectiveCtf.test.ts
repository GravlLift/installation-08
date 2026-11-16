/**
 * announcerObjectiveCtf.test.ts — the objective calls on TWO STORED CTF MATCHES, end to end:
 * the real objective actions of `05dfe4e9` (Outlook CTF) and `dea65712` (Fortress CTF) go through
 * `announcerCalls`, `scheduleAnnouncer` and the extracted voice, and the test fixes the list of
 * calls the followed player hears (time, line). The durations are the extracted lines' own
 * (`announcer.json` of the install). The Strongholds case fixes the "strongholdlost" call added
 * with the wider objective set: a zone capture by the enemy now has a line where it was silent.
 */
import { describe, expect, it } from 'vitest'

import { testReplayDoc } from '../test/testDoc'
import { announcerCalls, announcerSoundEvents } from './announcerSound'
import { manifestVoice, voiceNamesOfCall, type AnnouncerManifest } from './announcerVoice'
import type { ObjectiveSide } from './objectiveSound'

/** One objective action of the film: frame, author, statistic, exact match time. */
type Action = { t: number; xuid: string; stat: string; timeMs: number }

/** The manifest the install extracts, limited to the objective lines (durations: `announcer.json`). */
const MANIFEST: AnnouncerManifest = {
  version: 4,
  language: 'en',
  lines: {
    flagcaptured: { takes: [{ file: 'announcer_flagcaptured_01.ogg', durationMs: 1600 }] },
    teamflagreturned: { takes: [{ file: 'announcer_teamflagreturned_01.ogg', durationMs: 1195 }] },
    enemyflagreturned: { takes: [{ file: 'announcer_enemyflagreturned_01.ogg', durationMs: 2261 }] },
    strongholdcaptured: { takes: [{ file: 'announcer_strongholdcaptured_01.ogg', durationMs: 1344 }] },
    strongholdlost: { takes: [{ file: 'announcer_strongholdlost_01.ogg', durationMs: 1600 }] },
    hillcontrolled: { takes: [{ file: 'announcer_hillcontrolled_01.ogg', durationMs: 1557 }] },
    hillcontrolledenemy: { takes: [{ file: 'announcer_hillcontrolledenemy_01.ogg', durationMs: 1920 }] },
    newvip: { takes: [{ file: 'announcer_newvip_01.ogg', durationMs: 1664 }] },
  },
}
const VOICE = manifestVoice(MANIFEST)

/** The followed player's side of an author, from the match's roster; an xuid outside it is unknown. */
function sideOf(ally: readonly string[]): (xuid: string) => ObjectiveSide {
  const team = new Set(ally)
  return (xuid) => (team.has(xuid) ? 'ally' : 'enemy')
}

describe('05dfe4e9 — Outlook CTF, followed DrakonReborn (team 1)', () => {
  const ALLEYS = ['2535412919378105', '2535449707262783', '2585548714643410', '2533274814157392']
  const ACTIONS: Action[] = [
    { t: 2412, xuid: '2535449707262783', stat: 'flag_steals', timeMs: 88517 },
    { t: 2685, xuid: '2535430158719390', stat: 'flag_returns', timeMs: 97525 },
    { t: 3699, xuid: '2535449707262783', stat: 'flag_steals', timeMs: 130998 },
    { t: 3706, xuid: '2535419732464073', stat: 'flag_carriers_killed', timeMs: 131219 },
    { t: 6113, xuid: '2535449707262783', stat: 'flag_steals', timeMs: 210661 },
    { t: 6512, xuid: '2535449707262783', stat: 'flag_captures', timeMs: 223808 },
    { t: 6570, xuid: '2533274814157392', stat: 'flag_steals', timeMs: 225726 },
    { t: 6574, xuid: '2535430158719390', stat: 'flag_carriers_killed', timeMs: 225848 },
    { t: 8136, xuid: '2535449707262783', stat: 'flag_steals', timeMs: 277412 },
    { t: 8212, xuid: '2535430158719390', stat: 'flag_carriers_killed', timeMs: 279902 },
    { t: 9577, xuid: '2533274814157392', stat: 'flag_steals', timeMs: 324959 },
    { t: 9754, xuid: '2533274814157392', stat: 'flag_captures', timeMs: 330816 },
    { t: 10167, xuid: '2535449707262783', stat: 'flag_steals', timeMs: 344430 },
    { t: 10191, xuid: '2535430158719390', stat: 'flag_carriers_killed', timeMs: 345222 },
    { t: 10548, xuid: '2535412885924453', stat: 'flag_returns', timeMs: 356992 },
    { t: 14120, xuid: '2535416264717580', stat: 'flag_steals', timeMs: 474877 },
    { t: 14327, xuid: '2535412919378105', stat: 'flag_returns', timeMs: 481717 },
    { t: 14327, xuid: '2535449707262783', stat: 'flag_returns', timeMs: 481717 },
    { t: 15451, xuid: '2535416264717580', stat: 'flag_steals', timeMs: 518789 },
    { t: 15475, xuid: '2585548714643410', stat: 'flag_carriers_killed', timeMs: 519609 },
    { t: 15666, xuid: '2535430158719390', stat: 'flag_grabs', timeMs: 525895 },
    { t: 15667, xuid: '2535430158719390', stat: 'flag_secures', timeMs: 525944 },
    { t: 15687, xuid: '2585548714643410', stat: 'flag_carriers_killed', timeMs: 526581 },
    { t: 17420, xuid: '2535419732464073', stat: 'flag_steals', timeMs: 583787 },
    { t: 17523, xuid: '2535419732464073', stat: 'flag_grabs', timeMs: 587192 },
    { t: 17565, xuid: '2535419732464073', stat: 'flag_grabs', timeMs: 588575 },
    { t: 17607, xuid: '2535419732464073', stat: 'flag_grabs', timeMs: 589943 },
    { t: 17671, xuid: '2535419732464073', stat: 'flag_grabs', timeMs: 592079 },
    { t: 17702, xuid: '2535419732464073', stat: 'flag_grabs', timeMs: 593096 },
    { t: 18091, xuid: '2535430158719390', stat: 'flag_grabs', timeMs: 605910 },
    { t: 18091, xuid: '2535430158719390', stat: 'flag_secures', timeMs: 605925 },
    { t: 18117, xuid: '2535419732464073', stat: 'flag_capture_assists', timeMs: 606794 },
    { t: 18117, xuid: '2535430158719390', stat: 'flag_captures', timeMs: 606794 },
    { t: 20909, xuid: '2533274814157392', stat: 'flag_steals', timeMs: 698920 },
    { t: 20913, xuid: '2535416264717580', stat: 'flag_carriers_killed', timeMs: 699040 },
    { t: 21322, xuid: '2535430158719390', stat: 'flag_returns', timeMs: 712550 },
  ]
  const doc = testReplayDoc({ frameIntervalMs: 33, originMs: 8906, objectives: ACTIONS })
  const input = { doc, followed: '2535449707262783', medals: [], sideOfXuid: sideOf(ALLEYS), voice: VOICE }

  it('hears the captures and the returns, on the film clock (match time minus origin)', () => {
    const events = announcerSoundEvents(input, 'en')
    // The two returns at 481717 are one call (deduplicated); the capture by the enemy team
    // (606794) is silent: the main bank has no "enemy captured your flag" line.
    expect(events.map((e) => [e.ms, e.stem])).toEqual([
      [88_619, 'announcer_enemyflagreturned_01'],
      [214_902, 'announcer_flagcaptured_01'],
      [321_910, 'announcer_flagcaptured_01'],
      [348_086, 'announcer_enemyflagreturned_01'],
      [472_811, 'announcer_teamflagreturned_01'],
      [703_644, 'announcer_enemyflagreturned_01'],
    ])
  })

  it('the unmapped CTF statistics (steals, grabs, secures, carriers killed) stay silent: their calls have no line', () => {
    // A call is made for every dated objective action with a known side; silence is the absence
    // of a line, which `scheduleAnnouncer` removes before the queue.
    for (const stat of ['flag_steals', 'flag_grabs', 'flag_secures', 'flag_carriers_killed', 'flag_capture_assists']) {
      expect(VOICE.takes(`objective.${stat}.ours`, 'en')).toEqual([])
      expect(VOICE.takes(`objective.${stat}.theirs`, 'en')).toEqual([])
    }
    // Every dated action makes a call (36 minus the one deduplicated pair); the schedule keeps
    // only the six that have a line.
    expect(announcerCalls(input).filter((c) => c.cls === 'objective')).toHaveLength(35)
  })
})

describe('dea65712 — Fortress CTF, followed urbanflow1657 (team 1)', () => {
  const ALLEYS = ['2535439250209847', '2533274923385571', '2535471766926838', '2535431638540170']
  const ACTIONS: Action[] = [
    { t: 2549, xuid: '2535471766926838', stat: 'flag_steals', timeMs: 94303 },
    { t: 2590, xuid: '2535471766926838', stat: 'flag_grabs', timeMs: 95671 },
    { t: 2644, xuid: '2535471766926838', stat: 'flag_secures', timeMs: 97439 },
    { t: 2645, xuid: '2535471766926838', stat: 'flag_grabs', timeMs: 97490 },
    { t: 2683, xuid: '2535471766926838', stat: 'flag_grabs', timeMs: 98740 },
    { t: 2756, xuid: '2535471766926838', stat: 'flag_grabs', timeMs: 101127 },
    { t: 2756, xuid: '2535471766926838', stat: 'flag_secures', timeMs: 101142 },
    { t: 2803, xuid: '2535471766926838', stat: 'flag_grabs', timeMs: 102679 },
    { t: 2845, xuid: '2535471766926838', stat: 'flag_grabs', timeMs: 104063 },
    { t: 2885, xuid: '2535471766926838', stat: 'flag_grabs', timeMs: 105397 },
    { t: 3019, xuid: '2535471766926838', stat: 'flag_grabs', timeMs: 109801 },
    { t: 3024, xuid: '2535471766926838', stat: 'flag_captures', timeMs: 109986 },
    { t: 4030, xuid: '2535439250209847', stat: 'flag_steals', timeMs: 143185 },
    { t: 4112, xuid: '2535439250209847', stat: 'flag_secures', timeMs: 145886 },
    { t: 4117, xuid: '2535439250209847', stat: 'flag_grabs', timeMs: 146054 },
    { t: 4163, xuid: '2535439250209847', stat: 'flag_grabs', timeMs: 147557 },
    { t: 4211, xuid: '2535439250209847', stat: 'flag_grabs', timeMs: 149158 },
    { t: 4337, xuid: '2535439250209847', stat: 'flag_grabs', timeMs: 153295 },
    { t: 4340, xuid: '2535439250209847', stat: 'flag_secures', timeMs: 153398 },
    { t: 4462, xuid: '2535439250209847', stat: 'flag_grabs', timeMs: 157435 },
    { t: 4477, xuid: '2535439250209847', stat: 'flag_captures', timeMs: 157937 },
    { t: 7569, xuid: '2585548714643410', stat: 'flag_steals', timeMs: 259981 },
    { t: 8264, xuid: '2535431638540170', stat: 'flag_returns', timeMs: 282909 },
    { t: 8831, xuid: '2533274839087238', stat: 'flag_steals', timeMs: 301613 },
    { t: 8911, xuid: '2533274923385571', stat: 'flag_steals', timeMs: 304267 },
    { t: 9082, xuid: '2533274923385571', stat: 'flag_grabs', timeMs: 309887 },
    { t: 9083, xuid: '2533274923385571', stat: 'flag_secures', timeMs: 309920 },
    { t: 9784, xuid: '2533274923385571', stat: 'flag_grabs', timeMs: 333063 },
    { t: 9787, xuid: '2533274923385571', stat: 'flag_secures', timeMs: 333145 },
    { t: 9836, xuid: '2533274923385571', stat: 'flag_grabs', timeMs: 334780 },
    { t: 9871, xuid: '2533274923385571', stat: 'flag_grabs', timeMs: 335931 },
    { t: 9906, xuid: '2533274923385571', stat: 'flag_grabs', timeMs: 337082 },
    { t: 9971, xuid: '2533274923385571', stat: 'flag_grabs', timeMs: 339218 },
    { t: 10019, xuid: '2533274923385571', stat: 'flag_grabs', timeMs: 340818 },
    { t: 10037, xuid: '2533274839087238', stat: 'flag_carriers_killed', timeMs: 341406 },
    { t: 10403, xuid: '2535431638540170', stat: 'flag_grabs', timeMs: 353481 },
    { t: 10405, xuid: '2535431638540170', stat: 'flag_secures', timeMs: 353564 },
    { t: 10478, xuid: '2535431638540170', stat: 'flag_secures', timeMs: 355966 },
    { t: 10494, xuid: '2535431638540170', stat: 'flag_grabs', timeMs: 356485 },
    { t: 10549, xuid: '2535431638540170', stat: 'flag_grabs', timeMs: 358302 },
    { t: 10552, xuid: '2533274923385571', stat: 'flag_capture_assists', timeMs: 358420 },
    { t: 10552, xuid: '2535431638540170', stat: 'flag_captures', timeMs: 358420 },
  ]
  const doc = testReplayDoc({ frameIntervalMs: 33, originMs: 10173, objectives: ACTIONS })
  const input = { doc, followed: '2535439250209847', medals: [], sideOfXuid: sideOf(ALLEYS), voice: VOICE }

  it('hears the three captures by his team and the one return, on the film clock', () => {
    const events = announcerSoundEvents(input, 'en')
    expect(events.map((e) => [e.ms, e.stem])).toEqual([
      [99_813, 'announcer_flagcaptured_01'],
      [147_764, 'announcer_flagcaptured_01'],
      [272_736, 'announcer_teamflagreturned_01'],
      [348_247, 'announcer_flagcaptured_01'],
    ])
  })
})

describe('Strongholds — the enemy capture now has a line', () => {
  const doc = testReplayDoc({
    frameIntervalMs: 100,
    originMs: 0,
    objectives: [
      { t: 20, xuid: 'ally', stat: 'zone_captures', timeMs: 2000 },
      { t: 30, xuid: 'enemy', stat: 'zone_captures', timeMs: 3000 },
    ],
  })
  const input = {
    doc,
    followed: 'ally',
    medals: [],
    sideOfXuid: sideOf(['ally', 'mate']),
    voice: VOICE,
    match: { mode: 'Strongholds', timeLimitMs: null, playWindow: null, overtime: false },
  }

  it('the call key of the enemy zone capture is ours/theirs by side, and the theirs key says strongholdlost', () => {
    expect(voiceNamesOfCall('objective.zone_captures.theirs')).toEqual(['strongholdlost'])
    const events = announcerSoundEvents(input, 'en')
    // One line: the enemy capture at 3000 waits for "strongholdcaptured" to end (2000 + 1344).
    expect(events.map((e) => [e.ms, e.stem])).toEqual([
      [2_000, 'announcer_strongholdcaptured_01'],
      [3_344, 'announcer_strongholdlost_01'],
    ])
  })

  it('the same action in King of the Hill is the hill call, not the stronghold one', () => {
    const koth = { ...input, match: { mode: 'King of the Hill', timeLimitMs: null, playWindow: null, overtime: false } }
    const events = announcerSoundEvents(koth, 'en')
    expect(events.map((e) => e.stem)).toEqual(['announcer_hillcontrolled_01', 'announcer_hillcontrolledenemy_01'])
  })
})
