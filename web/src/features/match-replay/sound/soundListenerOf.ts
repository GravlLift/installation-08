// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** The followed player's position and heading serve as the export's audio listener. */
import { isAliveAt, msToFrames, positionAt, trackWindow } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady, ReplayTrackReady } from '../../../lib/replay/replayNormalize'
import { buildLivesByXuid, deathWindowFrames } from '../model/livesPosition'
import { headingAt } from '../model/headingInterp'
import type { SoundListener } from './soundSpatial'

/** Use the active life, or the most recently ended life within the death window. */
function lifeOfXuidAt(
  lives: ReplayTrackReady[] | undefined,
  frame: number,
  deathFrames: number,
): ReplayTrackReady | null {
  if (!lives || lives.length === 0) return null
  for (const l of lives) {
    if (isAliveAt(l, frame)) return l
  }
  let best: ReplayTrackReady | null = null
  let bestD = Number.POSITIVE_INFINITY
  for (const l of lives) {
    const d = frame - trackWindow(l).end
    if (d >= 0 && d <= deathFrames && d < bestD) {
      bestD = d
      best = l
    }
  }
  return best
}

/** Build the life index once for the listener lookup used by every audio event. */
export function listenerAtOfPlayer(doc: ReplayDocumentReady, xuid: string): (ms: number) => SoundListener | null {
  const lives = buildLivesByXuid(doc.tracks)
  const window = deathWindowFrames(doc)
  return (ms: number) => {
    const frame = Math.round(msToFrames(ms, doc))
    const life = lifeOfXuidAt(lives.get(xuid), frame, window)
    if (!life) return null
    const pos = positionAt(life.points, frame)
    if (!pos) return null
    return { x: pos.x, y: pos.y, heading: headingAt(life.points, frame) ?? 0 }
  }
}
