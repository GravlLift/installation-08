// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * Tests — endMatchSound (what sounds when the match ends).
 *
 * WHAT THEY PROTECT. An error here breaks nothing at runtime: it announces "Victory"
 * to someone who just lost, on the end screen, on the only sound the user will listen to all
 * the way through. The three plausible confusions are covered: the outcome (the OPPONENT's
 * victory is not mine), the teamless case (FFA), and the draw among takes.
 *
 * THE DRAW IS INJECTED, never mocked: `rand` is a parameter, the cases below give it
 * 0, 0.5 or 0.999 and read the take. A `vi.spyOn(Math, 'random')` would test the
 * double, not the rule.
 */
import { describe, expect, it } from 'vitest'

import { buildFilmAllegiance } from '@/lib/replay/filmAllegiance'
import type { ReplayPlayer } from '@/lib/replay/rosterLogic'

import {
  END_FFA_WIN_VOICE_STEMS,
  END_MUSIC_STEMS,
  END_VOICE_STEMS,
  endMatchSoundSpec,
  endMatchSoundStems,
  endMatchSounds,
} from './endMatchSound'

/**
 * The FILM's teams, per player (victoryLogic.test pattern): the end reading only looks at
 * the sides and the page player's team (`me`). `reference` is the one the allegiance
 * carries (the Replay page's point of view): the sound end must not read it.
 */
function film(teams: Array<[string, number | undefined]>, reference: string | null = null) {
  return buildFilmAllegiance(teams.map(([xuid, team]) => ({ xuid, team, lives: [] }) as ReplayPlayer), reference)
}

/** Two sides, the page player (`me`) on side 0 — the end screen's reference case. */
const TWO_SIDES = film([['me', 0], ['buddy', 0], ['them-1', 1], ['them-2', 1]])
/** An FFA: the film gives no team (`-1`). */
const FFA = film([['me', -1], ['a', -1], ['b', -1]])
/** The scoreboard: its `is_me` row (`me`), not its first row, designates the page. */
const SCOREBOARD = [
  { xuid: 'them-1', is_me: false },
  { xuid: 'me', is_me: true },
]

/** The draw pinned to the FIRST take. */
const first = () => 0
/** The draw pinned to the LAST take, bound included (rand === 1 is out of contract). */
const last = () => 0.999

describe('endMatchSounds — voice AND fanfare, according to the outcome', () => {
  it('win: the victory line and its fanfare go out together', () => {
    expect(endMatchSounds('win', false, 'en', first)).toEqual([
      'end_victory_voice_en_01',
      'end_victory_music_01',
    ])
  })

  it('loss: it is the defeat line AND the defeat music, never the victory ones', () => {
    const played = endMatchSounds('loss', false, 'en', first)
    expect(played).toEqual(['end_defeat_voice_en_01', 'end_defeat_music_01'])
    expect(played.join(' ')).not.toContain('victory')
  })

  it('tie: its own line and its own fanfare', () => {
    expect(endMatchSounds('tie', false, 'en', first)).toEqual([
      'end_tie_voice_en_01',
      'end_tie_music_01',
    ])
  })
})

describe('endMatchSounds — every outcome has a voice', () => {
  it('every outcome has a voice (no holed pack)', () => {
    for (const outcome of ['win', 'loss', 'tie'] as const) {
      expect(END_VOICE_STEMS[outcome].en.length, outcome).toBeGreaterThan(0)
    }
  })
})

describe('endMatchSounds — the draw among takes', () => {
  it('two takes for the loss: the draw reaches both of them', () => {
    expect(endMatchSounds('loss', false, 'en', first)[0]).toBe('end_defeat_voice_en_01')
    expect(endMatchSounds('loss', false, 'en', last)[0]).toBe('end_defeat_voice_en_02')
  })

  it('a single take: the draw always returns the same one, whatever the value', () => {
    expect(endMatchSounds('win', false, 'en', first)[0]).toBe('end_victory_voice_en_01')
    expect(endMatchSounds('win', false, 'en', last)[0]).toBe('end_victory_voice_en_01')
  })

  it('a draw at 1 (out of Math.random contract) NEVER falls out of the list', () => {
    for (const outcome of ['win', 'loss', 'tie'] as const) {
      const voice = endMatchSounds(outcome, false, 'en', () => 1)[0]
      expect(END_VOICE_STEMS[outcome].en, outcome).toContain(voice)
    }
  })
})

describe('endMatchSounds — FFA has no screen, but it has a voice', () => {
  it('FFA won: documented fallback to "Victory" (no standalone "Winner")', () => {
    expect(endMatchSounds('win', true, 'en', first)).toEqual([
      'end_victory_voice_en_01',
      'end_victory_music_01',
    ])
    expect(END_FFA_WIN_VOICE_STEMS.en).toEqual(['end_victory_voice_en_01'])
  })

  it('FFA lost or tied: nothing — no line says that without naming a team', () => {
    expect(endMatchSounds('loss', true, 'en', first)).toEqual([])
    expect(endMatchSounds('tie', true, 'en', first)).toEqual([])
  })
})

describe('endMatchSoundSpec — the same reading as the end screen', () => {
  it('two sides: the page player outcome, without the FFA flag', () => {
    expect(endMatchSoundSpec(TWO_SIDES, SCOREBOARD, 3, 'en')).toEqual({
      outcome: 'loss',
      ffa: false,
      locale: 'en',
    })
  })

  it('THE PAGE is the scoreboard `is_me` row — not its first row, not the allegiance reference', () => {
    // The film places `them-1` (first row of the scoreboard, and the point of view the allegiance carries)
    // but hides the page's team (`me`). Read for the page, the end has no side to dress:
    // only the victory sounds, as the FFA "Winner" line, and the defeat stays silent. Read for `them-1`,
    // it would have two sides and say "Victory" or "Defeat".
    const silentPage = film([['me', undefined], ['buddy', 0], ['them-1', 1], ['them-2', 1]], 'them-1')
    expect(endMatchSoundSpec(silentPage, SCOREBOARD, 2, 'en')).toEqual({
      outcome: 'win',
      ffa: true,
      locale: 'en',
    })
    expect(endMatchSoundSpec(silentPage, SCOREBOARD, 3, 'en')).toBeNull()
  })

  it('NO SUBJECT: viewed from an opponent, the end always announces the page outcome', () => {
    // The page (`me`, side 0) won; `them-1` (side 1) is the first row of the scoreboard and
    // the point of view the allegiance carries. Passing either one as the SUBJECT of the reading
    // would flip the outcome to "Defeat": the harmonization with the end screen, which
    // follows the point of view, that decision 3 forbids.
    const seenFromTheOpponent = film([['me', 0], ['buddy', 0], ['them-1', 1], ['them-2', 1]], 'them-1')
    expect(endMatchSoundSpec(seenFromTheOpponent, SCOREBOARD, 2, 'en')).toEqual({
      outcome: 'win',
      ffa: false,
      locale: 'en',
    })
  })

  it('two-side tie: it sounds, unlike the teamless tie', () => {
    expect(endMatchSoundSpec(TWO_SIDES, SCOREBOARD, 1, 'en')).toEqual({
      outcome: 'tie',
      ffa: false,
      locale: 'en',
    })
    expect(endMatchSoundSpec(FFA, SCOREBOARD, 1, 'en')).toBeNull()
  })

  it('FFA won: the flag goes to true, and it is the one that chooses the "Winner" line', () => {
    const spec = endMatchSoundSpec(FFA, SCOREBOARD, 2, 'en')
    expect(spec).toEqual({ outcome: 'win', ffa: true, locale: 'en' })
    expect(endMatchSounds(spec!.outcome, spec!.ffa, spec!.locale, first)[0]).toBe(
      'end_victory_voice_en_01',
    )
  })

  it('FFA lost: nothing to announce', () => {
    expect(endMatchSoundSpec(FFA, SCOREBOARD, 3, 'en')).toBeNull()
  })

  it('surrender (code 4), missing code, header not yet loaded: nothing', () => {
    expect(endMatchSoundSpec(TWO_SIDES, SCOREBOARD, 4, 'en')).toBeNull()
    expect(endMatchSoundSpec(TWO_SIDES, SCOREBOARD, undefined, 'en')).toBeNull()
    expect(endMatchSoundSpec(film([]), [], undefined, 'en')).toBeNull()
  })

  it('page player the film does not place: the victory stays announcable, without a named team', () => {
    // `readVictory` refuses (it would not know which side dresses the screen); the VOICE, it,
    // names no one — the FFA "Winner" line is true without assuming anything.
    expect(endMatchSoundSpec(film([['a', 0], ['b', 1]]), SCOREBOARD, 2, 'en')).toEqual({
      outcome: 'win',
      ffa: true,
      locale: 'en',
    })
  })
})

describe('endMatchSoundStems — what the player must pre-load', () => {
  it('ALL the takes of the outcome, not only the one that will be drawn', () => {
    expect(endMatchSoundStems({ outcome: 'loss', ffa: false, locale: 'en' })).toEqual([
      'end_defeat_voice_en_01',
      'end_defeat_voice_en_02',
      'end_defeat_music_01',
    ])
  })

  it('covers exactly what the draw can return, for each outcome', () => {
    for (const outcome of ['win', 'loss', 'tie'] as const) {
      for (const ffa of [false, true]) {
        const spec = { outcome, ffa, locale: 'en' as const }
        const preloads = endMatchSoundStems(spec)
        for (const r of [0, 0.5, 0.999]) {
          for (const played of endMatchSounds(outcome, ffa, 'en', () => r)) {
            expect(preloads, `${outcome}/ffa=${ffa}`).toContain(played)
          }
        }
      }
    }
  })

  it('nothing to conclude: nothing to load', () => {
    expect(endMatchSoundStems(null)).toEqual([])
    expect(endMatchSoundStems({ outcome: 'loss', ffa: true, locale: 'en' })).toEqual([])
  })

  it('the FFA won fanfare is the victory one (one single file, not two)', () => {
    expect(endMatchSoundStems({ outcome: 'win', ffa: true, locale: 'en' })).toContain(
      END_MUSIC_STEMS.win,
    )
  })
})
