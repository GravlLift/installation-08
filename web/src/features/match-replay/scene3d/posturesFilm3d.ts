// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { msToFrames } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

/** The millisecond end is exclusive; t1 keeps the whole-frame fade convention. */
export function filmPosture(s: ReplayDocumentReady['stances'][number], doc: ReplayDocumentReady) {
  const precise = s.kind === 'crouch' || s.kind === 'slide'
  const t0 = precise && s.ms0 !== undefined ? msToFrames(s.ms0, doc) : s.t0
  const end = precise && s.ms1 !== undefined ? msToFrames(s.ms1, doc) : undefined
  return { t0, t1: end === undefined ? s.t1 : end - 1, end, interval: { t0, t1: end ?? s.t1 } }
}
