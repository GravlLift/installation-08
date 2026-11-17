// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * displayName.ts — the ONE display resolver for player identities.
 *
 * Guarantees that no raw xuid-shaped string (a long number or "xuid(...)")
 * is EVER rendered on screen, whatever the server data. This is the
 * frontend chokepoint for the rule "never a xuid, always a gamertag" — mirror
 * of analysis.GamertagLookupViewSQL / analysis.MaskedXuidLabelSQL on the Go side.
 *
 * Every rendering of a player name MUST go through `displayPlayerName(gamertag, xuid)`
 * instead of an ad hoc `gamertag || xuid` fallback.
 *
 * Note on bots: bot identifiers "bid(N.0)" are NOT masked here — they are
 * resolved server-side (BotSQLCase -> "343 …"); a residual unknown bot stays
 * readable as-is rather than being wrongly labeled "Player".
 *
 * THE " [bot]" SUFFIX — STRIPPED FOR DISPLAY (user feedback 2026-09-02). The killsource
 * producer writes a bot's gamertag with the literal suffix ` [bot]`
 * (`apps/go-api/internal/games/halo_infinite/film/internal/facts/killsource/roster.go`,
 * `botSuffix`) and the replay artifact (schema 36) carries it the same way: it is a
 * DATA MARKER, not a display choice — the screen does not need to repeat it,
 * especially since the context already says so (a "Bot" badge, dimmed style). Xbox
 * forbids brackets in a gamertag: no real player can carry this
 * suffix, so stripping it is risk-free. `stripBotSuffix` is
 * exported for the rare display points that do not go through
 * `displayPlayerName` (e.g. a literal already masked by its own logic) —
 * never to copy the suffix elsewhere.
 */

/**
 * Raw player xuid format: "xuid(...)" OR a purely numeric string of >= 15
 * digits (decimal Xbox xuid). Deliberately strict so as not to mask legitimate
 * gamertags (a gamertag can contain digits, but not 15 of them in a
 * row).
 */
const RAW_XUID_RE = /^xuid\(|^\d{15,}$/i

/** true if `s` looks like a raw player xuid identifier (never to be displayed). */
export function isXuidLike(s: string): boolean {
  return RAW_XUID_RE.test(s.trim())
}

/**
 * Stable masked label for an unresolved xuid: "Player ####" (last 4
 * characters). Lets several unknowns be distinguished in the same chart without
 * exposing the full identifier.
 */
export function maskedPlayerLabel(xuid: string): string {
  const tail = xuid.slice(-4) || xuid
  return `Player ${tail}`
}

/** DATA suffix placed by killsource on a bot's gamertag — never a
 * display choice (see the file header). Exact casing, mirrors the Go side. */
const BOT_SUFFIX = ' [bot]'

/**
 * stripBotSuffix strips the TRAILING ` [bot]` suffix from a gamertag, if present —
 * never an occurrence in the middle of the name (an aberrant data case this helper
 * does not reinterpret). `displayPlayerName` already applies it: only call this
 * helper directly for a display point that does not go through it.
 */
export function stripBotSuffix(gamertag: string): string {
  return gamertag.endsWith(BOT_SUFFIX) ? gamertag.slice(0, -BOT_SUFFIX.length) : gamertag
}

/**
 * A player's display name, GUARANTEED free of raw xuid format:
 *  - non-empty, non-xuid-like `gamertag` -> `gamertag`, bot suffix stripped
 *  - otherwise `xuid` provided -> `maskedPlayerLabel(xuid)`
 *  - otherwise -> "Unknown player"
 */
export function displayPlayerName(
  gamertag?: string | null,
  xuid?: string | null,
): string {
  const gt = gamertag?.trim()
  if (gt && !isXuidLike(gt)) return stripBotSuffix(gt)
  const xu = xuid?.trim()
  if (xu) return maskedPlayerLabel(xu)
  return 'Unknown player'
}

/**
 * Comparison key for a gamertag: lowercase, trimmed. This is the key for
 * the "is this player a friend?" match (the player's friends list) — the same
 * everywhere the question comes up (Match View charts, 2D replay), so that a friend
 * entered as "Ma Pote" and present as "MA POTE" is recognized on both sides.
 */
export function normalizeGamertagKey(gt: string | null | undefined): string {
  return (gt ?? '').toLowerCase().trim()
}
