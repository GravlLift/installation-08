// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * equip3d.ts — CAMOUFLAGE AND OVERSHIELD ON THE BODY: their strength at a frame, read from the
 * document's equipment episodes (`equipmentEpisodes`, per life).
 *
 * The episode IS the effect's duration (`model/equipmentFx.ts`): nothing is shown outside
 * [t0, t1]. Inside it, camouflage fades in over `CAMO_FADE_SECONDS` at its start and fades back
 * at the end (the body vanishes then reappears, as in the game); overshield lights up over
 * `OVERSHIELD_FADE_SECONDS` then holds. A pure function of the frame alone.
 */
import { EQUIP_FAMILY_CAMO, EQUIP_FAMILY_OVERSHIELD } from '../model/equipmentFx'

export interface EquipFx {
  /** 0 visible, 1 camouflaged. */
  camo: number
  /** 0 off, 1 full overshield. */
  overshield: number
}

export const NO_EQUIP_FX: Readonly<EquipFx> = Object.freeze({ camo: 0, overshield: 0 })

const CAMO_FADE_SECONDS = 0.4
const OVERSHIELD_FADE_SECONDS = 0.2

interface Episode {
  slot: number
  t0: number
  t1: number
  fam: string
}

/** ramp: an episode's strength at frame `f`, rising over `rise` frames, falling over `fall` frames. */
function ramp(e: Episode, f: number, rise: number, fall: number): number {
  if (f < e.t0 || f > e.t1) return 0
  const up = rise > 0 ? (f - e.t0) / rise : 1
  const down = fall > 0 ? (e.t1 - f) / fall : 1
  return Math.min(1, up, down)
}

/** equipFxAt: the camouflage and overshield of life `slot` at frame `f`; written into `out`. */
export function equipFxAt(episodes: readonly Episode[], slot: number, f: number, fps: number, out: EquipFx): EquipFx {
  out.camo = 0
  out.overshield = 0
  const camoFade = CAMO_FADE_SECONDS * fps
  const overFade = OVERSHIELD_FADE_SECONDS * fps
  for (const e of episodes) {
    if (e.slot !== slot) continue
    if (e.fam === EQUIP_FAMILY_CAMO) out.camo = Math.max(out.camo, ramp(e, f, camoFade, camoFade))
    else if (e.fam === EQUIP_FAMILY_OVERSHIELD) out.overshield = Math.max(out.overshield, ramp(e, f, overFade, 0))
  }
  return out
}
