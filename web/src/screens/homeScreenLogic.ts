// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * homeScreenLogic — the sign-in countdown helper: no network, no timers, so it is a plain
 * unit-tested function rather than a hook. The remote-matches helpers moved to
 * `matchSelectModel.ts` with the match select page (brief 124).
 */
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
