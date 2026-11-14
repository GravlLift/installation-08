/** Select the exported victory or round-break panel using the same readings as the viewer.
 * A match-ending verdict takes precedence when the final round ends at the same frame. */
import { meXUIDOf } from '@/features/match-view/xuidMeta'
import type { MatchScoreboardRow } from '@/lib/api/types'
import type { FilmAllegiance } from '@/lib/replay/filmAllegiance'
import { campLabel } from '@/lib/replay/replayCamps'
import { scoreTimelineOf, type ReplayScoreDocument } from '@/lib/replay/scoreTimeline'

import { ROUND_BREAK_WINDOW_MS } from '../ui/ReplayRoundBreakOverlay'
import { REPLAY_TEXT, type ReplayLocale } from '../i18n/i18n'
import type { OverlayInk, OverlayPanel, OverlayStatusStyle } from './overlayPaint'
import { neutralStatusStyle } from './overlayPaint'
import { msToFrames } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import type { ReplayWindowBounds } from '../model/replayWindow'
import { activeRoundTransition, roundTransitions } from '../model/roundsLogic'
import { readScoreBanner } from '../model/scoreBannerLogic'
import { readVictory, type FinalScoreReading } from '../model/victoryLogic'

/** Prefer the API's final round score; otherwise use the film score at the end frame. */
export function exportFinalScore(
  fromAPI: FinalScoreReading | null | undefined,
  fromFilm: { ally: { score: number }; enemy: { score: number } } | null,
): { ally: number; enemy: number } | null {
  if (fromAPI) return fromAPI
  return fromFilm ? { ally: fromFilm.ally.score, enemy: fromFilm.enemy.score } : null
}

/** The match outcome as read by the page. */
export interface ExportOutcome {
  code: number | null | undefined
  /** Outcome label for the selected viewpoint; absent labels suppress the panel. */
  viewedLabel?: string | null
  /** API final round score, or null to use the film score. */
  finalScore?: FinalScoreReading | null
}

/** Inputs resolved once per export. */
export interface OverlayPanelDeps {
  doc: ReplayDocumentReady & ReplayScoreDocument
  /** Scoreboard identifies the page player and names each team. */
  scoreboard: readonly MatchScoreboardRow[]
  /** Film allegiance from the selected viewpoint. */
  allegiance: FilmAllegiance
  playWindow: ReplayWindowBounds | null
  outcome: ExportOutcome | null
  /** Selected viewpoint, or the page player when absent. */
  viewpoint?: string | null
  locale: ReplayLocale
  ink: OverlayInk
  /** The selected player's team style; ties use the neutral style instead. */
  teamStyle: OverlayStatusStyle
  /** Pretinted watermark, or null when unavailable. */
  logo: CanvasImageSource | null
}

/** Precomputed panel selection for each frame. */
export interface OverlayPanelSource {
  panelAt: (frame: number) => OverlayPanel | null
}

/** Prepare constant readings and return a per-frame panel selector. */
export function buildOverlayPanelSource(deps: OverlayPanelDeps): OverlayPanelSource {
  const t = REPLAY_TEXT[deps.locale]
  const timeline = scoreTimelineOf(deps.doc)
  const transitions = roundTransitions(timeline)
  const breakFrames = Math.max(1, Math.round(msToFrames(ROUND_BREAK_WINDOW_MS, deps.doc)))
  const victory = readVictory(deps.allegiance, deps.outcome?.code, meXUIDOf(deps.scoreboard), deps.viewpoint)
  // Read the score at the match end rather than a potentially later playback frame.
  const finalScore = deps.playWindow
    ? readScoreBanner(timeline, deps.allegiance, deps.playWindow.endFrame)
    : null
  const neutral = neutralStatusStyle(deps.ink)

  const victoryPanel = (): OverlayPanel | null => {
    // A missing viewpoint-specific outcome label suppresses the victory panel.
    const label = deps.outcome?.viewedLabel
    if (!label || !victory) return null
    const mine = victory.mine
    return {
      status: label,
      // Ties have no team, logo, or team name.
      statusStyle: mine ? deps.teamStyle : neutral,
      label: mine ? campLabel({ team: mine.teamID, side: mine.teamSide }, deps.scoreboard, t) : null,
      score: exportFinalScore(deps.outcome?.finalScore, finalScore),
      logo: mine ? deps.logo : null,
      veil: true,
    }
  }

  const panelAt = (frame: number): OverlayPanel | null => {
    // Prefer the match ending, but allow the round message when no outcome is available.
    if (deps.playWindow && frame >= deps.playWindow.endFrame) {
      const fin = victoryPanel()
      if (fin) return fin
    }
    const active = activeRoundTransition(transitions, frame, breakFrames)
    if (!active) return null
    return {
      status: t.roundOverFmt(active.endedIndex),
      statusStyle: neutral,
      // Round endings do not veil the scene.
      veil: false,
    }
  }

  return { panelAt }
}
