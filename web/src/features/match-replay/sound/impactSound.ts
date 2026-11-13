/**
 * impactSound.ts — THE IMPACT SOUND OF A GUN PROJECTILE FROM A FOOTWEAPON (rockets...).
 *
 * The table is keyed by the title's weapon_key (`WeaponLabel.key`). VEHICLE weapons do not
 * appear there: their detonation sound is declared by the title registry
 * (`vehicle_weapons.toml`, `impact_sound`) and published on `VehicleWeapon.impactSound` — the client
 * carries no vehicle weapon tag (guardrail `vehicleWeaponRegistry.guard.test.ts`).
 *
 * Only the sounds VALIDATED BY EAR are declared (renders extracted from the game, sound event
 * reconstructed layer by layer); a weapon absent from the table explodes in silence, and borrows
 * NEVER the sound of a grenade explosion (that would be asserting a weapon we do not know). To
 * declare one: add `weapon_key -> stem` below; the file
 * `static/sounds/{slug}/<stem>.ogg` must exist (guardrail `replaySoundAssets.guard.test.ts`), and
 * the playback goes through `grenadeSoundEvents`.
 */
export const IMPACT_SOUND_STEMS: Readonly<Record<string, string>> = {}

/** The stem of the impact sound of a footweapon, or `undefined` (silence). */
export function impactSoundStem(weaponKey: string): string | undefined {
  return Object.hasOwn(IMPACT_SOUND_STEMS, weaponKey) ? IMPACT_SOUND_STEMS[weaponKey] : undefined
}
