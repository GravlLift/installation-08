import { msToFrames } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

/** La fin milliseconde est exclusive ; t1 garde la convention des fondus sur images entières. */
export function postureFilm(s: ReplayDocumentReady['stances'][number], doc: ReplayDocumentReady) {
  const precise = s.kind === 'crouch' || s.kind === 'slide'
  const t0 = precise && s.ms0 !== undefined ? msToFrames(s.ms0, doc) : s.t0
  const fin = precise && s.ms1 !== undefined ? msToFrames(s.ms1, doc) : undefined
  return { t0, t1: fin === undefined ? s.t1 : fin - 1, fin, intervalle: { t0, t1: fin ?? s.t1 } }
}
