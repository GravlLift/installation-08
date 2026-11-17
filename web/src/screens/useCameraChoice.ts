// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useCameraChoice — the player's camera state (`cameraChoiceLogic`), lifted to the viewer so the
 * control bar and the keyboard drive it and the 3D view only reads it. The reference player
 * starts at the default viewpoint (`useDefaultViewpoint`: the signed-in player when he is in
 * the match) until a choice is made.
 */
import { useCallback, useState } from 'react'

import type { CameraMode3d } from '../features/match-replay/scene3d/replayScene3d'
import { followedPlayer, reduceCameraChoice, type CameraAction, type FollowMode } from './cameraChoiceLogic'
import { useDefaultViewpoint, type RosterName } from './useDefaultViewpoint'

export interface CameraChoiceState {
  mode: CameraMode3d
  /** The reference player (followed, or the last followed in free view). */
  player: string | null
  /** The followed player: null in free view. */
  followed: string | null
  setMode: (mode: CameraMode3d) => void
  setPov: (xuid: string | null) => void
}

export function useCameraChoice(roster: readonly RosterName[]): CameraChoiceState {
  const [player, setPlayer] = useDefaultViewpoint(roster)
  const [modes, setModes] = useState<{ mode: CameraMode3d; lastFollow: FollowMode }>({ mode: 'fp', lastFollow: 'fp' })
  const apply = useCallback((action: CameraAction) => {
    const next = reduceCameraChoice({ ...modes, player }, action)
    setModes({ mode: next.mode, lastFollow: next.lastFollow })
    if (next.player !== player) setPlayer(next.player)
  }, [modes, player, setPlayer])
  const setMode = useCallback((mode: CameraMode3d) => apply({ kind: 'mode', mode }), [apply])
  const setPov = useCallback((xuid: string | null) => apply({ kind: 'pov', xuid }), [apply])
  return { mode: modes.mode, player, followed: followedPlayer({ ...modes, player }), setMode, setPov }
}
