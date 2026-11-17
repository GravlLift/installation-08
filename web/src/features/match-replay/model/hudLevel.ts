// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * hudLevel — how much of the HUD (`ReplayAth3d`) a view draws, from the drawing view and the
 * camera mode:
 *   - 'full'      first person: everything (reticle and scope overlays included);
 *   - 'noReticle' third person, following a player: his whole HUD (weapon corner, grenades,
 *                 shield, kill feed, kill popups, score strip) but no reticle, scope mask,
 *                 Bandit zoom frame or red-reticle state, which describe a first-person aim;
 *   - 'spectator' free view, following no one: the score strip and the kill feed;
 *   - 'score'     the 2D top-down view: the score strip alone (the kill feed would sit over
 *                 the map's lower left, where players are drawn).
 */
import type { CameraMode3d } from '../scene3d/replayScene3d'
import type { SceneView3d } from '../scene3d/topDownLogic'

export type HudLevel = 'full' | 'noReticle' | 'spectator' | 'score'

export function hudLevelOf(view: SceneView3d, mode: CameraMode3d): HudLevel {
  if (view === 'top') return 'score'
  if (mode === 'fp') return 'full'
  return mode === 'tp' ? 'noReticle' : 'spectator'
}
