// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useSoundCategoryFilter — the per-category sound filter of the settings drawer, its persistence
 * and its toggle. Extracted from `useReplaySound.ts` (over its size threshold) when the announcer
 * category joined the list; nothing changed in its logic.
 */
import { useCallback, useMemo, useState } from 'react'

import { persistPreference } from '../settings/replayPreferences'
import { SOUND_CATEGORIES, type SoundCategory, type SoundCategoryFilter } from './replaySound'

/** Categories CUT, not the active categories: a future category stays ON by default
 * for those who already have a stored preference — never need to migrate this JSON. */
const SOUND_CATEGORIES_OFF_KEY = 'replay-sound-categories-off'

/** Reads the categories CUT; an unknown value (old key, corrupted JSON) is
 * ignored rather than making the whole read fail — clean silence on the preference side. */
function readStoredCategoriesOff(): ReadonlySet<SoundCategory> {
  try {
    const raw = localStorage.getItem(SOUND_CATEGORIES_OFF_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    const known: readonly string[] = SOUND_CATEGORIES
    return new Set(parsed.filter((v): v is SoundCategory => known.includes(v)))
  } catch {
    return new Set()
  }
}

export function useSoundCategoryFilter(): {
  categories: SoundCategoryFilter
  toggleCategory: (category: SoundCategory) => void
} {
  const [categoriesOff, setCategoriesOff] = useState<ReadonlySet<SoundCategory>>(readStoredCategoriesOff)

  const categories = useMemo<SoundCategoryFilter>(() => ({
    weapon: !categoriesOff.has('weapon'),
    grenade: !categoriesOff.has('grenade'),
    melee: !categoriesOff.has('melee'),
    equipment: !categoriesOff.has('equipment'),
    // ALWAYS TRUE: "Objectives" is no longer adjustable (cf. SOUND_CATEGORIES). The read
    // of the storage already ignores it, this literal says the same thing to the type.
    objective: true,
    announcer: !categoriesOff.has('announcer'),
  }), [categoriesOff])

  // NEXT COMPUTED OUTSIDE THE UPDATER, PERSISTENCE AFTER `setCategoriesOff`: `persistPreference`
  // notifies its subscribers SYNCHRONOUSLY, and a subscriber that recalls `setState` from
  // the updater of ANOTHER `setState` triggers a state update in the middle of the render
  // phase — React refuses it ("Cannot update a component while rendering a different
  // component"). The faulty pattern must not be reproduced.
  const toggleCategory = useCallback((category: SoundCategory) => {
    const next = new Set(categoriesOff)
    if (next.has(category)) next.delete(category)
    else next.add(category)
    setCategoriesOff(next)
    persistPreference(SOUND_CATEGORIES_OFF_KEY, JSON.stringify(Array.from(next)))
  }, [categoriesOff])

  return { categories, toggleCategory }
}
