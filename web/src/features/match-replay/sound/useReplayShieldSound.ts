// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useReplayShieldSound — THE React SEAM of the followed Spartan's shield alarms
 * (`shieldSound.ts`, `shieldSoundPlayer.ts`), consumed by `useReplaySound`, which owns the Web
 * Audio player, the preference and the beat.
 *
 * Same shape as the engines' sub-hook: `attach` in the gesture that opens the player, `sync` from
 * the beat, `stop` from the pause and the cuts; everything read in references so the canvas loop
 * is never recreated. The followed player (`null` in free view: no shield is anyone's own) and the
 * film make the reader; changing either stops what sounds, and the next step crosses nothing.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { soundUrlOf } from './replayAudioMix'
import type { ReplayAudioPlayer } from './replayAudio'
import { frameToMs } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { followedShieldReader, SHIELD_SOUND_STEMS } from './shieldSound'
import { SHIELD_BUS_GAIN, ShieldSoundPlayer } from './shieldSoundPlayer'

export interface ReplayShieldSound {
  /** The stems to PRELOAD with the track; none while no player with a shield is followed. */
  stems: readonly string[]
  /** Creates the shield player on the main player. Idempotent (called at each gesture). */
  attach: (player: ReplayAudioPlayer) => void
  /** Follows the replay moment `ms`; `continuous` = this step continues the playback (not a jump). */
  sync: (ms: number, continuous: boolean) => void
  /** Silences everything (pause, cut, muted speed, unmount). */
  stop: () => void
}

const NO_STEMS: readonly string[] = []

export function useReplayShieldSound(doc: ReplayDocumentReady, followed: string | null): ReplayShieldSound {
  const read = useMemo(() => followedShieldReader(doc, followed), [doc, followed])
  const frameMs = frameToMs(1, doc)
  const readRef = useRef(read)
  const frameMsRef = useRef(frameMs)
  const shieldRef = useRef<ShieldSoundPlayer | null>(null)

  useEffect(() => {
    readRef.current = read
    frameMsRef.current = frameMs
    // Another player or another film: what sounded belonged to the one left.
    shieldRef.current?.stopAll()
  }, [read, frameMs])

  useEffect(() => () => {
    shieldRef.current?.stopAll()
    shieldRef.current = null
  }, [])

  const attach = useCallback((player: ReplayAudioPlayer) => {
    if (shieldRef.current) return
    // Dry: the game overrides the game-defined aux sends off for the whole shield branch
    // (`zoneReverb.DRY_SEND_DB`), so the zone reverb never hears it.
    const bus = player.engineBus(SHIELD_BUS_GAIN)
    shieldRef.current = new ShieldSoundPlayer({ ctx: bus.ctx, out: bus.out, bufferOf: (stem) => bus.bufferOf(soundUrlOf(stem)) })
  }, [])

  const sync = useCallback((ms: number, continuous: boolean) => {
    const shield = shieldRef.current
    if (!shield) return
    const f = frameMsRef.current
    const frame = ms / Math.max(1e-6, f)
    shield.sync(readRef.current?.(Math.floor(frame)) ?? null, frame, ms, f, continuous)
  }, [])

  const stop = useCallback(() => shieldRef.current?.stopAll(), [])

  return { stems: read ? SHIELD_SOUND_STEMS : NO_STEMS, attach, sync, stop }
}
