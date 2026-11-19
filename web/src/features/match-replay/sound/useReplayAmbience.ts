// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useReplayAmbience — THE React SEAM of the map's ambient beds (`ambienceBed.ts`), consumed by
 * `useReplaySound`, which owns the Web Audio player, the preference and the beat.
 *
 * Same shape as the engines' sub-hook (`useReplayEngineSound.ts`): `attach` in the gesture that
 * opens the player, `setAudible` from the beat and the transport, `setListener` from the same
 * tick with the camera's listener, everything read in references so the canvas loop is never
 * recreated.
 */
import { useCallback, useEffect, useRef } from 'react'

import type { ReplayAudioPlayer } from './replayAudio'
import { AMBIENCE_BUS_GAIN, AmbienceZonesPlayer } from './ambienceBed'
import type { SoundListener } from './soundSpatial'

/** The two ambience routes of a match: the layout and one file per loop. */
export interface AmbienceUrls {
  layoutUrl: string
  fileUrl: (file: string) => string
}

export interface ReplayAmbience {
  /** Creates the beds on the main player. Idempotent (called at each gesture). */
  attach: (player: ReplayAudioPlayer) => void
  /** Starts or stops the beds; cheap to call at every animation step. */
  setAudible: (audible: boolean) => void
  /** Tells where the listener stands (or that there is none, 2D view); cheap to call every frame. */
  setListener: (pos: SoundListener | null) => void
}

export function useReplayAmbience(urls: AmbienceUrls | null | undefined): ReplayAmbience {
  const bedsRef = useRef<AmbienceZonesPlayer | null>(null)
  const playerRef = useRef<ReplayAudioPlayer | null>(null)
  const urlsRef = useRef(urls ?? null)

  const create = useCallback((player: ReplayAudioPlayer) => {
    const u = urlsRef.current
    bedsRef.current = u ? new AmbienceZonesPlayer(player.engineBus(AMBIENCE_BUS_GAIN), u.layoutUrl, u.fileUrl) : null
  }, [])

  // Another match under a living player: the old beds stop, the new ones load on the same player.
  useEffect(() => {
    if (urlsRef.current === (urls ?? null)) return
    urlsRef.current = urls ?? null
    bedsRef.current?.dispose()
    bedsRef.current = null
    if (playerRef.current) create(playerRef.current)
  }, [urls, create])

  // The beds die with the component, like the main player.
  useEffect(() => () => {
    bedsRef.current?.dispose()
    bedsRef.current = null
  }, [])

  const attach = useCallback((player: ReplayAudioPlayer) => {
    if (playerRef.current === player) return
    playerRef.current = player
    bedsRef.current?.dispose()
    create(player)
  }, [create])

  const setAudible = useCallback((audible: boolean) => bedsRef.current?.setAudible(audible), [])
  const setListener = useCallback((pos: SoundListener | null) => bedsRef.current?.setListener(pos), [])

  return { attach, setAudible, setListener }
}
