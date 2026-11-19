// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import type { FootstepManifest } from './footstepManifest'
import { FIRST_PERSON_SHOT_DB, withGameShots } from './gameShotSound'
import type { ReplaySoundEvent } from './replaySoundVariants'
import { falloffGain } from './soundSpatial'
import { DRY_SEND_DB, reverbSendOf } from './zoneReverb'

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

// The Bandit's first-person shot: a stereo take among several (+4.5 dB), a thump (-5), a click (-8); no falloff.
const FIRST_PERSON: FootstepManifest = {
  ...MANIFEST,
  shotsFirstPerson: {
    hinf_bandit: { takes: [{ ...take(11, 4.5, ''), reverbDb: -60 }, { ...take(12, 4.5, ''), reverbDb: -60 }, { ...take(13, -5, ''), reverbDb: 0 }, take(14, -8, '')], layers: [[0, 1], [2], [3]] },
  },
}

describe('withGameShots', () => {
  it('plays the followed player\'s own shot as the first-person event: its layers, loudest at the trim, no falloff, all dry', () => {
    const out = withGameShots([{ ms: 0, stem: 'hinf_bandit', gainDb: -2 }], FIRST_PERSON)
    const t = FIRST_PERSON_SHOT_DB
    // Dry whatever the takes' 0x17 sums say: the first-person chain leaves the game-defined sends off.
    expect(out.map((e) => [e.stem, e.gainDb, e.falloff, e.reverbDb])).toEqual([['foot_11', -2 + t, undefined, DRY_SEND_DB], ['foot_13', -11.5 + t, undefined, DRY_SEND_DB], ['foot_14', -14.5 + t, undefined, DRY_SEND_DB]])
    expect(out.map((e) => reverbSendOf(e.reverbDb))).toEqual([0, 0, 0])
    expect(out[0].variants).toEqual(['foot_11', 'foot_12'])
  })

  it('keeps the third-person layers for another player\'s shot when a first-person event exists', () => {
    const out = withGameShots([{ ms: 0, stem: 'hinf_bandit', at: { x: 3, y: 0 } }], FIRST_PERSON)
    expect(out.map((e) => e.stem)).toEqual(['foot_1', 'foot_3', 'foot_5'])
  })

  it('anchors at the loudest the shot gets at any distance, not its loudest authored layer', () => {
    // The S7's shape: its +10 dB far layer is silent under 20 units, its +6 dB near layer full at 0.
    const far = [[0, -1, 9], [20, -1, 6], [30, -0.610311, 4], [90, -1, 4]] as const
    const near = [[0, 0, 9], [2, 0, 4], [29.8, -1, 9], [90, -1, 4]] as const
    const s7: FootstepManifest = {
      version: 4, feet: {}, movement: {},
      shots: { hinf_s7_sniper: { takes: [take(21, 6, 'n'), take(22, 10, 'f')], layers: [[0], [1]] } },
      falloffs: { n: { volume: near }, f: { volume: far } },
    }
    const [n] = withGameShots([{ ms: 0, stem: 'hinf_s7_sniper' }], s7)
    expect(n).toMatchObject({ stem: 'foot_21', gainDb: 0 })
  })

  it('plays a placed shot as its three layers, takes drawn at playback, balance kept with the shot\'s peak at 0 dB', () => {
    const shot: ReplaySoundEvent = { ms: 100, stem: 'hinf_bandit', at: { x: 5, y: 0 }, gainDb: -4 }
    const out = withGameShots([shot], MANIFEST)
    expect(out).toHaveLength(3)
    expect(out[0]).toMatchObject({ ms: 100, stem: 'foot_1', variants: ['foot_1', 'foot_2'], weapon: 'hinf_bandit', gainDb: -3.5, falloff: FAR, at: { x: 5, y: 0 } })
    expect(out[1]).toMatchObject({ stem: 'foot_3', variants: ['foot_3', 'foot_4'], gainDb: -4, falloff: NEAR })
    expect(out[2].variants).toBeUndefined()
    expect(out[2]).toMatchObject({ stem: 'foot_5', gainDb: -7.5, falloff: MID })
  })

  it('without a first-person event, plays the followed player\'s own shot at distance zero: only the near layer, no falloff', () => {
    const out = withGameShots([{ ms: 0, stem: 'hinf_bandit' }], MANIFEST)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ stem: 'foot_3', gainDb: 0 })
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
