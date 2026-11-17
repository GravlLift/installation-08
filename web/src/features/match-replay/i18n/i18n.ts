// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * i18n for the match-replay feature (top-down 2D replay). FR + EN UI strings,
 * parity enforced by typing Record<ReplayLocale, ReplayText>.
 *
 * THE CONTRACT (one field per string, with its rationale) LIVES IN `i18nContract.ts`; each
 * language lives in its own file (`fr.ts`, `en.ts`) and satisfies it; this file only carries the
 * table that assembles them. Adding a language: one file, one line here.
 */
import type { Locale } from '@/lib/i18n/locale'

import { EN_TEXT } from './en'
import { FR_TEXT } from './fr'
import type { ReplayText } from './i18nContract'

/** Local alias for the central type: the feature does not redeclare the language union. */
export type ReplayLocale = Locale

export const REPLAY_TEXT: Record<ReplayLocale, ReplayText> = {
  fr: FR_TEXT,
  en: EN_TEXT,
}
