// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * cameraChoiceLogic — the one camera state of the player, driven from the control bar's camera
 * group (camera mode segment and POV picker) and the 1 / 2 / 3 keys.
 *
 * THE RULE: free view follows no one. There is a single "free" state, reached either from the
 * Free segment or from the picker's "Free camera" entry, and the two always agree:
 *   - in free view the picker reads "Free camera", no first-person rig or HUD is drawn, and the
 *     2D cut follows the living players instead of one of them;
 *   - the player followed last stays the REFERENCE player: the free camera starts behind him,
 *     and team colors keep reading ally / enemy from his side, so nothing re-tints on the switch;
 *   - picking a player in free view follows him in the last follow mode (1st or 3rd person),
 *     and picking 1st or 3rd person follows the reference player again.
 */
import type { CameraMode3d } from '../features/match-replay/scene3d/replayScene3d'

/** The two modes that follow a player. */
export type FollowMode = Exclude<CameraMode3d, 'free'>

export interface CameraChoice {
  mode: CameraMode3d
  /** Where picking a player from free view returns. */
  lastFollow: FollowMode
  /** The reference player: followed in 1st / 3rd person, the last one followed in free view. */
  player: string | null
}

export type CameraAction =
  | { kind: 'mode'; mode: CameraMode3d }
  /** A picker choice: a player's xuid, or null for "Free camera". */
  | { kind: 'pov'; xuid: string | null }

export function reduceCameraChoice(state: CameraChoice, action: CameraAction): CameraChoice {
  if (action.kind === 'mode') {
    if (action.mode === 'free') return { ...state, mode: 'free' }
    return { ...state, mode: action.mode, lastFollow: action.mode }
  }
  if (action.xuid === null) return { ...state, mode: 'free' }
  return { ...state, player: action.xuid, mode: state.mode === 'free' ? state.lastFollow : state.mode }
}

/** The player the camera follows: null in free view. */
export function followedPlayer(state: CameraChoice): string | null {
  return state.mode === 'free' ? null : state.player
}

/** The POV picker's value: '' ("Free camera") in free view, the followed player otherwise. */
export function povPickerValue(state: CameraChoice): string {
  return followedPlayer(state) ?? ''
}
