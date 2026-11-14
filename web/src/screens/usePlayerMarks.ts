/**
 * usePlayerMarks — the selected player's events for the scrub bar (`scrubMarks`) and the
 * previous / next event step the `[` / `]` keys and the bar's buttons share. The selected
 * player is the camera's reference player: the followed one, or in free view the last one
 * followed.
 */
import { useCallback, useMemo, type RefObject } from 'react'

import type { ReplayKill } from '../features/match-replay/model/killFeedLogic'
import { displayPlayerName } from '../lib/players/displayName'
import { framesPerSecond } from '../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../lib/replay/replayNormalize'
import { nextEventFrame, playerEvents, previousEventFrame, type PlayerEvent, type ScrubMedal } from './scrubMarks'

export interface UsePlayerMarksParams {
  doc: ReplayDocumentReady
  player: string | null
  kills: readonly ReplayKill[]
  medals: readonly ScrubMedal[]
  /** The page's name of a player (roster first), as the kill feed shows it. */
  nameOfXuid: (xuid: string) => string | null
  frameRef: RefObject<number>
  onSeek: (frame: number) => void
}

export function usePlayerMarks(p: UsePlayerMarksParams): { events: PlayerEvent[]; stepEvent: (direction: -1 | 1) => void } {
  const { doc, player, kills, medals, nameOfXuid, frameRef, onSeek } = p
  const events = useMemo(
    () => playerEvents(player, kills, medals, (xuid, fallback) => displayPlayerName((xuid ? nameOfXuid(xuid) : null) ?? fallback, xuid)),
    [player, kills, medals, nameOfXuid],
  )
  const stepEvent = useCallback((direction: -1 | 1) => {
    const fps = framesPerSecond(doc)
    const frame = frameRef.current ?? 0
    const target = direction > 0
      ? nextEventFrame(events, frame, fps, doc.frameCount)
      : previousEventFrame(events, frame, fps, doc.frameCount)
    if (target !== null) onSeek(target)
  }, [doc, events, frameRef, onSeek])
  return { events, stepEvent }
}
