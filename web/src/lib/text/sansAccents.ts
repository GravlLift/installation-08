// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * sansAccents — the text without its accents: NFD decomposition, combining diacritical marks
 * (U+0300 to U+036F) stripped; case and whitespace unchanged. THE normalization for the
 * application's accent-insensitive searches and comparisons ("Écluse" -> "Ecluse").
 *
 * Guard rail: `sansAccents.guard.test.ts` — `.normalize('NFD')` appears nowhere else.
 */
export function sansAccents(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}
