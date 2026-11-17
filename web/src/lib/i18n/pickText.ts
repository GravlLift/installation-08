// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * pickText — READING A LABEL BY LANGUAGE (ADR 0040, D3).
 *
 * The replay document keeps a label per language INSIDE the document (a large document, cached
 * client-side, baked artifacts that are not re-baked): a weapon label is
 * `{ en: '…', fr: '…', fx: '…', … }`, one property per language from `config/locales.toml`, at the same
 * level as the other fields. This module is the ONLY place that picks a language from such an
 * object: the rest of the code calls `pickText(label, locale)` and never names `.fr` / `.en`
 * directly (guard rail `replay-label-access.guard.test.ts`).
 *
 * FALLBACK (D3: game names): the requested language, otherwise `FALLBACK_LOCALE`, otherwise an empty string.
 * Never an invented translation, never "whichever other language" by the luck of key order.
 */
import { FALLBACK_LOCALE, KNOWN_LOCALES, type Locale } from './locale'

/** A label per language: any property whose name is a language from the list is read, the rest ignored. */
export type LocaleTexts = Readonly<Partial<Record<Locale, string | null | undefined>>>

/**
 * The text for the requested language; failing that, `FALLBACK_LOCALE`'s; failing that, `''`.
 * An absent label (`undefined` / `null`) returns `''`: the caller decides what to show in its place.
 */
export function pickText(text: LocaleTexts | null | undefined, locale: Locale): string {
  return text?.[locale] || text?.[FALLBACK_LOCALE] || ''
}

/**
 * The texts of every language provided, in the list's order. For lookups that
 * search for a name stem in any language (recognizing "transloc" in
 * "Quantum Translocator" as in its translation), never for display.
 */
export function allTexts(text: LocaleTexts | null | undefined): string[] {
  if (!text) return []
  return KNOWN_LOCALES.flatMap((l) => {
    const v = text[l]
    return v ? [v] : []
  })
}

/**
 * Projects an object carrying language properties (a document label, a named zone)
 * onto its per-language texts alone: other properties (`img`, `x`, `family`…) do not enter it.
 * Used to store a zone's texts in a dedicated field rather than keeping the whole object.
 */
export function localeTextsOf(source: object | null | undefined): Partial<Record<Locale, string>> {
  const out: Partial<Record<Locale, string>> = {}
  if (!source) return out
  const record = source as Record<string, unknown>
  for (const l of KNOWN_LOCALES) {
    const v = record[l]
    if (typeof v === 'string') out[l] = v
  }
  return out
}
