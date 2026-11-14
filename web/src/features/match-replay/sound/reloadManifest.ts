/**
 * reloadManifest.ts — THE EXTRACTED RELOADS, as the viewer reads them.
 *
 * `build-sounds` (and the server's sound job) extract every weapon's reload from the user's game
 * install into the data directory and write `reloads.json` next to the takes
 * (`internal/reloadsounds`). Nothing of it is bundled: on a machine where nothing was extracted
 * the manifest is a 404 and every reload stays silent, without an error.
 *
 * THE MANIFEST IS KEYED BY THE WEAPON TAG, the first 8 hex digits of the film's 64-bit weapon id
 * (`0x2B1824D542C9679F` is tag `2b1824d5`, the BR75), then by the stance the game reads the
 * reload in ("combat" standing, "crouch"). A weapon with no entry has no reload animation in the
 * game: the battery weapons vent instead, the melee weapons never reload.
 */
import { reloadGainDb, type TakeLevel } from './reloadLoudness'

/** The stances the game has a reload animation for. */
export type ReloadStance = 'combat' | 'crouch'

/** The manifest `build-sounds` writes (`internal/reloadsounds/manifest.go`). */
export interface ReloadManifest {
  version: number
  weapons: Readonly<Record<string, Readonly<Partial<Record<ReloadStance, ReloadManifestClip>>>>>
}

export interface ReloadManifestClip {
  animation: string
  durationMs: number
  sounds: ReadonlyArray<{ atMs: number; takes: ReadonlyArray<{ file: string; durationMs: number }> }>
}

/** One reload animation as the track plays it: its length, its gain, and each sound's moment and stems. */
export interface ReloadClip {
  durationMs: number
  gainDb: number
  sounds: ReadonlyArray<{ atMs: number; stems: readonly string[] }>
}

/** The reloads by weapon tag, then stance. */
export type ReloadLibrary = ReadonlyMap<string, Readonly<Partial<Record<ReloadStance, ReloadClip>>>>

/** Where the sound route serves the manifest. */
export const RELOAD_MANIFEST_URL = '/static/sounds/halo_infinite/reloads.json'

/** The oldest manifest version this viewer reads. */
const RELOAD_MANIFEST_VERSION = 1

const STANCES: readonly ReloadStance[] = ['combat', 'crouch']

/**
 * weaponTagOf returns the weapon tag of a film weapon id, or null. The film writes a weapon both
 * ways: the 64-bit id of a shot (`0x2B1824D542C9679F`) and the tag alone in a loadout (`0x2B1824D5`).
 */
export function weaponTagOf(id: string): string | null {
  const m = /^0x([0-9a-f]{8})(?:[0-9a-f]{8})?$/i.exec(id)
  return m ? m[1].toLowerCase() : null
}

/** takeStem is the sound stem of a take file: the file name without its `.ogg`. */
export function takeStem(file: string): string {
  return file.replace(/\.ogg$/, '')
}

/** parseReloadManifest checks the manifest's shape; anything else reads as nothing extracted. */
export function parseReloadManifest(raw: unknown): ReloadManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Partial<ReloadManifest>
  if (typeof m.version !== 'number' || m.version < RELOAD_MANIFEST_VERSION) return null
  if (!m.weapons || typeof m.weapons !== 'object') return null
  for (const stances of Object.values(m.weapons)) {
    for (const clip of Object.values(stances ?? {})) {
      if (!clip || typeof clip.durationMs !== 'number' || !Array.isArray(clip.sounds)) return null
    }
  }
  return m as ReloadManifest
}

/** loadReloadManifest reads the manifest from the sound route; `null` when nothing was extracted. */
export async function loadReloadManifest(fetchFn: typeof fetch | undefined = globalThis.fetch): Promise<ReloadManifest | null> {
  if (typeof fetchFn !== 'function') return null
  try {
    const res = await fetchFn(RELOAD_MANIFEST_URL)
    if (!res.ok) return null
    return parseReloadManifest(await res.json())
  } catch {
    return null
  }
}

/** The take files of the given weapon tags' reloads, each once. */
export function takeFilesOf(manifest: ReloadManifest, tags: Iterable<string>): string[] {
  const files = new Set<string>()
  for (const tag of tags) {
    for (const stance of STANCES) {
      for (const s of manifest.weapons[tag]?.[stance]?.sounds ?? []) for (const t of s.takes) files.add(t.file)
    }
  }
  return [...files]
}

/**
 * reloadLibrary builds the track's reloads for the given weapon tags, each animation with its
 * gain (`reloadGainDb`) from the takes' measured levels. A take without a level counts for
 * nothing in the gain and still plays.
 */
export function reloadLibrary(
  manifest: ReloadManifest,
  tags: Iterable<string>,
  levelOf: (file: string) => TakeLevel | null | undefined,
): ReloadLibrary {
  const out = new Map<string, Partial<Record<ReloadStance, ReloadClip>>>()
  for (const tag of tags) {
    const stances = manifest.weapons[tag]
    if (!stances) continue
    const clips: Partial<Record<ReloadStance, ReloadClip>> = {}
    for (const stance of STANCES) {
      const clip = stances[stance]
      if (!clip || clip.sounds.length === 0) continue
      const levels = clip.sounds.map((s) => s.takes.map((t) => levelOf(t.file)).filter((l): l is TakeLevel => !!l))
      clips[stance] = {
        durationMs: clip.durationMs,
        gainDb: reloadGainDb(levels),
        sounds: clip.sounds.map((s) => ({ atMs: s.atMs, stems: s.takes.map((t) => takeStem(t.file)) })),
      }
    }
    if (clips.combat || clips.crouch) out.set(tag, clips)
  }
  return out
}
