/**
 * queries.ts — standalone stand-in for LevelUp's `lib/replay/queries`.
 *
 * LevelUp's real module is a set of TanStack Query hooks against the player API
 * (match replay artifact, map background, callouts...). This viewer has no backend and
 * no query client: the scene code only ever reaches into this module for `isNotFound`,
 * a pure helper used to tell a missing asset (404, nominal) from a real failure.
 */

/** isNotFound: the caught error is a 404 (missing file, not an outage). */
export function isNotFound(err: unknown): boolean {
  return (err as { status?: unknown } | null)?.status === 404
}
