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
 * game: the melee weapons never reload, and the heat weapons (Stalker, Plasma Pistol, Pulse
 * Carbine, Ravager) vent instead — their vent clips are in the `vents` map since version 2,
 * keyed the same way (tag, then stance).
 */
import { reloadGainDb, type TakeLevel } from './reloadLoudness'

/** The stances the game has a reload animation for. */
export type ReloadStance = 'combat' | 'crouch'

/** The manifest `build-sounds` writes (`internal/reloadsounds/manifest.go`). */
export interface ReloadManifest {
  version: number
  weapons: Readonly<Record<string, Readonly<Partial<Record<ReloadStance, ReloadManifestClip>>>>>
  /**
   * The heat weapons' vents (manifest v2), per weapon tag, per stance: the enter, loop and exit
   * clips. The loop posts no sound in the installed game, so it carries a length only.
   */
  vents?: Readonly<Record<string, Readonly<Partial<Record<ReloadStance, VentManifest>>>>>
}

export interface ReloadManifestClip {
  animation: string
  durationMs: number
  sounds: ReadonlyArray<{ atMs: number; takes: ReadonlyArray<{ file: string; durationMs: number }> }>
}

/** One heat weapon's vent in the manifest: its three phase clips. */
export interface VentManifest {
  enter: ReloadManifestClip
  loop: ReloadManifestClip
  exit: ReloadManifestClip
}

/** One reload animation as the track plays it: its length, its gain, and each sound's moment and stems. */
export interface ReloadClip {
  durationMs: number
  gainDb: number
  sounds: ReadonlyArray<{ atMs: number; stems: readonly string[] }>
}

/** The reloads by weapon tag, then stance. */
export type ReloadLibrary = ReadonlyMap<string, Readonly<Partial<Record<ReloadStance, ReloadClip>>>>

/** One heat weapon's vent as the track plays it: each phase with its gain and sounds (the loop is silent). */
export interface VentClip {
  enter: ReloadClip
  loop: ReloadClip
  exit: ReloadClip
}

/** The vents by weapon tag, then stance. */
export type VentLibrary = ReadonlyMap<string, Readonly<Partial<Record<ReloadStance, VentClip>>>>

/** Where the sound route serves the manifest. */
export const RELOAD_MANIFEST_URL = '/static/sounds/halo_infinite/reloads.json'

/** The oldest manifest version this viewer reads (v2 carries the vents). */
const RELOAD_MANIFEST_VERSION = 2

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

/**
 * The shape of one manifest clip: a length and a list of sounds. A clip that posts no sound may carry
 * `sounds: null`: the server's v2 manifests write a silent vent loop that way (a Go nil list), and
 * refusing it refused the whole manifest, every reload of every weapon silenced (fixed 2026-11-16).
 */
function isClip(clip: unknown): clip is ReloadManifestClip {
  if (!clip || typeof (clip as ReloadManifestClip).durationMs !== 'number') return false
  const sounds = (clip as { sounds?: unknown }).sounds
  return Array.isArray(sounds) || sounds === null
}

/** withSounds: the clip with a null `sounds` read as the empty list. */
function withSounds(clip: ReloadManifestClip): ReloadManifestClip {
  return clip.sounds === null ? { ...clip, sounds: [] } : clip
}

/** parseReloadManifest checks the manifest's shape; anything else reads as nothing extracted. */
export function parseReloadManifest(raw: unknown): ReloadManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Partial<ReloadManifest>
  if (typeof m.version !== 'number' || m.version < RELOAD_MANIFEST_VERSION) return null
  if (!m.weapons || typeof m.weapons !== 'object') return null
  const weapons: Record<string, Partial<Record<ReloadStance, ReloadManifestClip>>> = {}
  for (const [tag, stances] of Object.entries(m.weapons)) {
    const out: Partial<Record<ReloadStance, ReloadManifestClip>> = {}
    for (const [stance, clip] of Object.entries(stances ?? {})) {
      if (!isClip(clip)) return null
      out[stance as ReloadStance] = withSounds(clip)
    }
    weapons[tag] = out
  }
  let vents: Record<string, Partial<Record<ReloadStance, VentManifest>>> | undefined
  if (m.vents) {
    vents = {}
    for (const [tag, stances] of Object.entries(m.vents)) {
      const out: Partial<Record<ReloadStance, VentManifest>> = {}
      for (const [stance, vent] of Object.entries(stances ?? {})) {
        if (!vent || !isClip(vent.enter) || !isClip(vent.loop) || !isClip(vent.exit)) return null
        out[stance as ReloadStance] = { enter: withSounds(vent.enter), loop: withSounds(vent.loop), exit: withSounds(vent.exit) }
      }
      vents[tag] = out
    }
  }
  return { ...(m as ReloadManifest), weapons, ...(vents ? { vents } : {}) }
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

/** The take files of the given weapon tags' reloads and vents, each once. */
export function takeFilesOf(manifest: ReloadManifest, tags: Iterable<string>): string[] {
  const files = new Set<string>()
  const of = (clip: ReloadManifestClip | undefined) => {
    for (const s of clip?.sounds ?? []) for (const t of s.takes) files.add(t.file)
  }
  for (const tag of tags) {
    const w = manifest.weapons[tag]
    if (w) for (const stance of STANCES) of(w[stance])
    const v = manifest.vents?.[tag]
    if (v) {
      for (const stance of STANCES) {
        const vent = v[stance]
        if (vent) {
          of(vent.enter)
          of(vent.loop)
          of(vent.exit)
        }
      }
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
      clips[stance] = clipOf(clip, levelOf)
    }
    if (clips.combat || clips.crouch) out.set(tag, clips)
  }
  return out
}

/**
 * ventLibrary builds the track's vents for the given heat weapon tags, each phase with its gain
 * (`reloadGainDb`) from the takes' measured levels, as the reloads get it.
 */
export function ventLibrary(
  manifest: ReloadManifest,
  tags: Iterable<string>,
  levelOf: (file: string) => TakeLevel | null | undefined,
): VentLibrary {
  const out = new Map<string, Partial<Record<ReloadStance, VentClip>>>()
  for (const tag of tags) {
    const stances = manifest.vents?.[tag]
    if (!stances) continue
    const clips: Partial<Record<ReloadStance, VentClip>> = {}
    for (const stance of STANCES) {
      const vent = stances[stance]
      if (!vent) continue
      clips[stance] = { enter: clipOf(vent.enter, levelOf), loop: clipOf(vent.loop, levelOf), exit: clipOf(vent.exit, levelOf) }
    }
    if (clips.combat || clips.crouch) out.set(tag, clips)
  }
  return out
}

/** One manifest clip as the track plays it: its length, its gain, and each sound's stems. */
function clipOf(clip: ReloadManifestClip, levelOf: (file: string) => TakeLevel | null | undefined): ReloadClip {
  const levels = clip.sounds.map((s) => s.takes.map((t) => levelOf(t.file)).filter((l): l is TakeLevel => !!l))
  return {
    durationMs: clip.durationMs,
    gainDb: reloadGainDb(levels),
    sounds: clip.sounds.map((s) => ({ atMs: s.atMs, stems: s.takes.map((t) => takeStem(t.file)) })),
  }
}
