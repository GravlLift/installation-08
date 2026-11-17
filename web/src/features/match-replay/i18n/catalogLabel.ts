// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * catalogLabel.ts — READ A DOCUMENT LABEL IN THE READER'S LANGUAGE.
 *
 * Since schema v2 (batch 3.2), the artifact no longer carries one string per label but one
 * property per language (`{ en, fr, … }`, ADR 0040): it is built ONCE, offline, and served for
 * every language — baking in a single language would mean picking the reader's language at the
 * time a film is decoded. The language choice happens in `pickText` (`lib/i18n/pickText`), the
 * only place that knows the language property names.
 *
 * FALLBACK: the reader's language, else English (D3, game names), else nothing. A missing label
 * is not missing data — it is an incomplete configuration, and showing a raw identifier instead
 * would misrepresent the cause.
 */
import { type LocaleTexts, pickText } from '@/lib/i18n/pickText'

import type { ReplayLocale } from './i18n'

/** The shape of a document label (mirrors replay.Label on the Go side): one text per language, plus its visual. */
export interface CatalogLabel extends LocaleTexts {
  /**
   * Game HUD thumbnail (grenades, abilities), served by the document. Absent = no visual: the
   * caller keeps the label — never a neighbor's thumbnail. `tinted` means a mask to be tinted
   * (same contract as the weapon icons).
   */
  img?: string
  tinted?: boolean
}

/**
 * catalogText renders a document label's text, or undefined if the label is missing both in the
 * requested language and in the fallback one — the caller then decides what to show (an
 * identifier, a number).
 */
export function catalogText(label: CatalogLabel | undefined, locale: ReplayLocale): string | undefined {
  return pickText(label, locale) || undefined
}
