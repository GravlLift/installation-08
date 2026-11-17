// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useReloadTrack.ts — the extracted weapon sounds the track plays, measured once: the reloads
 * and the heat weapons' vents.
 *
 * The manifest is read ONCE per page (`loadReloadManifestOnce`), and every take is measured once
 * per page (`measureTakeOnce`): decoded in an offline context, whose decoding no user gesture
 * gates, for the level rule of `reloadLoudness.ts`. Only the takes of the weapons the match
 * holds are measured. Nothing is read before the sound is on, the rule of the whole sound chain,
 * and nothing extracted (a 404) leaves the reloads and the vents silent.
 */
import { useEffect, useMemo, useState } from 'react'

import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { soundUrlOf } from './replayAudioMix'
import { levelOf, type TakeLevel } from './reloadLoudness'
import {
  loadReloadManifest,
  reloadLibrary,
  stagedLibrary,
  takeFilesOf,
  takeStem,
  ventLibrary,
  weaponTagOf,
  type ReloadLibrary,
  type ReloadManifest,
  type StagedLibrary,
  type VentLibrary,
} from './reloadManifest'

/** The match's extracted weapon sounds, ready to play: the reloads and the vents. */
export interface ReloadTrack {
  reloads: ReloadLibrary
  vents: VentLibrary
  /** The staged reloads' first-person sounds (the followed player's). */
  staged: StagedLibrary
}

/** What the hook reads: the manifest, and a take's level. Injectable for the tests. */
export interface ReloadSources {
  load: () => Promise<ReloadManifest | null>
  measure: (file: string) => Promise<TakeLevel | null>
}

let manifestOnce: Promise<ReloadManifest | null> | null = null
const levels = new Map<string, Promise<TakeLevel | null>>()

/** The extracted reloads' manifest, loaded once per page; `null` = nothing extracted. */
export function loadReloadManifestOnce(): Promise<ReloadManifest | null> {
  manifestOnce ??= loadReloadManifest()
  return manifestOnce
}

/** A take's level, measured once per page; `null` when it cannot be fetched or decoded. */
export function measureTakeOnce(file: string): Promise<TakeLevel | null> {
  let p = levels.get(file)
  if (!p) {
    p = measureTake(file)
    levels.set(file, p)
  }
  return p
}

async function measureTake(file: string): Promise<TakeLevel | null> {
  if (typeof OfflineAudioContext !== 'function') return null
  try {
    const res = await fetch(soundUrlOf(takeStem(file)))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = await new OfflineAudioContext(1, 1, 48_000).decodeAudioData(await res.arrayBuffer())
    return levelOf(Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)))
  } catch (err) {
    // The take will not play either: one trace, and the reload's gain leaves it out.
    console.warn('replay 3D: reload take not measured:', file, err)
    return null
  }
}

const DEFAULT_SOURCES: ReloadSources = { load: loadReloadManifestOnce, measure: measureTakeOnce }

/** The weapon tags a match holds, from its weapon labels. */
function weaponTagsOf(doc: ReplayDocumentReady): string[] {
  const tags = new Set<string>()
  for (const id of Object.keys(doc.weaponLabels ?? {})) {
    const tag = weaponTagOf(id)
    if (tag) tags.add(tag)
  }
  return [...tags]
}

/** useReloadTrack — the match's reloads and vents with their gains, or `undefined` until ready (or none exist). */
export function useReloadTrack(doc: ReplayDocumentReady, enabled: boolean, sources: ReloadSources = DEFAULT_SOURCES): ReloadTrack | undefined {
  const tags = useMemo(() => weaponTagsOf(doc), [doc])
  const [track, setTrack] = useState<ReloadTrack | undefined>(undefined)
  useEffect(() => {
    // A match that names no weapon has no reload or vent to sound: nothing to read.
    if (!enabled || tags.length === 0) return
    let live = true
    void (async () => {
      const manifest = await sources.load()
      if (!manifest) return
      const files = takeFilesOf(manifest, tags)
      const measured = new Map(await Promise.all(files.map(async (f) => [f, await sources.measure(f)] as const)))
      const levelOf = (f: string) => measured.get(f)
      if (live) setTrack({ reloads: reloadLibrary(manifest, tags, levelOf), vents: ventLibrary(manifest, tags, levelOf), staged: stagedLibrary(manifest, tags, levelOf) })
    })()
    return () => {
      live = false
    }
  }, [enabled, tags, sources])
  return track
}
