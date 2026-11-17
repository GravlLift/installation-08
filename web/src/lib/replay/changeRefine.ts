// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * changeRefine.ts — FINE DATING of card readings (schemas 24 and 25).
 *
 * THE PROBLEM IT SOLVES, AND IT IS MEASURED. Carried weapons and the armor ability are read
 * at the film's KEYFRAMES, one every ~20 s: across the 21 899 cards of a match, the median
 * age of the weapon reading is 8.4 s, and only 7.1 % are under one second (see
 * `LoadoutReading`). Between two keyframes, the card therefore shows the BEFORE state, dimmed
 * to say so — that is honest, but it is all we knew.
 *
 * WHAT THE TWO NEW OVERLAYS BRING: the delta stream transmits the weapon-state component
 * (schema 25) and the equipment one (schema 26) AT THE CHANGE, dated to the millisecond.
 * Where a keyframe states a SAMPLED STATE, these events date the TRANSITION. The card can
 * therefore flip AT THE FRAME where the player changed weapon, instead of waiting for the next
 * reading.
 *
 * THE KEYFRAME READING STAYS THE BASE, AND THAT IS NOT A DETAIL: the delta channel is RIGHT
 * (over 5 627 shots from three films, it never removes a still-in-use weapon) but its
 * COMPLETENESS is not proven — nothing says it sees ALL the pickups (see
 * document_weapon_changes.go). Rebuilding state from the events alone would drift at the first
 * missed emission. So we start from the reading, and apply ONLY what happened AFTER it: the
 * next keyframe re-synchronizes everything, whatever happens.
 *
 * IDENTITY SUBSTITUTIONS always apply — `from` known AND present in the read row, `w` non-empty.
 * They change NEITHER the row's length NOR the order of its slots: that is the only
 * transformation that cannot misalign the drawn-slot selector (`Inventory.d`, read at ANOTHER
 * keyframe, with its own age).
 *
 * FAMILIES COMPARE BY THEIR CANONICAL FORM (schema 69, lot M3.3). The row comes from
 * `loadouts[].w` (`0x%08X`), the changes from `weaponChanges[]` (`%08x`): compared as-is, they
 * were NEVER equal, and no substitution applied on a real artifact — this module's tests wrote
 * both sides in the same case.
 *
 * A PICKUP ONTO AN OCCUPIED SLOT (`taken`, its slot `k` already held in the row) is a
 * substitution too: the slot's previous weapon left without a dated drop, and the picked one
 * takes its index. It keeps the row's length and order like any substitution.
 *
 * DROPS AND PICKUPS ON AN EMPTY SLOT apply ONLY to a PLACED row — a birth loadout, which carries
 * each weapon's slot (`k`) — and by a change that carries its own (`weaponChanges[].k`, schema
 * 69). Even then, only at the edges, so the row stays contiguous and therefore aligned on the
 * selector: a pickup on the slot that FOLLOWS the last occupied one, a drop of the LAST one.
 * Elsewhere — and on a keyframe reading, which does not place its families —, the prior
 * abstention remains the rule: a dropped weapon stays displayed, dimmed, until the next
 * reading, and no third weapon is invented.
 *
 * This whole file is PURE: no React, no document, hence testable without mounting anything —
 * same sharing as `equippedLogic.ts` and `weaponPadTime.ts`.
 */
import {
  REPLAY_NO_ABILITY_RANK,
  type ReplayEquipmentChange,
  type ReplayWeaponChange,
} from '@/lib/api/types'

/**
 * The PROVENANCE of an ability reading that comes from the changes overlay.
 *
 * A THIRD VALUE ALONGSIDE `kf` and `delta` (the two `abilities` channels), and it says
 * something neither of them says: it is not a READING of what the player carries, it is a
 * DATED EVENT that made them change. A caller that wants to distinguish them can.
 */
export const ABILITY_SRC_CHANGE = 'chg'

/** A carried-weapons reading: the row and the age of the reading that grounds it. */
export interface WeaponsReading {
  weapons: string[]
  age: number
  /** Provenance of the reading: `birth` = the birth loadout (schema 69); absent = keyframe. */
  src?: string
  /** Slot of each weapon of `weapons`, when the reading places it (birth loadout). */
  k?: number[]
}

/**
 * familyKey — the CANONICAL FORM of a weapon family (`0x%08X`), the one of `loadouts[].w` and
 * the keys of `weaponLabels`. SECOND COPY of `weaponLabelKeyOf`'s rule
 * (`features/match-replay/layers/useReplayWeaponPads.ts`): `lib/` never depends on
 * `features/`. A third copy gets centralized, with its guardrail (repo rule no. 6).
 */
function familyKey(w: string): string {
  const hex = w.startsWith('0x') || w.startsWith('0X') ? w.slice(2) : w
  if (!/^[0-9a-fA-F]{1,8}$/.test(hex)) return w
  return `0x${hex.toUpperCase().padStart(8, '0')}`
}

/**
 * refineWeaponsReading replays, on a row read at the keyframe, the DATED WEAPON CHANGES of the
 * same slot that happened since — and returns the row up to date, with the age of the last
 * evidence.
 *
 * `readFrame` is the reading's frame (`frame - age`). The events that precede it are already
 * IN the reading: replaying them would apply the same transition twice.
 *
 * A FUTURE READING IS NOT REFINED. Before a life's first keyframe, the returned reading is the
 * nearest FUTURE one and its age is NEGATIVE (see `nearestReading`): applying PAST events to
 * it would run time backwards. The caller then gets its reading unchanged.
 */
export function refineWeaponsReading(
  base: WeaponsReading,
  changes: readonly ReplayWeaponChange[],
  slot: number,
  frame: number,
): WeaponsReading {
  if (base.age < 0 || changes.length === 0) return base
  const readFrame = frame - base.age
  const rangee: Rangee = { weapons: [...base.weapons], k: base.k ? [...base.k] : undefined }
  let applied = -1
  // CHRONOLOGICAL ORDER IS MANDATORY, and the document's list does not guarantee it: two
  // substitutions on the same slot must chain in the order they happened, otherwise the card
  // would show the second-to-last weapon.
  const utiles = changes
    .filter((c) => c.slot === slot && c.t > readFrame && c.t <= frame)
    .sort((a, b) => a.t - b.t)
  for (const c of utiles) {
    if (appliquerChangement(rangee, c)) applied = c.t
  }
  if (applied < 0) return base
  // PROVENANCE DOES NOT SURVIVE AN APPLIED CHANGE (adversarial review of lot M3.3, 2026-09-24):
  // the row is no longer the birth loadout, it is that PLUS what has happened since — the
  // tooltip must no longer say "Birth loadout". `k` stays: the row stays placed.
  return { weapons: rangee.weapons, age: frame - applied, ...(rangee.k ? { k: rangee.k } : {}) }
}

/** The row being refined: its weapons and, when it is placed, their slots. */
interface Rangee {
  weapons: string[]
  k: number[] | undefined
}

/**
 * appliquerChangement applies ONE change to the row and says whether it did (see the header:
 * substitutions everywhere, pickups and drops only at the edges of a placed row).
 */
function appliquerChangement(r: Rangee, c: ReplayWeaponChange): boolean {
  const { weapons, k } = r
  if (c.w && c.from) {
    // THE ROW MUST NAME THE WEAPON BEING REPLACED. Otherwise the two readings are mismatched
    // (the reading did not carry this weapon) and we abstain — the same honesty as the
    // "in hand" highlight, which refuses to designate a slot the loadout does not carry.
    // The change's slot, when the row is placed, breaks the tie between two equal weapons.
    const from = familyKey(c.from)
    const situe = k && c.k !== undefined ? k.indexOf(c.k) : -1
    const at = situe >= 0 && familyKey(weapons[situe]) === from
      ? situe
      : weapons.findIndex((w) => familyKey(w) === from)
    if (at < 0) return false
    weapons[at] = familyKey(c.w)
    return true
  }
  if (c.w && c.k !== undefined) {
    // A PICKUP ONTO AN OCCUPIED SLOT replaces what the row says that slot held: the film emits
    // `taken` (no `from`) when the slot's previous weapon left without a dated drop, such as a
    // power weapon the game discards once it is empty. A placed row finds the slot by `k`; a
    // keyframe row is in slot order (measured 2026-11-15 on the nine local films: 13 of the 13
    // such pickups whose next keyframe shows the slot hold the picked weapon at index `k`).
    // Same transformation as a substitution: the row keeps its length and its order.
    const at = k ? k.indexOf(c.k) : c.k < weapons.length ? c.k : -1
    if (at >= 0) {
      weapons[at] = familyKey(c.w)
      return true
    }
  }
  if (!k || c.k === undefined) return false
  if (c.w) {
    // Pickup on an empty slot: only the one that FOLLOWS the last occupied one.
    if (k.includes(c.k) || c.k !== weapons.length || k.some((e, i) => e !== i)) return false
    weapons.push(familyKey(c.w))
    k.push(c.k)
    return true
  }
  // Drop: only the LAST slot, and only the weapon the change names.
  const at = k.indexOf(c.k)
  if (at < 0 || at !== weapons.length - 1) return false
  if (c.from && familyKey(weapons[at]) !== familyKey(c.from)) return false
  weapons.pop()
  k.pop()
  return true
}

/** An ability reading: the palette rank, the reading's age, and its channel. */
export interface AbilityRankReading {
  rank: number
  age: number
  src: string
}

/**
 * refineAbilityReading settles the `abilities` reading against the last EQUIPMENT CHANGE of the
 * same slot: the most RECENT of the two wins.
 *
 * SAME DOCTRINE AS THE TWO `abilities` CHANNELS ("the most recent reading wins, whatever its
 * channel"): both state the same quantity — the palette rank carried —, one by sampling, the
 * other by dated event.
 *
 * A CONSUMPTION RETURNS `null`, AND THAT IS A MEASUREMENT. The document publishes `r` at
 * `REPLAY_NO_ABILITY_RANK` on a `spent`: the player carries nothing anymore. The measurement is
 * solid — of the 17 open-door emissions in the corpus, none falls in the life's last second, so
 * it is never death that empties the slot. Returning `null` makes the card's VIGNETTE
 * DISAPPEAR, which is exactly what should be shown; keeping it until the next reading displayed
 * equipment already spent.
 *
 * A FUTURE EVENT IS NEVER READ (`c.t <= frame`): the replay knows what follows, the card is not
 * allowed to use it.
 *
 * `lifeStart` ALSO BOUNDS THE PAST (fix of 2026-09-06) — SISTER SITE OF THE SAME FLAW AS
 * `nearestReading` (`rosterLogic.ts`): before this fix, only `c.t <= frame` bounded the
 * search, and a `spent` from the PREVIOUS life of the same slot (recycled) stayed "the last
 * change", making the VIGNETTE DISAPPEAR on a fresh life that had consumed nothing. `lifeStart`
 * (the start of the life covering `frame`) rules out any earlier change — a reading outside that
 * life is never a candidate.
 */
export function refineAbilityReading(
  base: AbilityRankReading | null,
  changes: readonly ReplayEquipmentChange[],
  slot: number,
  frame: number,
  lifeStart: number,
): AbilityRankReading | null {
  let last: ReplayEquipmentChange | null = null
  for (const c of changes) {
    if (c.slot !== slot || c.t > frame || c.t < lifeStart) continue
    if (!last || c.t > last.t) last = c
  }
  if (!last) return base
  const age = frame - last.t
  // THE READING WINS AT EQUALITY AND BEYOND: a keyframe reading later than the event has
  // already seen its effect, and a FUTURE reading (negative age) is never allowed to outrank
  // past information — hence the comparison on the age and not on the instant.
  if (base && base.age >= 0 && base.age <= age) return base
  if (last.r === REPLAY_NO_ABILITY_RANK) return null
  return { rank: last.r, age, src: ABILITY_SRC_CHANGE }
}
