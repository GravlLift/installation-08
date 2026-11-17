// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * exportOverlayPanels.test.ts — DOES THE END PANEL REPAINTED IN THE VIDEO SAY THE SAME
 * THING as the one shown on screen?
 *
 * The two surfaces announce the SAME match: if they decided separately, the exported video
 * would show the last round's points ("100 - 43") while the page says "2 - 1". The DOM twin
 * is covered by ReplayVictoryOverlay.test.tsx; this file covers the export-side choice, which
 * was not covered before (adversarial review finding of 2026-08-29).
 */
import { describe, expect, it } from 'vitest'

import { buildOverlayPanelSource, exportFinalScore, type OverlayPanelDeps } from './exportOverlayPanels'
import { normalizeScoreTimeline, type ReplayScoreDocument } from '@/lib/replay/scoreTimeline'
import type { MatchScoreboardRow } from '@/lib/api/types'
import { buildFilmAllegiance } from '@/lib/replay/filmAllegiance'
import type { ReplayPlayer } from '@/lib/replay/rosterLogic'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import type { ReplayWindowBounds } from '../model/replayWindow'

const film = { ally: { score: 100 }, enemy: { score: 43 } }

describe('exportFinalScore', () => {
  it('prefers the score served by the API when it exists', () => {
    expect(exportFinalScore({ ally: 2, enemy: 1 }, film)).toEqual({ ally: 2, enemy: 1 })
  })

  it('falls back to the film layer reading when the API says nothing', () => {
    expect(exportFinalScore(null, film)).toEqual({ ally: 100, enemy: 43 })
    expect(exportFinalScore(undefined, film)).toEqual({ ally: 100, enemy: 43 })
  })

  it('invents nothing when neither source speaks', () => {
    expect(exportFinalScore(null, null)).toBeNull()
  })

  it('accepts a zero: 2 rounds to 0 is a measurement, not an absence', () => {
    expect(exportFinalScore({ ally: 2, enemy: 0 }, film)).toEqual({ ally: 2, enemy: 0 })
  })
})

/**
 * ADDED 2026-09-07 — THE EXPORTED PANEL'S WORD FOLLOWS THE POINT OF VIEW, AND HAS ONLY ONE SOURCE.
 *
 * The clip used to paint its verdict with `outcome.label`, i.e. `header.outcome_label`: the
 * PAGE PLAYER's word, built by a Go map hard-coded in one language. Viewed from an opponent
 * of a won match, `readVictory` did flip the outcome and the panel's side — but the title
 * still said "Victory", above the losing team. The READ outcome's label now arrives in
 * `viewedLabel`, resolved by `useReplayCapture` (a hook; this module is pure) from the title's
 * mappings, and it is the ONLY word this module accepts: without it, silence.
 */
describe('buildOverlayPanelSource — the verdict painted into the video', () => {
  const DOC = {
    originMs: 0,
    frameIntervalMs: 100,
    scoreTimeline: normalizeScoreTimeline({ teams: [], players: [] } as never),
  } as unknown as ReplayDocumentReady & ReplayScoreDocument

  const SB = [
    { xuid: 'me', team_side: 't0', is_me: true },
    { xuid: 'them', team_side: 't1', is_me: false },
  ] as MatchScoreboardRow[]

  /** The FILM's allegiance as seen from `reference`: `me` on side 0, `them` on side 1. */
  const viewedFrom = (reference: string) =>
    buildFilmAllegiance(
      [
        { xuid: 'me', team: 0, lives: [], board: SB[0] },
        { xuid: 'them', team: 1, lives: [], board: SB[1] },
      ] as ReplayPlayer[],
      reference,
    )

  const WINDOW: ReplayWindowBounds = {
    startFrame: 0,
    leadInFrame: 0,
    endFrame: 500,
    startMs: 0,
    endMs: 50_000,
  }

  const INK = {
    background: '#000',
    foreground: '#fff',
    muted: '#888',
    border: '#444',
    card: '#222',
  }

  function panel(over: Partial<OverlayPanelDeps> = {}) {
    return buildOverlayPanelSource({
      doc: DOC,
      scoreboard: SB,
      allegiance: viewedFrom(over.viewpoint ?? 'me'),
      playWindow: WINDOW,
      outcome: { code: 2, viewedLabel: 'Victory' },
      viewpoint: null,
      locale: 'en',
      ink: INK,
      teamStyle: { background: '#111', border: '#222' },
      logo: null,
      ...over,
    }).panelAt(WINDOW.endFrame)
  }

  it('default point of view: the outcome label, as is', () => {
    expect(panel()?.status).toBe('Victory')
  })

  it("page player's point of view: the same word, nothing is flipped", () => {
    expect(panel({ viewpoint: 'me' })?.status).toBe('Victory')
  })

  it('viewed from an opponent: the FLIPPED outcome label, supplied by the wiring', () => {
    const p = panel({
      viewpoint: 'them',
      outcome: { code: 2, viewedLabel: 'Defeat' },
    })
    expect(p?.status).toBe('Defeat')
  })

  it('`viewedLabel` is `null`: no panel — never a raw key in the clip', () => {
    // The degraded case: the title's mappings give no label for the read outcome. Same
    // silence as the DOM, and no fallback to a second vocabulary.
    expect(panel({ viewpoint: 'them', outcome: { code: 2, viewedLabel: null } })).toBeNull()
  })

  it('`viewedLabel` ABSENT: no panel either — there is no other source left', () => {
    expect(panel({ outcome: { code: 2 } })).toBeNull()
  })
})
