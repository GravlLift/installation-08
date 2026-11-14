/**
 * vehicleWeaponRegistry.ts — THE READER OF THE VEHICLE WEAPON REGISTRY (schema 69, replay
 * feedback of 2026-09-23, lot M4a). THE ONLY replay file that reads `doc.vehicleWeapons`.
 *
 * WHAT IT REPLACES. Three CLIENT tables — the style (`vehicleShotFx.ts`), the sound
 * (`vehicleShotSound.ts`) and the mount (`vehicleWeaponMounts.ts`) — were keyed by `weap` tags
 * read in the game module (lot V3F) and recopied here under the template `0x<tag>00000000`:
 * measurement of 2026-09-23 on the 111 documents of the park, 7 of the 11 keys appeared in
 * NO document, 3 tags actually published were missing from them, and the Rockethog was
 * silent. The TITLE now declares these weapons
 * (`config/titles/{slug}/mappings/vehicle_weapons.toml`, key = tag OBSERVED in a film,
 * proof attached, Go guard-rail on a fixture dated from the park) and the server publishes,
 * on request, only the weapons the document's shots use — keyed by the SAME key of the shot
 * (`Shot.w`). The client has no tag left to know, no template to reassemble: a guard-rail
 * (`vehicleWeaponRegistry.guard.test.ts`) forbids any vehicle weapon tag literal in the
 * replay code.
 *
 * A WEAPON ABSENT FROM THE REGISTRY keeps the neutral rendering and the silence — never the
 * style, sound or mount of a neighbor. A SOUND absent on a present weapon is a DECIDED
 * silence (the registry carries the reason on the server side).
 */
import type { ReplayVehicleWeapon } from '@/lib/api/types'

import type { FxTint } from '../layers/fxInk'
import type { ShotFamily } from '../layers/shotEffects'
import type { VehicleMountClass, VehicleWeaponMount } from './vehicleWeaponMounts'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'

/** The style of a shot: the SHAPE of the spark and the NATURE of the discharge (title lists). */
export interface VehicleShotStyle {
  fx: ShotFamily
  tint: FxTint
}

/**
 * VEHICLE_WEAPON_AIM_CLASS — the published aim class (`fixed` / `turret`, English like every
 * enumeration of the contract) to that of the layer's geometry. An unknown value has no
 * class: no mount, fallback to the vehicle's center.
 */
const VEHICLE_WEAPON_AIM_CLASS: Readonly<Record<string, VehicleMountClass>> = {
  fixed: 'fixe',
  turret: 'tourelle',
}

/** The registry entry of a firing weapon, or `null`. */
export function vehicleWeaponOf(
  doc: Pick<ReplayDocumentReady, 'vehicleWeapons'>,
  w: string | undefined,
): ReplayVehicleWeapon | null {
  if (!w) return null
  return doc.vehicleWeapons?.[w] ?? null
}

/**
 * vehicleShotStyleOf — the style of a vehicle weapon, or `null`. CALLED IN SECOND by
 * `buildShotFx`: a PLAYER weapon keeps the style of its registry (`weaponLabels`).
 */
export function vehicleShotStyleOf(
  doc: Pick<ReplayDocumentReady, 'vehicleWeapons'>,
  w: string | undefined,
): VehicleShotStyle | null {
  const e = vehicleWeaponOf(doc, w)
  if (!e) return null
  return { fx: e.fx as ShotFamily, tint: e.tint as FxTint }
}

/**
 * vehicleShotSoundStem — the stem of the FIRST variant of the firing sound, or `undefined`
 * (weapon absent from the registry, or decided silence). The variants attach through
 * `SOUND_VARIANTS`.
 */
export function vehicleShotSoundStem(
  doc: Pick<ReplayDocumentReady, 'vehicleWeapons'>,
  w: string | undefined,
): string | undefined {
  const stem = vehicleWeaponOf(doc, w)?.sound
  return stem ? stem : undefined
}

/**
 * vehicleWeaponMountOf — the anchor of the weapon on its vehicle's sprite, or `null` (foot
 * firing, player weapon fired from a seat, weapon without a documented mount): the spark
 * then leaves from the vehicle's center — never from an invented position. The barrel length
 * of a turret (`reach`) is 0 when the registry does not publish it.
 */
export function vehicleWeaponMountOf(
  doc: Pick<ReplayDocumentReady, 'vehicleWeapons'>,
  w: string | undefined,
): VehicleWeaponMount | null {
  const m = vehicleWeaponOf(doc, w)?.mount
  if (!m) return null
  const classe = VEHICLE_WEAPON_AIM_CLASS[m.aim]
  if (!classe) return null
  return { classe, ax: m.ax, ay: m.ay, reach: m.reach ?? 0 }
}
