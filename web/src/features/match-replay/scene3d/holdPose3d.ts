// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * holdPose3d.ts — THE FILM MIX OF A HELD PLAYER (docs/design/hold.md, unit H2b).
 *
 * Pure on the mix: no scene. `holdMix` fades the film's own layers out by the hold's weight and
 * appends the hold clip as a base layer, so the base weights keep summing to 1 (`ClipMix`,
 * `clipSample3d`): a bone the film fades from falls back to rest for the hold's share, and the
 * hold clip takes exactly that share. While the pose clip loads, the clip is null and the film's
 * pose is left as it was; the scene redraws when the clip arrives (`PoseClips.onLoad`), so the
 * pose then fades to the hold.
 */
import { type ClipMix } from './clipSample3d'
import { type SpartanClip } from './clips3d'
import { type HoldState } from './hold3d'

/**
 * holdMix fades `film` out by `state.weight` (every base and over layer) and, when `holdClip` is
 * non-null and the base has room, appends it as a base layer at `state.clipTimeS`, looped by
 * `loop`; mutates `film` and returns it. A null clip leaves `film` untouched; a full base skips
 * the append without throwing (the film is faded, the hold clip waits for a free slot).
 */
export function holdMix(film: ClipMix, holdClip: SpartanClip | null, state: HoldState, loop: boolean): ClipMix {
  if (holdClip === null) return film
  const scale = 1 - state.weight
  for (let i = 0; i < film.baseCount; i++) film.base[i].weight *= scale
  for (let i = 0; i < film.overCount; i++) film.over[i].weight *= scale
  if (film.baseCount < film.base.length) {
    const layer = film.base[film.baseCount++]
    layer.clip = holdClip
    layer.time = state.clipTimeS
    layer.weight = state.weight
    layer.loop = loop
  }
  return film
}
