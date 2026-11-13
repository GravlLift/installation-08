/**
 * Locale — standalone stand-in for LevelUp's generated `lib/i18n/locale`.
 *
 * LevelUp derives this list from `config/locales.toml` at build time. This viewer ships
 * English only for now, but keeps the same shape (a union type + a known-locales list)
 * so a second language is a one-line addition here, not a redesign.
 */

export const KNOWN_LOCALES = ['en', 'fr'] as const

export type Locale = (typeof KNOWN_LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'
export const FALLBACK_LOCALE: Locale = 'en'

export function isKnownLocale(segment: string): segment is Locale {
  return (KNOWN_LOCALES as readonly string[]).includes(segment)
}

export function normalizeLocale(value: string | null | undefined): Locale {
  const primary = (value ?? '').trim().toLowerCase().split(/[-_,;\s]/)[0]
  return isKnownLocale(primary) ? primary : DEFAULT_LOCALE
}
