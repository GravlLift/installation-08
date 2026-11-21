// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * weaponPadFamilies.ts — WHAT DESERVES A BIG ICON ON A PEDESTAL, and why the list is written
 * rather than guessed.
 *
 * THE REQUEST IS A SCREEN ARBITRATION, word for word (balance of 2026-08-18, W4): « des
 * icônes trop petites seraient inutiles mais des trop grosses risquent de polluer » [icons
 * that are too small would be useless but ones that are too big risk polluting] — and the
 * reason for the split is given in the same sentence: « sur les socles au sol on a des
 * power-ups et des armes plus puissantes qui ont un intérêt très stratégique » [on the
 * ground pedestals we have power-ups and more powerful weapons that are of great strategic
 * interest], the racks carrying « des armes "classiques" pas game changer » ["classic"
 * weapons, not game-changers]. The size therefore follows the STAKES of the weapon, not its
 * place: the data does not distinguish a ground pedestal from a wall rack (position only).
 *
 * THE KEY IS THE `weapon_key` OF THE TITLE, never the hexadecimal of the film nor a label.
 * It is the same vocabulary as the sound bank (`weaponLabels[id].key`, set on request by
 * the service): a weapon family enters it by its canonical identifier, stable and bilingual
 * downstream. An identifier the title does not catalog has no key — it therefore stays
 * CLASSIC, never promoted by default: enlarging what one cannot name would assert stakes
 * that nothing establishes.
 *
 * THIS LIST IS THE RULE, NOT THE SURVEY OF A CORPUS. It is written BEFORE the measurement
 * and holds for the matches to come: a pedestal that would carry a power weapon never seen
 * in the four witnesses must be big from the first hit.
 *
 * NOT EVERY PEDESTAL IS A WEAPON (schema 17, 2026-08-19): a POWER-UP pedestal publishes an
 * EQUIPMENT family and not a weapon identifier. The second table of this file
 * (`PAD_EQUIPMENT_FAMILIES`) names them one by one, and it is that table — never a prefix
 * test — that decides a key is not to be looked for in `weaponLabels`.
 */

/** The two pedestal icon sizes. `power` = big, `classic` = small. */
export type PadScale = 'power' | 'classic'

/**
 * THE THREE NATURES OF A PEDESTAL (user feedback of 2026-08-26: « une couleur pour chaque
 * type, en respectant les couleurs accessibles » [a color for each type, while respecting
 * accessible colors]).
 *
 * IT IS NOT THE SIZE, and that is why it has its own type. `PadScale` answers "is it
 * strategic?" and has only two values: a power-up and a sniper are both BIG. The nature,
 * it, answers "what is it?" and distinguishes three — a bonus you pick up, a power weapon,
 * an ordinary rack. Confusing them would force tinting the overshield and the sword alike.
 *
 * THE ORDER OF RESOLUTION IS THE SAME AS EVERYWHERE IN THIS FILE: the equipment families
 * table first (it alone knows a key is not a weapon), the power weapons registry next, the
 * ordinary fallback last.
 */
export type PadFamily = 'powerup' | 'power' | 'classic'

/**
 * padFamilyOf — the nature of a pedestal, from what it carries.
 *
 * `key` is the canonical key of the title (`weaponLabels[id].key`), absent for a weapon
 * out of catalog: a pedestal one cannot name stays `classic`, never promoted — the same
 * cautious rule as `padScaleOf` just below.
 */
export function padFamilyOf(weapon: string, key: string | null | undefined): PadFamily {
  if (padEquipmentFamilyOf(weapon)) return 'powerup'
  return key && POWER_PAD_WEAPON_KEYS.includes(key) ? 'power' : 'classic'
}

/**
 * THE POWER WEAPONS AND THE POWER-UPS, named one by one (user request of 08/18: « liste
 * EXPLICITE » [EXPLICIT list]). They are the `weapon_key` of the title registry
 * (`config/titles/halo_infinite/mappings/weapon_names.toml`) — a guard-rail verifies them
 * there.
 *
 * THE TWO POWER-UPS WERE THERE BEFORE HAVING A MEASURED MEMBER, and the bet is kept. They
 * were written on 2026-08-18 on the user's request alone — the corpus of eleven films then
 * showed only ONE overshield placement and ONE camouflage one, both DROPPED ON DEATH,
 * published by another channel of the document (`equipmentPlacements`). On 2026-08-19, the
 * `ti=37` path found their pedestal: a `powerup_overshield` at the center of Catalyst,
 * published in `weaponPads` (schema 17). They are therefore BIG without having to go back
 * to them.
 *
 * THESE ARE EQUIPMENT FAMILY KEYS, not weapon keys, and they therefore join NO table of
 * `weaponLabels`: `PAD_EQUIPMENT_FAMILIES`, below, says what the layer does with them
 * (size, label, thumbnail).
 */
export const POWER_PAD_KEYS: readonly string[] = [
  // Power weapons — the title's weapon registry.
  'hinf_s7_sniper',
  'hinf_energy_sword',
  'hinf_gravity_hammer',
  'hinf_m41_spnkr',
  'hinf_fuel_rod_spnkr',
  'hinf_skewer',
  'hinf_cindershot',
  // Power-ups — equipment families (cf. `PAD_EQUIPMENT_FAMILIES`: a measured pedestal carries one).
  'powerup_overshield',
  'powerup_camo',
]

/** The keys of POWER_PAD_KEYS that come from the title's WEAPONS registry (guard-rail). */
export const POWER_PAD_WEAPON_KEYS: readonly string[] = POWER_PAD_KEYS.filter(
  (k) => !k.startsWith('powerup_'),
)

/**
 * padScaleOf — the size of a pedestal from the canonical key of what it carries.
 *
 * Key absent (weapon out of the title's catalog, or artifact served without a readable
 * catalog) = `classic`: the default is the small size, in both directions of the rule.
 */
export function padScaleOf(key: string | null | undefined): PadScale {
  return key && POWER_PAD_KEYS.includes(key) ? 'power' : 'classic'
}

// --- THE NON-WEAPON FAMILIES OF A PEDESTAL ---------------------------------------------------

/**
 * WHAT A PEDESTAL CARRIES WHEN IT IS NOT A WEAPON — and why a second table was needed.
 *
 * SINCE SCHEMA 17 (2026-08-19), `weaponPads[].weapon` is not always the hexadecimal of a
 * weapon family: a POWER-UP pedestal publishes the FAMILY of the equipment manifest
 * (`powerup_overshield`), because `weaponLabels` is a WEAPONS table where no equipment
 * identifier enters (cf. `gwPadWeaponID`, on the Go side). The layer joined that key to
 * `weaponLabels`: it was not there, so the pedestal stayed SMALL, without a thumbnail, and
 * the tooltip displayed the raw string "powerup_overshield".
 *
 * A WRITTEN TABLE, NOT A PREFIX TEST. Recognizing "it starts with `powerup_`" would have
 * worked today and lied tomorrow: the title manifest carries fifteen equipment families
 * (`wall`, `sensor`, `grenade_*`...), and nothing says the next ones to mount on a
 * pedestal will be called `powerup_*`. A key absent from this table is therefore still
 * treated as a weapon identifier — the previous behavior, unchanged.
 */
export interface PadEquipmentFamily {
  /**
   * Stem of the HUD thumbnail, served under `static/weapons-assets/{slug}/hud/`.
   *
   * IT IS THE IMAGE THE TITLE MANIFEST ALREADY NAMES for the ability of the same name
   * (`icon = "hud/Overshield"` in `replay_labels.toml`): the manifest declares no icon on
   * its `[[equipment_objects]]`, but it names this one elsewhere, and it is the same mask.
   * The guard-rail replays both — the delivered file AND the manifest line.
   */
  icon: string
}

/** The NON-WEAPON families known to the pedestals layer. The typing carries the FR/EN parity. */
export type PadEquipmentFamilyKey =
  | 'powerup_overshield'
  | 'powerup_camo'
  | 'repulsor'
  | 'translocator_beacon'
  | 'wall'
  | 'grapple'
  | 'sensor'
  | 'thruster'
  | 'shroud_screen'

/**
 * THE TABLE. Its keys are the families published by the document, and the POWER-UPS among
 * them figure in `POWER_PAD_KEYS` (guard-rail): a pedestal power-up is BIG, without a
 * doubled rule.
 *
 * SINCE THE EQUIPMENT REPLAYS (2026-11): the film also mounts the carried equipment on
 * pedestals, publishing its family (`repulsor`, `translocator_beacon`, `wall`, `grapple`,
 * `sensor`, `thruster`). Their icons are the SAME HUD masks the title manifest names for
 * the abilities of the same family (`hud/Repulsor`, `hud/DropWall`, ... in
 * `replay_labels.toml`) — the manifest declares no icon on its `[[equipment_objects]]`
 * either, and the delivered files exist under `static/weapons-assets/{slug}/hud/`.
 */
export const PAD_EQUIPMENT_FAMILIES: Readonly<Record<PadEquipmentFamilyKey, PadEquipmentFamily>> = {
  powerup_overshield: { icon: 'Overshield' },
  powerup_camo: { icon: 'ActiveCamouflage' },
  repulsor: { icon: 'Repulsor' },
  translocator_beacon: { icon: 'QuantumTranslocator' },
  wall: { icon: 'DropWall' },
  grapple: { icon: 'Grappleshot' },
  sensor: { icon: 'ThreatSensor' },
  thruster: { icon: 'Thruster' },
  shroud_screen: { icon: 'ShroudScreen' },
}

/**
 * displayKeyOf — the READABLE NAME of a key the document does not name: the key with its
 * underscores turned into spaces and each word title-cased (`translocator_beacon` ->
 * `Translocator Beacon`). The raw key is never the final answer of a tooltip: it is a
 * defect marker, and this shape keeps it recognizable without the machine writing.
 */
export function displayKeyOf(key: string): string {
  return key
    .split('_')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ')
}

/**
 * padEquipmentFamilyOf — the non-weapon family of a pedestal, or null when the key is not
 * one.
 *
 * `hasOwnProperty` and not `in`: `'constructor'` is a perfectly possible pedestal key on
 * a future title, and an identifier inherited from the prototype would return a family
 * that does not exist.
 */
export function padEquipmentFamilyOf(weapon: string): PadEquipmentFamilyKey | null {
  return Object.prototype.hasOwnProperty.call(PAD_EQUIPMENT_FAMILIES, weapon)
    ? (weapon as PadEquipmentFamilyKey)
    : null
}
