// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useTeamColors — the persisted preference for the two team colors (friendly and enemy).
 *
 * Same storage pattern as `useReplay3dFov`: one key per color, read under try, validated on the
 * way in (a stored value that is not a `#rrggbb` hex falls back to the default — `localStorage`
 * is open to anyone), and shared by key through the `abonnes` registry so the drawer's
 * pickers and every reader of the colors move together in the same tab (the browser `storage`
 * event never fires for the tab that writes).
 *
 * APPLYING THE PREFERENCE: the hook sets `--team-ally` / `--team-enemy` on
 * `document.documentElement`, so every CSS consumer (SVG HUD, Tailwind `tokenCssVar`, 3D scene
 * CSS) follows a change at once, without a reload. The memoized JS reader keys its memo on the
 * values returned here (`useReplayInks`); the paint-time readers (export HUD) resolve the live
 * CSS variable when they paint.
 */
import { useCallback, useEffect, useState } from 'react'

import { persistPreference, readStoredString, subscribePreference } from './replayPreferences'

/** The defaults are the palette `index.css` carries: green friendly, red enemy. */
export const TEAM_ALLY_DEFAULT = '#22c55e'
export const TEAM_ENEMY_DEFAULT = '#ef4444'

const ALLEY_KEY = 'replay-team-color-ally'
const ENEMY_KEY = 'replay-team-color-enemy'

/** A team color is exactly what a native `<input type="color">` emits: a `#rrggbb` hex. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i

export function isTeamColor(value: string): boolean {
  return HEX_COLOR.test(value)
}

function applyTeamColors(ally: string, enemy: string): void {
  const root = document.documentElement
  root.style.setProperty('--team-ally', ally)
  root.style.setProperty('--team-enemy', enemy)
}

export interface TeamColors {
  ally: string
  enemy: string
  setAlly: (color: string) => void
  setEnemy: (color: string) => void
  reset: () => void
}

export function useTeamColors(): TeamColors {
  const [ally, setAllyState] = useState(() => readStoredString(ALLEY_KEY, TEAM_ALLY_DEFAULT, isTeamColor))
  const [enemy, setEnemyState] = useState(() => readStoredString(ENEMY_KEY, TEAM_ENEMY_DEFAULT, isTeamColor))

  // The subscription makes the keys shareable: the drawer and every other reader of the colors
  // move together, in the same tab.
  useEffect(() => {
    const offAlly = subscribePreference(ALLEY_KEY, (raw) => {
      if (isTeamColor(raw)) setAllyState(raw)
    })
    const offEnemy = subscribePreference(ENEMY_KEY, (raw) => {
      if (isTeamColor(raw)) setEnemyState(raw)
    })
    return () => {
      offAlly()
      offEnemy()
    }
  }, [])

  // The CSS variables are the single source of truth for every CSS consumer; setting them on
  // the root makes all of them follow, live.
  useEffect(() => {
    applyTeamColors(ally, enemy)
  }, [ally, enemy])

  const setAlly = useCallback((color: string) => {
    if (!isTeamColor(color)) return
    setAllyState(color)
    persistPreference(ALLEY_KEY, color)
  }, [])

  const setEnemy = useCallback((color: string) => {
    if (!isTeamColor(color)) return
    setEnemyState(color)
    persistPreference(ENEMY_KEY, color)
  }, [])

  const reset = useCallback(() => {
    setAllyState(TEAM_ALLY_DEFAULT)
    setEnemyState(TEAM_ENEMY_DEFAULT)
    persistPreference(ALLEY_KEY, TEAM_ALLY_DEFAULT)
    persistPreference(ENEMY_KEY, TEAM_ENEMY_DEFAULT)
  }, [])

  return { ally, enemy, setAlly, setEnemy, reset }
}
