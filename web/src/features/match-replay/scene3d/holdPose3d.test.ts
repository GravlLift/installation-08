// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** holdPose3d.test.ts — the held player's film mix: the fade out, the appended hold layer. */
import { describe, expect, it } from 'vitest'
import { newClipMix } from './clipSample3d'
import { type SpartanClip } from './clips3d'
import { type HoldState } from './hold3d'
import { holdMix } from './holdPose3d'

const filmClip = { name: 'combat:rifle:idle' } as SpartanClip
const overClip = { name: 'combat:rifle:melee' } as SpartanClip
const holdClip = { name: 'pose:i_see_you' } as SpartanClip
const state: HoldState = { sinceMs: 250, clipTimeS: 0.25, weight: 0.5, heading: 90, pitch: 0 }

function filmMix(): { film: ReturnType<typeof newClipMix> } {
  const film = newClipMix(16, 4)
  film.base[0].clip = filmClip
  film.base[0].weight = 0.6
  film.base[1].clip = filmClip
  film.base[1].weight = 0.4
  film.baseCount = 2
  film.over[0].clip = overClip
  film.over[0].weight = 0.5
  film.overCount = 1
  return { film }
}

describe('holdMix', () => {
  it('scales the film layers by 1 - weight and appends the hold clip as a base layer', () => {
    const { film } = filmMix()
    expect(holdMix(film, holdClip, state, true)).toBe(film) // the same mix, mutated
    expect(film.base[0].weight).toBeCloseTo(0.3)
    expect(film.base[1].weight).toBeCloseTo(0.2)
    expect(film.over[0].weight).toBeCloseTo(0.25)
    expect(film.baseCount).toBe(3)
    expect(film.base[2].clip).toBe(holdClip)
    expect(film.base[2].time).toBe(state.clipTimeS)
    expect(film.base[2].weight).toBe(state.weight)
    expect(film.base[2].loop).toBe(true)
    // The base weights keep summing to 1: the film's faded share is the hold's.
    let sum = 0
    for (let i = 0; i < film.baseCount; i++) sum += film.base[i].weight
    expect(sum).toBeCloseTo(1)
  })

  it('a null clip leaves the mix untouched', () => {
    const { film } = filmMix()
    expect(holdMix(film, null, state, false)).toBe(film)
    expect(film.base[0].weight).toBe(0.6)
    expect(film.base[1].weight).toBe(0.4)
    expect(film.over[0].weight).toBe(0.5)
    expect(film.baseCount).toBe(2)
  })

  it('a full base skips the append without throwing', () => {
    const film = newClipMix(2, 0)
    film.base[0].clip = filmClip
    film.base[0].weight = 1
    film.base[1].clip = filmClip
    film.base[1].weight = 0
    film.baseCount = 2
    expect(() => holdMix(film, holdClip, state, true)).not.toThrow()
    expect(film.base[0].weight).toBeCloseTo(0.5)
    expect(film.base[1].weight).toBe(0)
    expect(film.baseCount).toBe(2) // no room: no layer appended
  })

  it('a full weight empties the film', () => {
    const { film } = filmMix()
    const full: HoldState = { ...state, weight: 1 }
    holdMix(film, holdClip, full, false)
    expect(film.base[0].weight).toBe(0)
    expect(film.base[1].weight).toBe(0)
    expect(film.over[0].weight).toBe(0)
    expect(film.base[2].weight).toBe(1)
  })
})
