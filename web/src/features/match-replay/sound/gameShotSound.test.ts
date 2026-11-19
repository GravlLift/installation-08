// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import type { FootstepManifest } from './footstepManifest'
import { withGameShots } from './gameShotSound'
import type { ReplaySoundEvent } from './replaySoundVariants'
import { falloffGain } from './soundSpatial'

// The Bandit's shot shape: far (silent under 16.8), near (full to 2, silent at 18), mid (7.1-29).
const FAR = [[0, -1, 9], [16.7759, -1, 6], [23, -0.645187, 2], [90, -1, 4]] as const
const NEAR = [[0, 0, 9], [2, 0, 4], [18, -1, 9], [90, -1, 4]] as const
const MID = [[0, -1, 9], [7.1, -1, 4], [9, -0.331656, 4], [20, -0.498813, 2], [29, -1, 9], [90, -1, 4]] as const

const take = (n: number, gainDb: number, falloff: string) => ({ file: `foot_${n}.ogg`, media: n, durationMs: 1000, gainDb, falloff })

const MANIFEST: FootstepManifest = {
  version: 3,
  feet: {},
  movement: {},
  shots: {
    hinf_bandit: {
      takes: [take(1, -4.5, 'far'), take(2, -4.5, 'far'), take(3, -5, 'near'), take(4, -5, 'near'), take(5, -8.5, 'mid')],
      layers: [[0, 1], [2, 3], [4]],
    },
  },
  falloffs: { far: { volume: FAR }, near: { volume: NEAR }, mid: { volume: MID } },
}

describe('withGameShots', () => {
  it('plays a placed shot as its three layers, takes drawn at playback, balance kept with the loudest at 0 dB', () => {
    const shot: ReplaySoundEvent = { ms: 100, stem: 'hinf_bandit', at: { x: 5, y: 0 }, gainDb: -4 }
    const out = withGameShots([shot], MANIFEST)
    expect(out).toHaveLength(3)
    expect(out[0]).toMatchObject({ ms: 100, stem: 'foot_1', variants: ['foot_1', 'foot_2'], weapon: 'hinf_bandit', gainDb: -4, falloff: FAR, at: { x: 5, y: 0 } })
    expect(out[1]).toMatchObject({ stem: 'foot_3', variants: ['foot_3', 'foot_4'], gainDb: -4.5, falloff: NEAR })
    expect(out[2].variants).toBeUndefined()
    expect(out[2]).toMatchObject({ stem: 'foot_5', gainDb: -8, falloff: MID })
  })

  it('plays the followed player\'s own shot at distance zero: only the near layer, no falloff', () => {
    const out = withGameShots([{ ms: 0, stem: 'hinf_bandit' }], MANIFEST)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ stem: 'foot_3', gainDb: -0.5 })
    expect(out[0].falloff).toBeUndefined()
    expect(falloffGain(NEAR, 0)).toBe(1)
  })

  it('leaves other stems, held bursts and a manifest without shots alone', () => {
    const other: ReplaySoundEvent = { ms: 0, stem: 'hinf_ma40_ar' }
    const held: ReplaySoundEvent = { ms: 0, stem: 'hinf_bandit', holdMs: 400 }
    expect(withGameShots([other, held], MANIFEST)).toEqual([other, held])
    expect(withGameShots([{ ms: 0, stem: 'hinf_bandit' }], { ...MANIFEST, shots: undefined })).toEqual([{ ms: 0, stem: 'hinf_bandit' }])
  })

  it('never drops a variant list onto the take of another weapon\'s shipped file', () => {
    const out = withGameShots([{ ms: 0, stem: 'hinf_bandit', variants: ['hinf_bandit', 'hinf_bandit_b'], at: { x: 1, y: 1 } }], MANIFEST)
    expect(out.every((e) => !e.variants || e.variants.every((v) => v.startsWith('foot_')))).toBe(true)
  })
})
