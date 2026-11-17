// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useReplay3dLook — the LIGHTING SETTINGS of the 3D view: shadows, reflections, ambient
 * occlusion, game light, bloom, animation of glowing surfaces.
 *
 * Persisted like the layers (`usePersistedFlag`) and shared by key: the drawer toggles them,
 * the 3D view reads them on its own side, without the page carrying them. All on by default:
 * this is the view as it is tuned; turning them off lightens the render on a modest machine
 * (ambient occlusion costs the most).
 */
import { useMemo } from 'react'

import { LOOK3D_DEFAULT, type Look3d } from '../scene3d/look3d'
import { usePersistedFlag } from './useReplaySettings'

const SHADOWS_KEY = 'replay-3d-shadows'
const REFLECTIONS_KEY = 'replay-3d-reflections'
const OCCLUSION_KEY = 'replay-3d-occlusion'
const GAME_LIGHT_KEY = 'replay-3d-game-light'
export const BLOOM_KEY = 'replay-3d-bloom'
export const GLOW_ANIMATION_KEY = 'replay-3d-glow-animation'

export interface Replay3dLook {
  look: Look3d
  toggleShadows: () => void
  toggleReflections: () => void
  toggleOcclusion: () => void
  toggleGameLight: () => void
  toggleBloom: () => void
  toggleGlowAnimation: () => void
}

export function useReplay3dLook(): Replay3dLook {
  const [shadows, toggleShadows] = usePersistedFlag(SHADOWS_KEY, LOOK3D_DEFAULT.shadows)
  const [reflections, toggleReflections] = usePersistedFlag(REFLECTIONS_KEY, LOOK3D_DEFAULT.reflections)
  const [ambientOcclusion, toggleOcclusion] = usePersistedFlag(OCCLUSION_KEY, LOOK3D_DEFAULT.ambientOcclusion)
  const [gameLight, toggleGameLight] = usePersistedFlag(GAME_LIGHT_KEY, LOOK3D_DEFAULT.gameLight)
  const [bloom, toggleBloom] = usePersistedFlag(BLOOM_KEY, LOOK3D_DEFAULT.bloom)
  const [glowAnimation, toggleGlowAnimation] = usePersistedFlag(GLOW_ANIMATION_KEY, LOOK3D_DEFAULT.glowAnimation)
  const look = useMemo(
    () => ({ shadows, reflections, ambientOcclusion, gameLight, bloom, glowAnimation }),
    [shadows, reflections, ambientOcclusion, gameLight, bloom, glowAnimation],
  )
  return { look, toggleShadows, toggleReflections, toggleOcclusion, toggleGameLight, toggleBloom, toggleGlowAnimation }
}
