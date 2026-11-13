/**
 * useReplay3dAids — LES REPÈRES D'ANALYSE de la vue 3D (`aids3d`) : lignes de tir, croix et
 * étiquettes des morts, trajectoires, rayon des explosions, câbles du grappin, flèches de poussée,
 * formes des poses, étiquettes de tous les joueurs.
 *
 * Persistés comme les réglages d'éclairage (`usePersistedFlag`) et partagés par clé : le tiroir
 * les bascule, la vue 3D les lit de son côté. Éteints par défaut : le jeu ne les montre pas.
 */
import { useMemo } from 'react'

import { AIDS3D_DEFAULT, type Aids3d } from '../scene3d/aids3d'
import { usePersistedFlag } from './useReplaySettings'

export const AIDS3D_KEYS: Readonly<Record<keyof Aids3d, string>> = {
  shotLines: 'replay-3d-shot-lines',
  deathMarkers: 'replay-3d-death-markers',
  projectilePaths: 'replay-3d-projectile-paths',
  blastRadius: 'replay-3d-blast-radius',
  grappleLines: 'replay-3d-grapple-lines',
  knockbackArrows: 'replay-3d-knockback-arrows',
  placementShapes: 'replay-3d-placement-shapes',
  allNameTags: 'replay-3d-all-name-tags',
}

export interface Replay3dAids {
  aids: Aids3d
  toggle: Readonly<Record<keyof Aids3d, () => void>>
}

/** useAidFlag — un repère, à sa clé et à son défaut. */
function useAidFlag(key: keyof Aids3d): [boolean, () => void] {
  return usePersistedFlag(AIDS3D_KEYS[key], AIDS3D_DEFAULT[key])
}

export function useReplay3dAids(): Replay3dAids {
  const [shotLines, toggleShotLines] = useAidFlag('shotLines')
  const [deathMarkers, toggleDeathMarkers] = useAidFlag('deathMarkers')
  const [projectilePaths, toggleProjectilePaths] = useAidFlag('projectilePaths')
  const [blastRadius, toggleBlastRadius] = useAidFlag('blastRadius')
  const [grappleLines, toggleGrappleLines] = useAidFlag('grappleLines')
  const [knockbackArrows, toggleKnockbackArrows] = useAidFlag('knockbackArrows')
  const [placementShapes, togglePlacementShapes] = useAidFlag('placementShapes')
  const [allNameTags, toggleAllNameTags] = useAidFlag('allNameTags')
  const aids = useMemo(
    () => ({ shotLines, deathMarkers, projectilePaths, blastRadius, grappleLines, knockbackArrows, placementShapes, allNameTags }),
    [shotLines, deathMarkers, projectilePaths, blastRadius, grappleLines, knockbackArrows, placementShapes, allNameTags],
  )
  const toggle = useMemo(
    () => ({
      shotLines: toggleShotLines,
      deathMarkers: toggleDeathMarkers,
      projectilePaths: toggleProjectilePaths,
      blastRadius: toggleBlastRadius,
      grappleLines: toggleGrappleLines,
      knockbackArrows: toggleKnockbackArrows,
      placementShapes: togglePlacementShapes,
      allNameTags: toggleAllNameTags,
    }),
    [
      toggleShotLines,
      toggleDeathMarkers,
      toggleProjectilePaths,
      toggleBlastRadius,
      toggleGrappleLines,
      toggleKnockbackArrows,
      togglePlacementShapes,
      toggleAllNameTags,
    ],
  )
  return { aids, toggle }
}
