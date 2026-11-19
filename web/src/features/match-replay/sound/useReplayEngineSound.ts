// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useReplayEngineSound — THE React SEAM of the vehicle engines, consumed by
 * `useReplaySound` (which owns the Web Audio player and the beat).
 *
 * Extracted into its own file for the same reason as the other sound sub-hooks:
 * `useReplaySound.ts` is at the size ceiling of the repository, and this wiring has a clear
 * boundary — it knows neither the event track, nor the preferences; only the engine plan
 * (`vehicleEngineSound.ts`) and its player (`vehicleEnginePlayer.ts`).
 *
 * EVERYTHING IS READ IN REFERENCES by stable callbacks: `sync` beats at each animation step
 * and must never recreate the canvas loop (same rule as `tick`).
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { soundUrlOf } from './replayAudioMix'
import type { ReplayAudioPlayer } from './replayAudio'
import { frameToMs } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { VehicleEnginePlayer } from './vehicleEnginePlayer'
import {
  planVehicleEngines,
  VEHICLE_ENGINE_BUS_GAIN,
  type EnginePlan,
} from './vehicleEngineSound'
import { engineStemsOf } from './vehicleEngineMix'

export interface ReplayEngineSound {
  /** The stems to PRELOAD with the track: an engine requested at T0 would sound late. */
  stems: string[]
  /** Creates the engine player on the main player. Idempotent (called at each gesture). */
  attach: (player: ReplayAudioPlayer) => void
  /** Makes the engines follow the replay moment — to call when the track is audible. */
  sync: (ms: number) => void
  /** Turns everything off (pause, cut, muted speed, unmount): short ramp, never a click. */
  stop: () => void
  /** The plan, for the out-of-real-time export (read at call, never at render). */
  plansForExport: () => readonly EnginePlan[]
}

export function useReplayEngineSound(doc: ReplayDocumentReady): ReplayEngineSound {
  const plans = useMemo(() => planVehicleEngines(doc.vehicles, frameToMs(1, doc)), [doc])
  const stems = useMemo(() => engineStemsOf(plans), [plans])

  const engineRef = useRef<VehicleEnginePlayer | null>(null)
  const plansRef = useRef(plans)
  useEffect(() => {
    plansRef.current = plans
    // A document that changes under a living player: the plan is replaced, what was sounding
    // is turned off (setPlans stops everything), and the next playback restarts from the right
    // film.
    engineRef.current?.setPlans(plans)
  }, [plans])

  // The engine player dies WITH the component, like the main player just above.
  useEffect(() => () => {
    engineRef.current?.dispose()
    engineRef.current = null
  }, [])

  const attach = useCallback((player: ReplayAudioPlayer) => {
    if (engineRef.current) return
    const bus = player.engineBus(VEHICLE_ENGINE_BUS_GAIN, true)
    const engine = new VehicleEnginePlayer({
      ctx: bus.ctx,
      out: bus.out,
      // The main player's cache is indexed by URL; the plan speaks in stems.
      bufferOf: (stem) => bus.bufferOf(soundUrlOf(stem)),
    })
    engine.setPlans(plansRef.current)
    engineRef.current = engine
  }, [])

  const sync = useCallback((ms: number) => engineRef.current?.sync(ms), [])
  const stop = useCallback(() => engineRef.current?.stopAll(), [])
  const plansForExport = useCallback(() => plansRef.current, [])

  return { stems, attach, sync, stop, plansForExport }
}
