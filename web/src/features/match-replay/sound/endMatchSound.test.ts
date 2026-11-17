// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * Tests — endMatchSound (what sounds when the match ends).
 *
 * WHAT THEY PROTECT. An error here breaks nothing at runtime: it announces "Victory"
 * to someone who just lost, or speaks English to a French interface — on the
 * end screen, on the only sound the user will listen to all the way through. The four plausible
 * confusions are covered: the outcome (the OPPONENT's victory is not mine), the
 * language, the teamless case (FFA), and the draw among takes.
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
function film(equipes: Array<[string, number | undefined]>, reference: string | null = null) {
  return buildFilmAllegiance(equipes.map(([xuid, team]) => ({ xuid, team, lives: [] }) as ReplayPlayer), reference)
}

/** Two sides, the page player (`me`) on side 0 — the end screen's reference case. */
const DEUX_CAMPS = film([['moi', 0], ['pote', 0], ['eux-1', 1], ['eux-2', 1]])
/** An FFA: the film gives no team (`-1`). */
const FFA = film([['moi', -1], ['a', -1], ['b', -1]])
/** The scoreboard: its `is_me` row (`moi`), not its first row, designates the page. */
const FEUILLE = [
  { xuid: 'eux-1', is_me: false },
  { xuid: 'moi', is_me: true },
]

/** The draw pinned to the FIRST take. */
const premiere = () => 0
/** The draw pinned to the LAST take, bound included (rand === 1 is out of contract). */
const derniere = () => 0.999

describe('endMatchSounds — voice AND fanfare, according to the outcome', () => {
  it('win in French: the victory line and its fanfare go out together', () => {
    expect(endMatchSounds('win', false, 'fr', premiere)).toEqual([
      'end_victory_voice_fr_01',
      'end_victory_music_01',
    ])
  })

  it('loss: it is the defeat line AND the defeat music, never the victory ones', () => {
    const joues = endMatchSounds('loss', false, 'fr', premiere)
    expect(joues).toEqual(['end_defeat_voice_fr_01', 'end_defeat_music_01'])
    expect(joues.join(' ')).not.toContain('victory')
  })

  it('tie: its own line and its own fanfare', () => {
    expect(endMatchSounds('tie', false, 'fr', premiere)).toEqual([
      'end_tie_voice_fr_01',
      'end_tie_music_01',
    ])
  })
})

describe('endMatchSounds — the language is the one of the interface', () => {
  it('in English the voice changes; the fanfare, it, does not speak', () => {
    expect(endMatchSounds('win', false, 'en', premiere)).toEqual([
      'end_victory_voice_en_01',
      'end_victory_music_01',
    ])
    expect(endMatchSounds('loss', false, 'en', premiere)).toEqual([
      'end_defeat_voice_en_01',
      'end_defeat_music_01',
    ])
  })

  it('every outcome has a voice in BOTH languages (no holed pack)', () => {
    for (const issue of ['win', 'loss', 'tie'] as const) {
      for (const langue of ['fr', 'en'] as const) {
        expect(END_VOICE_STEMS[issue][langue].length, `${issue}/${langue}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('endMatchSounds — the draw among takes', () => {
  it('two French takes for the victory: the draw reaches both of them', () => {
    expect(endMatchSounds('win', false, 'fr', premiere)[0]).toBe('end_victory_voice_fr_01')
    expect(endMatchSounds('win', false, 'fr', derniere)[0]).toBe('end_victory_voice_fr_02')
  })

  it('a single take: the draw always returns the same one, whatever the value', () => {
    expect(endMatchSounds('win', false, 'en', premiere)[0]).toBe('end_victory_voice_en_01')
    expect(endMatchSounds('win', false, 'en', derniere)[0]).toBe('end_victory_voice_en_01')
  })

  it('a draw at 1 (out of Math.random contract) NEVER falls out of the list', () => {
    for (const issue of ['win', 'loss', 'tie'] as const) {
      const voix = endMatchSounds(issue, false, 'fr', () => 1)[0]
      expect(END_VOICE_STEMS[issue].fr, `${issue}`).toContain(voix)
    }
  })
})

describe('endMatchSounds — FFA has no screen, but it has a voice', () => {
  it('FFA won in French: "Vainqueur" (Winner), with the victory fanfare', () => {
    expect(endMatchSounds('win', true, 'fr', premiere)).toEqual([
      'end_winner_voice_fr_01',
      'end_victory_music_01',
    ])
  })

  it('FFA won in English: documented fallback to "Victory" (no standalone "Winner")', () => {
    expect(endMatchSounds('win', true, 'en', premiere)).toEqual([
      'end_victory_voice_en_01',
      'end_victory_music_01',
    ])
    expect(END_FFA_WIN_VOICE_STEMS.en).toEqual(['end_victory_voice_en_01'])
  })

  it('FFA lost or tied: nothing — no line says that without naming a team', () => {
    expect(endMatchSounds('loss', true, 'fr', premiere)).toEqual([])
    expect(endMatchSounds('tie', true, 'fr', premiere)).toEqual([])
    expect(endMatchSounds('loss', true, 'en', premiere)).toEqual([])
  })
})

describe('endMatchSoundSpec — the same reading as the end screen', () => {
  it('two sides: the page player outcome, without the FFA flag', () => {
    expect(endMatchSoundSpec(DEUX_CAMPS, FEUILLE, 3, 'fr')).toEqual({
      outcome: 'loss',
      ffa: false,
      locale: 'fr',
    })
  })

  it('THE PAGE is the scoreboard `is_me` row — not its first row, not the allegiance reference', () => {
    // The film places `eux-1` (first row of the scoreboard, and the point of view the allegiance carries)
    // but hides the page's team (`moi`). Read for the page, the end has no side to dress:
    // only the victory sounds, as "Vainqueur" (ffa), and the defeat stays silent. Read for `eux-1`,
    // it would have two sides and say "Victory" or "Defeat".
    const pageMuette = film([['moi', undefined], ['pote', 0], ['eux-1', 1], ['eux-2', 1]], 'eux-1')
    expect(endMatchSoundSpec(pageMuette, FEUILLE, 2, 'fr')).toEqual({
      outcome: 'win',
      ffa: true,
      locale: 'fr',
    })
    expect(endMatchSoundSpec(pageMuette, FEUILLE, 3, 'fr')).toBeNull()
  })

  it('NO SUBJECT: viewed from an opponent, the end always announces the page outcome', () => {
    // The page (`moi`, side 0) won; `eux-1` (side 1) is the first row of the scoreboard and
    // the point of view the allegiance carries. Passing either one as the SUBJECT of the reading
    // would flip the outcome to "Défaite" (Defeat): the harmonization with the end screen, which
    // follows the point of view, that decision 3 forbids.
    const vuDeLAdversaire = film([['moi', 0], ['pote', 0], ['eux-1', 1], ['eux-2', 1]], 'eux-1')
    expect(endMatchSoundSpec(vuDeLAdversaire, FEUILLE, 2, 'fr')).toEqual({
      outcome: 'win',
      ffa: false,
      locale: 'fr',
    })
  })

  it('two-side tie: it sounds, unlike the teamless tie', () => {
    expect(endMatchSoundSpec(DEUX_CAMPS, FEUILLE, 1, 'en')).toEqual({
      outcome: 'tie',
      ffa: false,
      locale: 'en',
    })
    expect(endMatchSoundSpec(FFA, FEUILLE, 1, 'en')).toBeNull()
  })

  it('FFA won: the flag goes to true, and it is the one that chooses "Vainqueur" (Winner)', () => {
    const spec = endMatchSoundSpec(FFA, FEUILLE, 2, 'fr')
    expect(spec).toEqual({ outcome: 'win', ffa: true, locale: 'fr' })
    expect(endMatchSounds(spec!.outcome, spec!.ffa, spec!.locale, premiere)[0]).toBe(
      'end_winner_voice_fr_01',
    )
  })

  it('FFA lost: nothing to announce', () => {
    expect(endMatchSoundSpec(FFA, FEUILLE, 3, 'fr')).toBeNull()
  })

  it('surrender (code 4), missing code, header not yet loaded: nothing', () => {
    expect(endMatchSoundSpec(DEUX_CAMPS, FEUILLE, 4, 'fr')).toBeNull()
    expect(endMatchSoundSpec(DEUX_CAMPS, FEUILLE, undefined, 'fr')).toBeNull()
    expect(endMatchSoundSpec(film([]), [], undefined, 'fr')).toBeNull()
  })

  it('page player the film does not place: the victory stays announcable, without a named team', () => {
    // `readVictory` refuses (it would not know which side dresses the screen); the VOICE, it,
    // names no one — "Vainqueur" (Winner) is true without assuming anything.
    expect(endMatchSoundSpec(film([['a', 0], ['b', 1]]), FEUILLE, 2, 'fr')).toEqual({
      outcome: 'win',
      ffa: true,
      locale: 'fr',
    })
  })
})

describe('endMatchSoundStems — what the player must pre-load', () => {
  it('ALL the takes of the outcome, not only the one that will be drawn', () => {
    expect(endMatchSoundStems({ outcome: 'win', ffa: false, locale: 'fr' })).toEqual([
      'end_victory_voice_fr_01',
      'end_victory_voice_fr_02',
      'end_victory_music_01',
    ])
  })

  it('covers exactly what the draw can return, for each outcome and each language', () => {
    for (const issue of ['win', 'loss', 'tie'] as const) {
      for (const langue of ['fr', 'en'] as const) {
        for (const ffa of [false, true]) {
          const spec = { outcome: issue, ffa, locale: langue }
          const precharges = endMatchSoundStems(spec)
          for (const r of [0, 0.5, 0.999]) {
            for (const joue of endMatchSounds(issue, ffa, langue, () => r)) {
              expect(precharges, `${issue}/${langue}/ffa=${ffa}`).toContain(joue)
            }
          }
        }
      }
    }
  })

  it('nothing to conclude: nothing to load', () => {
    expect(endMatchSoundStems(null)).toEqual([])
    expect(endMatchSoundStems({ outcome: 'loss', ffa: true, locale: 'fr' })).toEqual([])
  })

  it('the FFA won fanfare is the victory one (one single file, not two)', () => {
    expect(endMatchSoundStems({ outcome: 'win', ffa: true, locale: 'fr' })).toContain(
      END_MUSIC_STEMS.win,
    )
  })
})
