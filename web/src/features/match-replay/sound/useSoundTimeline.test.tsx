/**
 * useSoundTimeline.test.tsx — the footsteps MERGE into the track the page plays and the export
 * mixes. A manifest present on a walking match puts foot steps in the timeline; the followed
 * player's own steps are unplaced, the others' are.
 */
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { testReplayDoc } from '../test/testDoc'
import type { FootstepManifest } from './footstepManifest'
import { SOUND_CATEGORIES_DEFAULT } from './replaySound'
import { useSoundTimeline, type SoundTimelineInputs } from './useSoundTimeline'

const MANIFEST = vi.hoisted((): FootstepManifest => ({
  version: 1,
  feet: { default: { walk: { takes: [{ file: 'foot_walk.ogg', media: 1, durationMs: 180 }] } } },
  movement: {},
}))

vi.mock('./useFootstepTrack', () => ({
  useFootstepTrack: () => MANIFEST,
}))

function inputs(followed: string | null): SoundTimelineInputs {
  return {
    categories: SOUND_CATEGORIES_DEFAULT,
    sideOfXuid: () => 'enemy',
    allyTeam: null,
    announcer: { locale: undefined, followed, medals: [] },
    on: true,
  }
}

function walkingDoc(): Parameters<typeof useSoundTimeline>[0] {
  return testReplayDoc({
    frameIntervalMs: 20,
    tracks: [
      { slot: 1, team: -1, xuid: 'ME', points: Array.from({ length: 121 }, (_, i) => ({ t: i, x: i * 0.04, y: 0 })), startFrame: 0, endFrame: 120 },
      { slot: 2, team: -1, xuid: 'OTHER', points: Array.from({ length: 121 }, (_, i) => ({ t: i, x: 4 + i * 0.04, y: 3 })), startFrame: 0, endFrame: 120 },
    ],
  })
}

describe('useSoundTimeline — footsteps', () => {
  it('a manifest puts foot steps into the track', () => {
    const { result } = renderHook(() => useSoundTimeline(walkingDoc(), [], inputs('ME')))
    const footsteps = result.current.timeline.filter((e) => e.stem === 'foot_walk')
    expect(footsteps.length).toBeGreaterThan(0)
  })

  it('the followed player is unplaced, the others placed', () => {
    const { result } = renderHook(() => useSoundTimeline(walkingDoc(), [], inputs('ME')))
    const footsteps = result.current.timeline.filter((e) => e.stem === 'foot_walk')
    expect(footsteps.some((e) => e.at === undefined)).toBe(true)
    expect(footsteps.some((e) => e.at !== undefined)).toBe(true)
  })

})
