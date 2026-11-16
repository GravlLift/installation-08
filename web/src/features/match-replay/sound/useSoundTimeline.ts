/**
 * useSoundTimeline.ts — THE TRACK the page plays and the export mixes: `buildSoundTimeline` with
 * the two inputs that arrive from the user's game install after the sound is turned on, the
 * announcer's extracted voice (`useAnnouncerTrack`) and the weapons' reloads (`useReloadTrack`).
 *
 * Extracted from `useReplaySound.ts` (over its size threshold) when the reloads arrived. The
 * reloads are WEAPON sounds: the drawer's weapon category cuts them with the shots.
 */
import { useMemo } from 'react'

import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import type { ReplayKill } from '../model/killFeedLogic'
import type { AnnouncerTrackInput } from './announcerSound'
import type { ObjectiveSide } from './objectiveSound'
import { footstepSoundEvents } from './footstepSound'
import { reloadSoundEvents } from './reloadSound'
import { buildSoundTimeline, type SoundCategoryFilter } from './replaySound'
import type { ReplaySoundEvent } from './replaySoundVariants'
import { useAnnouncerTrack, type AnnouncerContext } from './useAnnouncerTrack'
import { useFootstepTrack } from './useFootstepTrack'
import { useReloadTrack } from './useReloadTrack'

/**
 * THE SURFACE the footsteps read until a later task picks it per material: the film carries no
 * per-frame surface data, so every foot sound draws from the "default" set.
 */
const FOOTSTEP_SURFACE = 'default'

/** What the track is built from, besides the film and its kills. */
export interface SoundTimelineInputs {
  categories: SoundCategoryFilter
  sideOfXuid: (xuid: string) => ObjectiveSide
  allyTeam: number | null
  announcer: AnnouncerContext
  /** The sound is on: the extracted inputs are read only then. */
  on: boolean
}

/** useSoundTimeline — the track, and the announcer's input it was built with (the export's voice families read it). */
export function useSoundTimeline(
  doc: ReplayDocumentReady,
  kills: readonly ReplayKill[],
  inputs: SoundTimelineInputs,
): { timeline: ReplaySoundEvent[]; announcer: AnnouncerTrackInput | undefined } {
  const { categories, sideOfXuid, allyTeam, on } = inputs
  const announcer = useAnnouncerTrack(inputs.announcer, on)
  const reloads = useReloadTrack(doc, on)
  const footsteps = useFootstepTrack(on)
  const followed = inputs.announcer.followed
  const timeline = useMemo(() => {
    const track = buildSoundTimeline(doc, kills, categories, sideOfXuid, allyTeam, announcer)
    const withReloads = !categories.weapon || !reloads ? track : [...track, ...reloadSoundEvents(doc, reloads)]
    if (!footsteps) return withReloads
    return [...withReloads, ...footstepSoundEvents(footsteps, doc, FOOTSTEP_SURFACE, followed)].sort((a, b) => a.ms - b.ms)
  }, [doc, kills, categories, sideOfXuid, allyTeam, announcer, reloads, footsteps, followed])
  return { timeline, announcer }
}
