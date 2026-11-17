// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useDefaultViewpoint — which player the viewer follows when a match opens: the signed-in
 * account's own player when they are in the match, otherwise the first of the roster. Once the
 * user picks a viewpoint themselves, that choice is never overridden.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { useAuthState } from './useAuthState'

export interface RosterName {
  xuid: string
  name?: string
}

/** The xuid of the roster entry whose name is `gamertag` (case and spacing insensitive). */
export function xuidOfGamertag(roster: readonly RosterName[], gamertag: string): string | null {
  const wanted = gamertag.replace(/\s+/g, '').toLowerCase()
  if (!wanted) return null
  const entry = roster.find((r) => (r.name ?? '').replace(/\s+/g, '').toLowerCase() === wanted)
  return entry ? entry.xuid : null
}

/** The gamertag a match link asks to follow (`#/matches/<id>?player=<gamertag>`), or ''. */
export function requestedPlayer(hash: string): string {
  const query = hash.split('?')[1] ?? ''
  return new URLSearchParams(query).get('player') ?? ''
}

export function useDefaultViewpoint(
  roster: readonly RosterName[],
): [string | null, (xuid: string | null) => void] {
  const [viewpoint, setViewpoint] = useState<string | null>(roster[0]?.xuid ?? null)
  const chosen = useRef(false)
  const auth = useAuthState()
  const gamertag = auth.phase.phase === 'signed_in' ? auth.phase.gamertag : ''

  useEffect(() => {
    if (chosen.current) return
    // A match opened from another player's list follows that player; otherwise the
    // signed-in account's own player when they played in it.
    const requested = xuidOfGamertag(roster, requestedPlayer(window.location.hash))
    const own = requested ?? xuidOfGamertag(roster, gamertag)
    if (own) setViewpoint(own)
  }, [roster, gamertag])

  const choose = useCallback((xuid: string | null) => {
    chosen.current = true
    setViewpoint(xuid)
  }, [])
  return [viewpoint, choose]
}
