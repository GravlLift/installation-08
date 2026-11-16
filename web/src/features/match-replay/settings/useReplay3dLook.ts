/**
 * useReplay3dLook — LES RÉGLAGES D'ÉCLAIRAGE de la vue 3D : ombres, reflets, occlusion ambiante,
 * lumière du jeu, bloom.
 *
 * Persistés comme les calques (`usePersistedFlag`) et partagés par clé : le tiroir les bascule, la
 * vue 3D les lit de son côté, sans que la page les transporte. Tous allumés par défaut : c'est la
 * vue telle qu'elle est réglée ; les éteindre allège le rendu d'une machine modeste (l'occlusion
 * ambiante coûte le plus).
 */
import { useMemo } from 'react'

import { LOOK3D_DEFAULT, type Look3d } from '../scene3d/look3d'
import { usePersistedFlag } from './useReplaySettings'

const SHADOWS_KEY = 'replay-3d-shadows'
const REFLECTIONS_KEY = 'replay-3d-reflections'
const OCCLUSION_KEY = 'replay-3d-occlusion'
const GAME_LIGHT_KEY = 'replay-3d-game-light'
export const BLOOM_KEY = 'replay-3d-bloom'

export interface Replay3dLook {
  look: Look3d
  toggleShadows: () => void
  toggleReflections: () => void
  toggleOcclusion: () => void
  toggleGameLight: () => void
  toggleBloom: () => void
}

export function useReplay3dLook(): Replay3dLook {
  const [shadows, toggleShadows] = usePersistedFlag(SHADOWS_KEY, LOOK3D_DEFAULT.shadows)
  const [reflections, toggleReflections] = usePersistedFlag(REFLECTIONS_KEY, LOOK3D_DEFAULT.reflections)
  const [ambientOcclusion, toggleOcclusion] = usePersistedFlag(OCCLUSION_KEY, LOOK3D_DEFAULT.ambientOcclusion)
  const [gameLight, toggleGameLight] = usePersistedFlag(GAME_LIGHT_KEY, LOOK3D_DEFAULT.gameLight)
  const [bloom, toggleBloom] = usePersistedFlag(BLOOM_KEY, LOOK3D_DEFAULT.bloom)
  const look = useMemo(
    () => ({ shadows, reflections, ambientOcclusion, gameLight, bloom }),
    [shadows, reflections, ambientOcclusion, gameLight, bloom],
  )
  return { look, toggleShadows, toggleReflections, toggleOcclusion, toggleGameLight, toggleBloom }
}
