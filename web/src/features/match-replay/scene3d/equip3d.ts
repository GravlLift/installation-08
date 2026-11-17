// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * equip3d.ts — LE CAMOUFLAGE ET LE SURBOUCLIER SUR LE CORPS : leurs forces à une image, lues dans
 * les épisodes d'équipement du document (`equipmentEpisodes`, par vie).
 *
 * L'épisode EST la durée de l'effet (`model/equipmentFx.ts`) : rien n'est montré hors de [t0, t1].
 * Dedans, le camouflage se fond en `CAMO_FADE_SECONDS` à son début et revient à la fin (le corps
 * s'efface puis réapparaît, comme dans le jeu) ; le surbouclier s'allume en `OVERSHIELD_FADE_SECONDS`
 * puis tient. Fonction de l'image seule.
 */
import { EQUIP_FAMILY_CAMO, EQUIP_FAMILY_OVERSHIELD } from '../model/equipmentFx'

export interface EquipFx {
  /** 0 visible, 1 camouflé. */
  camo: number
  /** 0 éteint, 1 surbouclier entier. */
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

/** ramp : la force d'un épisode à l'image `f`, montée en `rise` images, descente en `fall` images. */
function ramp(e: Episode, f: number, rise: number, fall: number): number {
  if (f < e.t0 || f > e.t1) return 0
  const up = rise > 0 ? (f - e.t0) / rise : 1
  const down = fall > 0 ? (e.t1 - f) / fall : 1
  return Math.min(1, up, down)
}

/** equipFxAt : le camouflage et le surbouclier de la vie `slot` à l'image `f` ; écrit dans `out`. */
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
