/**
 * announcerVoice.ts — WHICH RECORDED LINE says a call, and how long it lasts.
 *
 * TWO SOURCES. The bundled set carries the "round over" voice (FR and EN). Every other line comes
 * from the user's own game install: `build-sounds` extracts the announcer's lines into the data
 * directory and writes `announcer.json`, which the sound route serves next to them. On a machine
 * where nothing was extracted the manifest is a 404 and only the bundled line exists: the other
 * calls stay silent, without an error.
 *
 * THE MANIFEST IS KEYED BY THE GAME'S OWN VOCALIZATION NAMES ("doublekill", "flagcaptured"),
 * and this file maps each call key of the scheduler onto them (`voiceNamesOfCall`). The Go side
 * (`internal/announcer/names.go`) extracts exactly the names this map asks for. The durations are
 * the streams' own (`build-sounds` reads each one's sample count), never a guess.
 *
 * THE EXTRACTED VOICE HAS THE INSTALL'S LANGUAGE, whatever the page's: the game decides which
 * announcer packages are installed (this install has English only), so the manifest's lines are
 * served for every locale, after the locale's own bundled line when it has one.
 */
import type { ReplayLocale } from '../i18n/i18n'

/** One recorded line: its file stem and its duration. */
export interface AnnouncerTake {
  stem: string
  durationMs: number
}

/** A table of lines by call key then language (the bundled set, and tests). */
export type AnnouncerLines = Readonly<Record<string, Readonly<Partial<Record<ReplayLocale, AnnouncerTake>>>>>

/** What says the calls: the takes of a call in a language, and every stem it can play. */
export interface AnnouncerVoice {
  takes(key: string, locale: ReplayLocale): readonly AnnouncerTake[]
  stems(locale: ReplayLocale): readonly string[]
}

/** The manifest `build-sounds` writes (`internal/announcer/extract.go`). */
export interface AnnouncerManifest {
  version: number
  language: string
  lines: Readonly<Record<string, { takes: ReadonlyArray<{ file: string; durationMs: number }> }>>
}

/** Where the sound route serves the manifest. */
export const ANNOUNCER_MANIFEST_URL = '/static/sounds/halo_infinite/announcer.json'

/** The objective calls, by statistic and side, onto the game's lines. A key absent is silent. */
const OBJECTIVE_VOICE: Readonly<Record<string, readonly string[]>> = {
  'objective.flag_captures.ours': ['flagcaptured'],
  'objective.flag_returns.ours': ['teamflagreturned'],
  'objective.flag_returns.theirs': ['enemyflagreturned'],
  'objective.zone_captures.ours': ['strongholdcaptured'],
  'objective.hill_captures.ours': ['hillcontrolled'],
  'objective.hill_captures.theirs': ['hillcontrolledenemy'],
  'objective.vip_selected.ours': ['newvip'],
}

/** The match calls onto the game's lines: the time warnings the game has, the lead, overtime. */
const MATCH_VOICE: Readonly<Record<string, readonly string[]>> = {
  'time.300': ['5minutes'],
  'time.120': ['2minutes'],
  'time.60': ['1minutes'],
  'time.30': ['30seconds'],
  'time.10': ['10seconds'],
  'score.lost_lead': ['lostlead'],
  overtime: ['overtime'],
}

/** Medals and modes whose line spells them differently from the display name. */
const VOICE_ALIASES: Readonly<Record<string, string>> = {
  killamanjaro: 'killimanjaro',
  capturetheflag: 'ctf',
  bigteamslayer: 'bigslayer',
}

/** The letters and digits of a key's name part: `double_kill` -> `doublekill`. */
function voiceBase(part: string): string {
  const base = part.toLowerCase().replace(/[^a-z0-9]+/g, '')
  return VOICE_ALIASES[base] ?? base
}

/**
 * voiceNamesOfCall — the vocalization names that can say a call, best first. A medal is said by
 * its name, or its name then "medal" (the game has one shape or both); a mode by its name, or
 * its name then "intro" or "start" ("ctfstart", "kingofthehillintro").
 */
export function voiceNamesOfCall(key: string): readonly string[] {
  if (key.startsWith('medal.')) {
    const base = voiceBase(key.slice('medal.'.length))
    return base ? [base, `${base}medal`] : []
  }
  if (key.startsWith('mode.')) {
    const base = voiceBase(key.slice('mode.'.length))
    return base ? [base, `${base}intro`, `${base}start`] : []
  }
  return OBJECTIVE_VOICE[key] ?? MATCH_VOICE[key] ?? []
}

/** The manifest version this viewer reads: `ManifestVersion` in `internal/announcer/extract.go`.
 *  An older manifest is refused (silent) until the server's announcer job rebuilds it. */
const MANIFEST_VERSION = 3

/** A take's file: the game's Vorbis stream in an Ogg file, named after its line. */
const TAKE_FILE = /^[a-z0-9_]+\.ogg$/

/** The stem of a take's file: `soundUrlOf` adds the `.ogg` extension back. */
function stemOfFile(file: string): string {
  return file.replace(/\.ogg$/, '')
}

/** manifestVoice — the extracted lines, for every locale (see the header). */
export function manifestVoice(manifest: AnnouncerManifest): AnnouncerVoice {
  const takesOf = (name: string): AnnouncerTake[] =>
    (manifest.lines[name]?.takes ?? []).map((t) => ({ stem: stemOfFile(t.file), durationMs: t.durationMs }))
  return {
    takes(key) {
      for (const name of voiceNamesOfCall(key)) {
        const found = takesOf(name)
        if (found.length > 0) return found
      }
      return []
    },
    stems() {
      return Object.values(manifest.lines).flatMap((l) => l.takes.map((t) => stemOfFile(t.file)))
    },
  }
}

/** tableVoice — a table of lines (the bundled set, a test table) as a voice. */
export function tableVoice(lines: AnnouncerLines): AnnouncerVoice {
  return {
    takes(key, locale) {
      const take = lines[key]?.[locale]
      return take ? [take] : []
    },
    stems(locale) {
      return Object.values(lines).flatMap((byLocale) => (byLocale[locale] ? [byLocale[locale].stem] : []))
    },
  }
}

/** combineVoices — the first voice that has a call says it; the stems are all of them. */
export function combineVoices(...voices: readonly AnnouncerVoice[]): AnnouncerVoice {
  return {
    takes(key, locale) {
      for (const v of voices) {
        const found = v.takes(key, locale)
        if (found.length > 0) return found
      }
      return []
    },
    stems(locale) {
      return voices.flatMap((v) => v.stems(locale))
    },
  }
}

/** parseAnnouncerManifest — the manifest when its shape is the one `build-sounds` writes, else null. */
export function parseAnnouncerManifest(raw: unknown): AnnouncerManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Partial<AnnouncerManifest>
  if (m.version !== MANIFEST_VERSION || typeof m.language !== 'string' || !m.lines || typeof m.lines !== 'object') return null
  const lines: Record<string, { takes: { file: string; durationMs: number }[] }> = {}
  for (const [name, line] of Object.entries(m.lines)) {
    const takes = (Array.isArray(line?.takes) ? line.takes : []).filter(
      (t) => typeof t?.file === 'string' && TAKE_FILE.test(t.file) && typeof t.durationMs === 'number' && t.durationMs > 0,
    )
    if (takes.length > 0) lines[name] = { takes }
  }
  return { version: MANIFEST_VERSION, language: m.language, lines }
}

/**
 * loadAnnouncerManifest — the manifest from the sound route, or null: no extraction (404), a
 * network failure or a malformed file all leave the extracted lines silent, never an error.
 */
export async function loadAnnouncerManifest(fetchFn: typeof fetch | undefined = globalThis.fetch): Promise<AnnouncerManifest | null> {
  if (typeof fetchFn !== 'function') return null
  try {
    const res = await fetchFn(ANNOUNCER_MANIFEST_URL)
    if (!res.ok) return null
    return parseAnnouncerManifest(await res.json())
  } catch {
    return null
  }
}
