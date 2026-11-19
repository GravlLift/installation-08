// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * footstepManifest.ts — THE EXTRACTED FOOT AND MOVEMENT SOUNDS, as the viewer reads them.
 *
 * `build-sounds` (and the server's sound job) extract the Spartan's foot and movement sounds from
 * the user's game install into the data directory and write `footsteps.json` next to the takes
 * (`internal/footstepsounds`). Nothing of it is bundled: on a machine where nothing was extracted
 * the manifest is a 404 and the footsteps stay silent, without an error.
 *
 * THE MANIFEST IS KEYED BY SURFACE ("default", "dirt", "sand", …), then by the FOOT ACTION the
 * game plays for it ("walk", "run", "sprint", "shuffle", "slide", "land", "landhard" — grasstall
 * and rock have no slide). The MOVEMENT sounds ("land", "landhard", "slide_into", "slide_outof",
 * "jumpup") are a flat map alongside. Each entry is a set of takes, one of which the viewer draws.
 */

import type { SoundFalloff } from './soundSpatial'

/** The surfaces the extraction knows. */
export type FootstepSurface =
  | 'default'
  | 'dirt'
  | 'sand'
  | 'grass'
  | 'grasstall'
  | 'gravel'
  | 'rock'
  | 'wood'
  | 'metal'
  | 'metalgrate'
  | 'mud'
  | 'snow'
  | 'energy'
  | 'waterdeep'
  | 'watershallow'

/** The foot actions a surface can carry (grasstall and rock have no slide). */
export type FootstepAction = 'walk' | 'run' | 'sprint' | 'shuffle' | 'slide' | 'land' | 'landhard'

/** The movement sounds. */
export type FootstepMovement = 'land' | 'landhard' | 'slide_into' | 'slide_outof' | 'jumpup'

/** One extracted media, as the manifest writes it. */
export interface FootstepTake {
  file: string
  media: number
  durationMs: number
  /** The volume the game's mix hierarchy authors for it, in dB (version 3). */
  gainDb?: number
  /** The key in `falloffs` of the distance falloff it plays with (version 3). */
  falloff?: string
}

/** The set of takes one sound draws from. */
export interface FootstepEntry {
  takes: ReadonlyArray<FootstepTake>
  /**
   * What the game plays together (version 3): one take of every layer sounds at once, each layer
   * a list of indexes into `takes`. Absent: one layer of every take.
   */
  layers?: ReadonlyArray<ReadonlyArray<number>>
}

/** The manifest `build-sounds` writes (`internal/footstepsounds/manifest.go`). */
export interface FootstepManifest {
  version: number
  feet: Readonly<Record<string, Readonly<Partial<Record<string, FootstepEntry>>>>>
  movement: Readonly<Record<string, FootstepEntry>>
  /** The distance falloffs the takes name, by attenuation id (version 3). */
  falloffs?: Readonly<Record<string, { volume: SoundFalloff }>>
}

/** One layer of a sound: the takes it draws one of, each with its stem. */
export type FootstepLayer = ReadonlyArray<FootstepTake & { stem: string }>

/** layersOf — the layers of an entry, each take with its stem; `null` when the entry is empty. */
export function layersOf(entry: FootstepEntry | undefined): FootstepLayer[] | null {
  const takes = entry?.takes
  if (!takes || takes.length === 0) return null
  const withStem = takes.map((t) => ({ ...t, stem: footTakeStem(t.file) }))
  const layers = (entry.layers ?? [])
    .map((l) => l.filter((i) => i >= 0 && i < withStem.length).map((i) => withStem[i]))
    .filter((l) => l.length > 0)
  return layers.length > 0 ? layers : [withStem]
}

/** falloffOf — the falloff a take names, if the manifest has it. */
export function falloffOf(manifest: FootstepManifest, take: FootstepTake): SoundFalloff | undefined {
  return take.falloff ? manifest.falloffs?.[take.falloff]?.volume : undefined
}

/** Where the sound route serves the manifest. */
export const FOOTSTEP_MANIFEST_URL = '/static/sounds/halo_infinite/footsteps.json'

/** The oldest manifest version this viewer reads. */
const FOOTSTEP_MANIFEST_VERSION = 1

const isTake = (t: unknown): t is FootstepTake =>
  !!t && typeof t === 'object' && typeof (t as FootstepTake).file === 'string' && typeof (t as FootstepTake).durationMs === 'number'

const isEntry = (e: unknown): e is FootstepEntry => !!e && typeof e === 'object' && Array.isArray((e as FootstepEntry).takes) && (e as FootstepEntry).takes.every(isTake)

/** parseFootstepManifest checks the manifest's shape; anything else reads as nothing extracted. */
export function parseFootstepManifest(raw: unknown): FootstepManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Partial<FootstepManifest>
  if (typeof m.version !== 'number' || m.version < FOOTSTEP_MANIFEST_VERSION) return null
  if (!m.feet || typeof m.feet !== 'object' || !m.movement || typeof m.movement !== 'object') return null
  for (const actions of Object.values(m.feet)) {
    if (!actions || typeof actions !== 'object') return null
    for (const entry of Object.values(actions)) if (entry && !isEntry(entry)) return null
  }
  for (const entry of Object.values(m.movement)) if (entry && !isEntry(entry)) return null
  return m as FootstepManifest
}

/** loadFootstepManifest reads the manifest from the sound route; `null` when nothing was extracted. */
export async function loadFootstepManifest(fetchFn: typeof fetch | undefined = globalThis.fetch): Promise<FootstepManifest | null> {
  if (typeof fetchFn !== 'function') return null
  try {
    const res = await fetchFn(FOOTSTEP_MANIFEST_URL)
    if (!res.ok) return null
    return parseFootstepManifest(await res.json())
  } catch {
    return null
  }
}

/** footTakeStem is the sound stem of a take file: the file name without its `.ogg`. */
export function footTakeStem(file: string): string {
  return file.replace(/\.ogg$/, '')
}

/** The playable stems of the foot takes for a surface and action, or `null` when none were extracted. */
export function footStems(manifest: FootstepManifest, surface: string, action: string): string[] | null {
  const takes = manifest.feet[surface]?.[action]?.takes
  if (!takes || takes.length === 0) return null
  return takes.map((t) => footTakeStem(t.file))
}

/** The playable stems of a movement sound, or `null` when none was extracted. */
export function movementStems(manifest: FootstepManifest, name: string): string[] | null {
  const takes = manifest.movement[name]?.takes
  if (!takes || takes.length === 0) return null
  return takes.map((t) => footTakeStem(t.file))
}
