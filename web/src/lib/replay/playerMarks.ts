/**
 * playerMarks.ts — WHO IS "ME" AND WHO IS A FRIEND, on the replay page. Pure, testable.
 *
 * TWO MARKS, ONE GRAMMAR ACROSS THE THREE PANELS (map, cards, feed — decision D5 of the
 * dressing plan, 2026-08-16):
 *   - `me`     : THE POINT OF VIEW of the replay page, which defaults to the page's player
 *                (decision 13 of the "timeline, point of view" plan, 2026-09-06) — not the
 *                connected account. The ringed disc on the map says "the one being watched";
 *                the day we look through someone else's eyes, it follows them;
 *   - `friend` : a gamertag from the consulted player's friend list, matched
 *                by the same key as the Match View charts (`normalizeGamertagKey`).
 * The one being watched is never marked a friend of themselves. An ENEMY friend is marked
 * too: the mark says the identity, not the camp — the camp is the color.
 *
 * No mark for a xuid absent from the scoreboard: without a row, we know nothing about them.
 */
import type { MatchScoreboardRow } from '@/lib/api/types'
import { normalizeGamertagKey } from '@/lib/players/displayName'

export type PlayerMarkKind = 'me' | 'friend'

/** STABLE reference for "no mark": avoids a `new Map()` on every render. */
export const NO_MARKS: ReadonlyMap<string, PlayerMarkKind> = new Map()

/**
 * buildPlayerMarks returns, per xuid, the mark to wear. `friendGamertags` = the settings
 * list, as-is (normalization is done here).
 *
 * `meXUID` (2026-09-06) designates WHO wears the `me` mark: the point of view of the replay
 * page. Absent, the mark falls back to the `is_me` row of the scoreboard — the pre-point-of-view
 * behavior, which the L2a characterization locks in and which callers that know no point of view
 * keep getting. A `meXUID` that has no row in the scoreboard makes the mark worn by NO ONE: no
 * fallback to `is_me`, otherwise the ringed disc would point at someone other than what we watch.
 */
export function buildPlayerMarks(
  scoreboard: readonly MatchScoreboardRow[],
  friendGamertags: readonly string[],
  meXUID?: string | null,
): ReadonlyMap<string, PlayerMarkKind> {
  const friends = new Set<string>()
  for (const gt of friendGamertags) {
    const key = normalizeGamertagKey(gt)
    if (key) friends.add(key)
  }
  const marks = new Map<string, PlayerMarkKind>()
  for (const row of scoreboard) {
    if (meXUID == null ? row.is_me : row.xuid === meXUID) {
      marks.set(row.xuid, 'me')
      continue
    }
    if (friends.has(normalizeGamertagKey(row.gamertag))) marks.set(row.xuid, 'friend')
  }
  return marks
}
