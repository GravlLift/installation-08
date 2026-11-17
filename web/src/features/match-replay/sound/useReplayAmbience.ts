// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useReplayAmbience — THE React SEAM of the map's ambient bed (`ambienceBed.ts`), consumed by
 * `useReplaySound`, which owns the Web Audio player, the preference and the beat.
 *
 * Same shape as the engines' sub-hook (`useReplayEngineSound.ts`): `attach` in the gesture that
 * opens the player, `setAudible` from the beat and the transport, everything read in references
 * so the canvas loop is never recreated.
 */
import { useCallback, useEffect, useRef } from 'react'

import type { ReplayAudioPlayer } from './replayAudio'
import { AMBIENCE_BUS_GAIN, AmbienceBedPlayer } from './ambienceBed'

export interface ReplayAmbience {
  /** Creates the bed on the main player. Idempotent (called at each gesture). */
  attach: (player: ReplayAudioPlayer) => void
  /** Starts or stops the loop; cheap to call at every animation step. */
  setAudible: (audible: boolean) => void
}

export function useReplayAmbience(url: string | null | undefined): ReplayAmbience {
  const bedRef = useRef<AmbienceBedPlayer | null>(null)
  const playerRef = useRef<ReplayAudioPlayer | null>(null)
  const urlRef = useRef(url ?? null)

  const create = useCallback((player: ReplayAudioPlayer) => {
    const u = urlRef.current
    bedRef.current = u ? new AmbienceBedPlayer(player.engineBus(AMBIENCE_BUS_GAIN), u) : null
  }, [])

  // Another match under a living player: the old bed stops, the new one loads on the same player.
  useEffect(() => {
    if (urlRef.current === (url ?? null)) return
    urlRef.current = url ?? null
    bedRef.current?.dispose()
    bedRef.current = null
    if (playerRef.current) create(playerRef.current)
  }, [url, create])

  // The bed dies with the component, like the main player.
  useEffect(() => () => {
    bedRef.current?.dispose()
    bedRef.current = null
  }, [])

  const attach = useCallback((player: ReplayAudioPlayer) => {
    if (playerRef.current === player) return
    playerRef.current = player
    bedRef.current?.dispose()
    create(player)
  }, [create])

  const setAudible = useCallback((audible: boolean) => bedRef.current?.setAudible(audible), [])

  return { attach, setAudible }
}
