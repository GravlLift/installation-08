// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayPreferences.ts — THE ONLY PLACE that touches localStorage for the replay
 * preferences. Pattern BORN in useReplaySound (sound: muted/volume): simple key, read under
 * a try — private browsing or refused storage degrades silently to the default value, never
 * a displayed error nor a crash.
 *
 * CENTRALIZED HERE (CLAUDE.md rule 6, "centralize on the 3rd copy"): the settings drawer
 * (user decision of 08/16) adds to the persisted sound the layers, the speed and the
 * category filter — four to six keys that share EXACTLY this pattern. useReplaySound and
 * useReplaySettings both import it rather than each copying it a third time on their own
 * side.
 */
import { DEFAULT_EXPORT_FORMAT_ID, EXPORT_FORMAT_IDS, type ExportFormatId } from '../export/exportFormats'

/** Reads a persisted boolean; absent or storage unavailable -> `fallback`. */
export function readStoredFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : raw === 'true'
  } catch {
    return fallback
  }
}

/**
 * Reads a persisted number, accepted only if `isValid` confirms it (bounds or membership in
 * an allowed set — e.g. the speed multipliers); absent, invalid or storage unavailable ->
 * `fallback`.
 */
export function readStoredNumber(
  key: string,
  fallback: number,
  isValid: (value: number) => boolean,
): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const value = Number(raw)
    return Number.isFinite(value) && isValid(value) ? value : fallback
  } catch {
    return fallback
  }
}

/**
 * Reads a persisted CHOICE among a closed set (e.g. the heat map reading: presence or
 * eliminations); absent, out of the list or storage unavailable -> `fallback`.
 *
 * SAME REQUIREMENT AS `readStoredNumber`: a value written by ANOTHER version of the app — or
 * by anyone, `localStorage` is open — must never enter the state. What is not in the list
 * does not exist.
 */
export function readStoredChoice<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): T {
  try {
    const raw = localStorage.getItem(key)
    return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
  } catch {
    return fallback
  }
}

/**
 * Reads a persisted string, accepted only if `isValid` confirms it (shape check on the way in —
 * a value written by anyone else, or by a removed version, must never enter the state);
 * absent, invalid or storage unavailable -> `fallback`.
 */
export function readStoredString(
  key: string,
  fallback: string,
  isValid: (value: string) => boolean,
): string {
  try {
    const raw = localStorage.getItem(key)
    return raw !== null && isValid(raw) ? raw : fallback
  } catch {
    return fallback
  }
}

/**
 * Reads a persisted JSON value (object or list); absent, unreadable or storage unavailable ->
 * null. The caller validates the shape: nothing here guarantees it.
 */
export function readStoredJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : (JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

/**
 * THE SUBSCRIBERS OF A KEY, and why they appeared (2026-08-18, item R3.7).
 *
 * Until now only ONE component read each preference: the hook's local React state was
 * enough. COMPACT CARDS break this assumption — the switch lives in the drawer (under the
 * canvas), the cards live in ANOTHER column of the page. Two `useState`s initialized from the
 * same `localStorage` do not talk to each other: the switch would have moved without the
 * cards changing, until the next reload.
 *
 * THE BROWSER'S `storage` EVENT DOES NOT MEET THIS NEED: it only fires for the OTHER tabs,
 * never for the one that writes. This is the classic trap, and that is why this registry
 * exists rather than a subscription to `window`.
 */
const subscribers = new Map<string, Set<(value: string) => void>>()

/** subscribePreference — listens to a key; returns the function that unsubscribes. */
export function subscribePreference(key: string, fn: (value: string) => void): () => void {
  const set = subscribers.get(key) ?? new Set()
  subscribers.set(key, set)
  set.add(fn)
  return () => set.delete(fn)
}

/** Persists a preference (boolean or number already turned into a string, JSON for a list). */
export function persistPreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage refused (private browsing): the preference does not survive, the setting still works. */
  }
  // Subscribers are notified EVEN IF storage refused: the setting must work within the
  // session, it is its survival across reload that is lost, not its effect.
  for (const fn of subscribers.get(key) ?? []) fn(value)
}

/**
 * THE VIDEO EXPORT FORMAT ("standard video formats" plan, decision D4, 2026-09-16): kept in
 * THIS browser, never server-side. The read is VALIDATED against the catalog
 * (`export/exportFormats.ts`): absent, unknown or written by another version -> 1080p.
 */
export const EXPORT_FORMAT_KEY = 'replay-export-format'

/** The chosen format, or the catalog's default. */
export function readExportFormat(): ExportFormatId {
  return readStoredChoice(EXPORT_FORMAT_KEY, DEFAULT_EXPORT_FORMAT_ID, EXPORT_FORMAT_IDS)
}

/** Remembers the chosen format. Storage refused: the choice holds for the session, without error. */
export function persistExportFormat(id: ExportFormatId): void {
  persistPreference(EXPORT_FORMAT_KEY, id)
}
