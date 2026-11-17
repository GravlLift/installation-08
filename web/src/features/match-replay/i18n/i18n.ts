// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * i18n for the match-replay feature (top-down 2D replay). UI strings, typed parity via
 * Record<ReplayLocale, ReplayText>.
 *
 * THE CONTRACT (one field per string, and its justification) LIVES IN `i18nContract.ts`; each
 * language lives in its own file (`en.ts`) and satisfies it; this file carries only the table
 * that assembles them. Adding a language: one file, one line here.
 */
import type { Locale } from '@/lib/i18n/locale'

import { EN_TEXT } from './en'
import type { ReplayText } from './i18nContract'

/** Local alias of the central type: the feature does not redeclare the language union. */
export type ReplayLocale = Locale

export const REPLAY_TEXT: Record<ReplayLocale, ReplayText> = {
  en: EN_TEXT,
}
