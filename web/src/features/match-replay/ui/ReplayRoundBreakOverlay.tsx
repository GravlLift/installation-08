// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** Show a non-interactive round-end message at the film's current frame.
 * Round boundaries use the score timeline's clock guard and the end of the previous round,
 * shared with the round-over sound. A frame window keeps seeking and pausing deterministic. */
import { useMemo } from 'react'

import { scoreTimelineOf } from '@/lib/replay/scoreTimeline'

import { msToFrames } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
const OVERLAY_STATUS_NEUTRAL = 'rounded bg-card px-4 py-2 text-foreground'
import { activeRoundTransition, roundTransitions } from '../model/roundsLogic'
import { REPLAY_TEXT, type ReplayLocale } from '../i18n/i18n'

/** Display duration in match milliseconds, converted to frames for the replay. */
export const ROUND_BREAK_WINDOW_MS = 3000

interface Props {
  /** Replay document containing round boundaries and frame interval. */
  doc: ReplayDocumentReady
  /** Current playback frame. */
  frame: number
  locale: ReplayLocale
}

export function ReplayRoundBreakOverlay({ doc, frame, locale }: Props) {
  const t = REPLAY_TEXT[locale]
  const transitions = useMemo(() => roundTransitions(scoreTimelineOf(doc)), [doc])
  const windowFrames = useMemo(
    () => Math.max(1, Math.round(msToFrames(ROUND_BREAK_WINDOW_MS, doc))),
    [doc],
  )
  const active = activeRoundTransition(transitions, frame, windowFrames)
  if (!active) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden"
    >
      {/* Round endings are neutral and do not imply a winner. */}
      <p className={OVERLAY_STATUS_NEUTRAL}>{t.roundOverFmt(active.endedIndex)}</p>
    </div>
  )
}
