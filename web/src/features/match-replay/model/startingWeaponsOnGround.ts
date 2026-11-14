/**
 * startingWeaponsOnGround — WHICH GROUND WEAPONS THE REPLAY SHOWS BY DEFAULT.
 *
 * Everyone spawns with the same weapons: the ones a player drops on death add nothing to the
 * tactical reading. By default a DROPPED weapon (`origin = "dropped"`) whose model is a starting
 * weapon of the match is therefore masked; an option shows them again.
 *
 * - A weapon PLACED BY THE MAP (`origin = "spawned"`: rack, pedestal) stays VISIBLE always,
 *   even if its model is that of a starting weapon: it is a place, not a leftover.
 * - A starting weapon = a model present in a `loadouts[]` entry with `src = "birth"`, read IN
 *   THE DOCUMENT, match by match. No hardcoded weapon list nor mode name.
 * - A document without a birth loadout masks nothing.
 * - The identifiers are normalized: `loadouts[].w` is written as "0xABCD1234",
 *   `groundWeapons[].w` as "abcd1234" (`weaponLabelKeyOf`).
 */
import type { ReplayGroundWeapon } from '@/lib/api/types'

import { weaponLabelKeyOf } from '../layers/useReplayWeaponPads'

/** The source of spawn loadouts in `loadouts[].src`. */
const LOADOUT_SOURCE_BIRTH = 'birth'

interface BirthLoadout {
  src?: string
  w?: readonly string[]
}

/** startingWeaponKeys — the models (canonical key) carried at spawn, from any slot. */
export function startingWeaponKeys(loadouts: readonly BirthLoadout[] | undefined): ReadonlySet<string> {
  const keys = new Set<string>()
  for (const lo of loadouts ?? []) {
    if (lo.src !== LOADOUT_SOURCE_BIRTH) continue
    for (const w of lo.w ?? []) keys.add(weaponLabelKeyOf(w))
  }
  return keys
}

/**
 * visibleGroundWeapons — filters the ground weapons. `includeStarting` true: everything is kept.
 * Returns the input array as is when nothing is removed (stable reference for the memos).
 */
export function visibleGroundWeapons<T extends Pick<ReplayGroundWeapon, 'w' | 'origin'>>(
  items: readonly T[],
  loadouts: readonly BirthLoadout[] | undefined,
  includeStarting: boolean,
): readonly T[] {
  if (includeStarting) return items
  const starting = startingWeaponKeys(loadouts)
  if (starting.size === 0) return items
  return items.filter((item) => item.origin === 'spawned' || !starting.has(weaponLabelKeyOf(item.w)))
}
