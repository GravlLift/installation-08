// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * gamertagSearch — the pure side of the match select page's gamertag search: the input's
 * normalization and loose check (the same rule the server applies, see
 * `cmd/infinite-theater-3d/remote_routes.go`, `gamertagValid`), the remembered last search in
 * localStorage, the rows a search shows and the caption naming whose matches they are.
 */
import type { MatchSummary, RemoteMatch } from '../lib/api/standalone'
import type { MatchRow } from './matchSelectModel'

/** The localStorage key holding the last searched gamertag. */
export const GAMERTAG_STORAGE_KEY = 'it3d.searchGamertag'

/** The input as the server would take it: trimmed, inner runs of spaces collapsed to one.
 *  `null` when it is empty or fails the loose check (1 to 16 characters: letters of any
 *  script, digits, spaces and '#'). */
export function normalizeGamertag(input: string): string | null {
  const gt = input.trim().replace(/\s+/g, ' ')
  const chars = [...gt]
  if (chars.length < 1 || chars.length > 16) return null
  return /^[\p{L}\p{N} #]+$/u.test(gt) ? gt : null
}

/** The last searched gamertag, or '' when none is stored or storage is unavailable. */
export function loadSavedGamertag(): string {
  try {
    return window.localStorage.getItem(GAMERTAG_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Stores the last searched gamertag; `null` forgets it. Storage failures are ignored. */
export function saveGamertag(gamertag: string | null): void {
  try {
    if (gamertag) window.localStorage.setItem(GAMERTAG_STORAGE_KEY, gamertag)
    else window.localStorage.removeItem(GAMERTAG_STORAGE_KEY)
  } catch {
    // Private mode or blocked storage: the search still works, it is just not remembered.
  }
}

/** The caption over the list: whose matches it shows. */
export function listCaption(searched: string | null): string {
  return searched ? `${searched}'s matches` : 'My matches'
}

/** The rows of a gamertag search: that player's recent matches only, newest first as the
 *  service lists them. A match already stored shows as its stored row (Watch), the rest as
 *  remote rows (Fetch). */
export function searchedRows(
  stored: MatchSummary[],
  remote: RemoteMatch[],
  localIds: Set<string>,
): MatchRow[] {
  const byId = new Map(stored.map((m) => [m.matchId, m]))
  return remote.map((m): MatchRow => {
    const local = localIds.has(m.id) ? byId.get(m.id) : undefined
    return local ? { kind: 'stored', id: m.id, match: local } : { kind: 'remote', id: m.id, match: m }
  })
}
