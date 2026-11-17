// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shotImpactFx.ts — THE EXPLOSION OF A SHOT PROJECTILE (mortar, rockets, bomb...).
 *
 * THE LINK COMES FROM THE SERVER: `Projectile.shot` is the index, in `shots`, of the shot from which the projectile
 * was born (pairing by coincidence of frame and position, no ambiguity published). The
 * detonation, for its part, is the one that the film writes (`detoT/detoX/detoY`, `detoLue` true).
 *
 * WHAT DECIDES AN EXPLOSION IS A FACT DECLARED PER WEAPON, `impact`, published by the title on the
 * label of the foot weapon (`WeaponLabel.impact`) or on the entry of the vehicle registry
 * (`VehicleWeapon.impact`). NEVER the render shape `fx`: the mortar of the Wraith is `plasma` like
 * the plasma pistol, which does not explode, and the gun of the Scorpion is `explosive` without projectile
 * published. Guardrail: shotImpactFx.test.ts.
 *
 * Clean degradations, without error: a projectile without `shot` (artifact prior to schema 104,
 * grenade, bullet without published shot), an out-of-bounds shot, a weapon without `impact`, a detonation
 * not read (`detoLue` false: fallback to the last position, not a read explosion) place nothing.
 *
 * The entries join those of the grenades (`GrenadeRestFx`): SAME layer, SAME timeline, SAME
 * seed, SAME layer switch. No React, no canvas: pure logic.
 */
import { fxTintOf, type FxTint } from '../layers/fxInk'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { buildGrenadeRestFx, explosionSeedOf, type GrenadeRestFx } from './grenadeFx'
import { vehicleWeaponOf } from './vehicleWeaponRegistry'
import { impactSoundStem } from '../sound/impactSound'

/** Nature of the deflagration of a shot projectile whose weapon declares no tint. */
const DEFAULT_IMPACT_TINT: FxTint = 'blast'

/** What the document says about the explosion of a weapon: its nature, and the stem of its sound (absent = silent). */
interface ImpactReading {
  tint: FxTint
  impactStem?: string
}

/**
 * impactOf reads, for the weapon key `w` of a shot, the fact « its projectile explodes ». The registry
 * of foot weapons first, that of vehicle weapons next — the same order as the style of the
 * shots (`buildShotFx`). `null` = no explosion.
 */
function impactOf(doc: ReplayDocumentReady, w: string | undefined): ImpactReading | null {
  if (!w) return null
  const label = doc.weaponLabels?.[w]
  if (label) {
    if (!label.impact) return null
    return { tint: tintOrDefault(label.tint), impactStem: impactSoundStem(label.key || w) }
  }
  const vehicle = vehicleWeaponOf(doc, w)
  if (!vehicle?.impact) return null
  return { tint: tintOrDefault(vehicle.tint), impactStem: vehicle.impactSound || undefined }
}

function tintOrDefault(raw: string | undefined): FxTint {
  const tint = fxTintOf(raw)
  return tint === 'neutral' ? DEFAULT_IMPACT_TINT : tint
}

/**
 * buildShotImpactFx links each projectile to the explosion of ITS shot, when the weapon of the shot declares
 * `impact` and the detonation has been READ in the film.
 */
export function buildShotImpactFx(doc: ReplayDocumentReady): GrenadeRestFx[] {
  const out: GrenadeRestFx[] = []
  for (const pr of doc.projectiles) {
    if (pr.shot === undefined || pr.shot === null || !pr.detoLue) continue
    const shot = doc.shots[pr.shot]
    if (!shot) continue
    const impact = impactOf(doc, shot.w)
    if (!impact) continue
    out.push({
      frame: pr.detoT,
      x: pr.detoX,
      y: pr.detoY,
      rank: -1,
      rest: !!pr.rest,
      seed: explosionSeedOf(pr.detoT),
      tint: impact.tint,
      impactStem: impact.impactStem,
    })
  }
  return out
}

/** All the explosive ends of flight of the film: those of the grenades, then those of the shots. The screen
 *  and the sound read THIS list, never two parallel datings. */
export function buildRestFx(doc: ReplayDocumentReady): GrenadeRestFx[] {
  return [...buildGrenadeRestFx(doc), ...buildShotImpactFx(doc)]
}
