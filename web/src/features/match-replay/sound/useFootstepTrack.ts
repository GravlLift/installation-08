// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useFootstepTrack.ts — the extracted foot and movement sounds the track plays, read once.
 *
 * The manifest is read ONCE per page (`loadFootstepManifestOnce`), like the announcer's and the
 * reloads'. Nothing is read before the sound is on, the rule of the whole sound chain, and
 * nothing extracted (a 404) leaves the footsteps silent. The foot takes need no measurement:
 * their level is the fixed duck of `footstepSound.ts`, so there is no offline decode here.
 */
import { useEffect, useState } from 'react'

import { loadFootstepManifest, type FootstepManifest } from './footstepManifest'

let manifestOnce: Promise<FootstepManifest | null> | null = null

/** The extracted foot sounds' manifest, loaded once per page; `null` = nothing extracted. */
export function loadFootstepManifestOnce(): Promise<FootstepManifest | null> {
  manifestOnce ??= loadFootstepManifest()
  return manifestOnce
}

/** What the hook reads. Injectable for the tests. */
export interface FootstepSources {
  load: () => Promise<FootstepManifest | null>
}

const DEFAULT_SOURCES: FootstepSources = { load: loadFootstepManifestOnce }

/** useFootstepTrack — the foot sounds' manifest, or `undefined` until it is ready (or none exist). */
export function useFootstepTrack(enabled: boolean, sources: FootstepSources = DEFAULT_SOURCES): FootstepManifest | undefined {
  const [manifest, setManifest] = useState<FootstepManifest | undefined>(undefined)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void sources.load().then((m) => {
      if (live && m) setManifest(m)
    })
    return () => {
      live = false
    }
  }, [enabled, sources])
  return manifest
}
