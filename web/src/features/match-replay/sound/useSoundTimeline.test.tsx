/**
 * useSoundTimeline.test.tsx — the footsteps MERGE into the track the page plays and the export
 * mixes. A manifest present on a walking match puts foot steps in the timeline; the followed
 * player's own steps are unplaced, the others' are.
 */
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReplayKill } from '../model/killFeedLogic'
import { testReplayDoc } from '../test/testDoc'
import type { FootstepManifest } from './footstepManifest'
import { SOUND_CATEGORIES_DEFAULT } from './replaySound'
import { useSoundTimeline, type SoundTimelineInputs } from './useSoundTimeline'

const MANIFEST = vi.hoisted((): FootstepManifest => ({
  version: 1,
  feet: { default: { walk: { takes: [{ file: 'foot_walk.ogg', media: 1, durationMs: 180 }] } } },
  movement: {},
}))

// A single reload sound placed EARLY (ms 1): it only sorts to the front of the track when the
// merged timeline is sorted. A non-empty library is enough for `useSoundTimeline` to append it.
const RELOAD = vi.hoisted(() => [{ ms: 1, stem: 'reload_x' }])
const state = vi.hoisted(() => ({ footstep: true, reloads: false }))

vi.mock('./useFootstepTrack', () => ({
  useFootstepTrack: () => (state.footstep ? MANIFEST : undefined),
}))
vi.mock('./useReloadTrack', () => ({
  useReloadTrack: () => (state.reloads ? { reloads: new Map(), vents: new Map() } : undefined),
}))
vi.mock('./reloadSound', () => ({
  reloadSoundEvents: () => (state.reloads ? RELOAD : []),
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

/** A kill at 2,000 ms: a base-track event that sorts AFTER the early reload. */
const KILL: ReplayKill = {
  replayMs: 2_000, tMs: 2_000, xuid: 'K', teamID: 0, medals: [],
  weaponKey: 'hinf_br75', weaponLabel: 'BR75', weaponImageUrl: '', weaponTinted: false,
  assistState: '', assistGamertag: '', assistTeamID: null,
  killerDamagePct: null, assistDamagePct: null,
  victimXuid: 'V', victimGamertag: 'Victim',
}

describe('useSoundTimeline — footsteps', () => {
  beforeEach(() => {
    state.footstep = true
    state.reloads = false
  })

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

  it('reloads present, footsteps null -> the timeline is sorted by ms', () => {
    state.reloads = true
    state.footstep = false
    const { result } = renderHook(() => useSoundTimeline(walkingDoc(), [KILL], inputs('ME')))
    const timeline = result.current.timeline
    expect(timeline.some((e) => e.stem === 'reload_x')).toBe(true)
    expect(timeline.map((e) => e.ms)).toEqual([...timeline].sort((a, b) => a.ms - b.ms).map((e) => e.ms))
    // The early reload sorts to the front, before the kill.
    expect(timeline[0].ms).toBe(1)
  })
})
