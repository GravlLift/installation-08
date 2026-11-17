// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useReplay3dFov — the game's FIELD OF VIEW setting for the 3D view (70 to 120, horizontal
 * degrees at 16:9), persisted like the lighting settings (`useReplay3dLook`) and shared by
 * key: the drawer changes it, the 3D view reads it on its own side and turns it into a base
 * vertical field (`model/fovLogic`).
 */
import { useCallback, useEffect, useState } from 'react'

import { GAME_FOV_DEFAULT, GAME_FOV_MAX, GAME_FOV_MIN } from '../model/fovLogic'
import { persistPreference, readStoredNumber, subscribePreference } from './replayPreferences'

const FOV_KEY = 'replay-3d-fov'

/** The setting's bounds, inclusive: an integer between them is a valid game field of view. */
function isGameFov(value: number): boolean {
  return value >= GAME_FOV_MIN && value <= GAME_FOV_MAX
}

export interface Replay3dFov {
  /** The game's field of view setting, in horizontal degrees at 16:9. */
  fov: number
  setFov: (fov: number) => void
}

export function useReplay3dFov(): Replay3dFov {
  const [fov, setFovState] = useState(() => readStoredNumber(FOV_KEY, GAME_FOV_DEFAULT, isGameFov))
  // The subscription makes the key shareable: the drawer's slider and the 3D view move together.
  useEffect(() => subscribePreference(FOV_KEY, (raw) => {
    const value = Number(raw)
    if (Number.isFinite(value) && isGameFov(value)) setFovState(value)
  }), [])
  const setFov = useCallback((next: number) => {
    const value = Math.round(next)
    if (!isGameFov(value)) return
    setFovState(value)
    persistPreference(FOV_KEY, String(value))
  }, [])
  return { fov, setFov }
}
