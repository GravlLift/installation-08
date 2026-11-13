/**
 * homeScreenLogic — pure helpers for the home screen's account panel and remote-matches
 * section: no network, no timers, so these are plain unit-tested functions rather than hooks.
 */
import type { MatchSummary, RemoteMatch } from '../lib/api/standalone'

/** The set of match ids already imported locally, used to decide "Open" vs "Fetch" for a
 *  remote row. */
export function localMatchIdSet(matches: MatchSummary[]): Set<string> {
  return new Set(matches.map((m) => m.matchId))
}

/** Formats the time remaining until `expiresAtIso` as `Xm Ys` (or `Ys` under a minute), given
 *  the current time in epoch ms. Returns `null` once the deadline has passed, or when
 *  `expiresAtIso` does not parse — the caller shows a generic "code expired" message instead. */
export function formatTimeLeft(expiresAtIso: string, nowMs: number): string | null {
  const deadline = new Date(expiresAtIso).getTime()
  if (Number.isNaN(deadline)) return null
  const remainingMs = deadline - nowMs
  if (remainingMs <= 0) return null
  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

/** Formats a remote match's `time` (an RFC3339 instant) in the viewer's own locale, same
 *  fallback-to-raw-string behavior as `MatchListScreen.formatImportedAt`. */
export function formatRemoteMatchTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

/** Whether `match` is already present in the local store, by id. */
export function isMatchLocal(match: RemoteMatch, localIds: Set<string>): boolean {
  return localIds.has(match.id)
}
