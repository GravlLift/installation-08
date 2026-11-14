/**
 * replayAudioMix.test.ts — WHAT THE MIXING KEEPS, AND IN WHICH ORDER.
 *
 * Web Audio does not exist under jsdom: what is tested here is the DECIDED part — which sounds
 * are kept, with what variant, and which ones the voice ceiling refuses. The render itself
 * (`OfflineAudioContext`) and the AAC encoding are verified by ear on a clip, and that is the
 * recipe gate of step E4 of the plan.
 *
 * THE MOST IMPORTANT POINT OF THIS FILE is the REPRODUCIBILITY: two exports of the same match
 * must sound the same, otherwise we can neither compare two versions of a clip, nor
 * re-deliver it identically.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyVoiceCap,
  mixSeed,
  planAudioMix,
  scheduleMix,
  seededRandom,
  soundUrlOf,
  tailSeconds,
  type MixedSound,
} from './replayAudioMix'
import { ReplayAudioPlayer, SOUND_MAX_VOICES } from './replayAudio'
import { FakeContext, flushAudio, installFakeAudio } from '../test/fakeAudio'
import type { ReplaySoundEvent } from './replaySoundVariants'

const BOUNDS = { startMs: 1000, endMs: 5000 }
const OPTS = { variationPercent: 0 }

/** A track with a variant gesture and two bare gestures, one OUTSIDE the range. */
const TIMELINE: ReplaySoundEvent[] = [
  { ms: 500, stem: 'avant_la_plage' },
  { ms: 1200, stem: 'tir_a', variants: ['tir_a', 'tir_a_2', 'tir_a_3'] },
  { ms: 2400, stem: 'explosion' },
  { ms: 4800, stem: 'tir_a', variants: ['tir_a', 'tir_a_2', 'tir_a_3'] },
  { ms: 9000, stem: 'apres_la_plage' },
]

describe('soundUrlOf — one URL per stem', () => {
  it('a stem gets the Ogg extension, a bundled sound and an extracted announcer take alike', () => {
    expect(soundUrlOf('explosion')).toBe('/static/sounds/halo_infinite/explosion.ogg')
    expect(soundUrlOf('announcer_doublekill_01')).toBe('/static/sounds/halo_infinite/announcer_doublekill_01.ogg')
  })
})

describe('seededRandom / mixSeed — the randomness becomes reproducible', () => {
  it('two generators of the same seed return the same sequence', () => {
    const a = seededRandom(1234)
    const b = seededRandom(1234)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('two different seeds diverge', () => {
    expect(seededRandom(1)()).not.toBe(seededRandom(2)())
  })

  it('the seed depends on the RANK AND the stem', () => {
    expect(mixSeed(0, 'tir_a')).not.toBe(mixSeed(1, 'tir_a'))
    expect(mixSeed(0, 'tir_a')).not.toBe(mixSeed(0, 'tir_b'))
  })

  it('the seed of a given rank is STABLE from one call to the other', () => {
    expect(mixSeed(7, 'explosion')).toBe(mixSeed(7, 'explosion'))
  })
})

describe('planAudioMix — what enters the clip', () => {
  it('keeps only the sounds of the range', () => {
    const out = planAudioMix(TIMELINE, BOUNDS, OPTS)
    expect(out).toHaveLength(3)
    expect(out.some((s) => s.stem.startsWith('avant'))).toBe(false)
    expect(out.some((s) => s.stem.startsWith('apres'))).toBe(false)
  })

  it('replaces the moments on the CLIP axis, not on that of the replay', () => {
    // The first sound of the exported match lands at 1200 - 1000 = 200 ms from the start of the file.
    expect(planAudioMix(TIMELINE, BOUNDS, OPTS)[0].atMs).toBe(200)
  })

  it('returns EXACTLY the same mixing twice in a row', () => {
    // The central guarantee of the module: two exports of the same match sound the same.
    expect(planAudioMix(TIMELINE, BOUNDS, OPTS)).toEqual(planAudioMix(TIMELINE, BOUNDS, OPTS))
  })

  it('two occurrences of the SAME gesture can draw different variants', () => {
    // That is the whole point of the variants: a repeated gesture must not sound like a loop.
    // The two shots share the stem but not the rank, therefore not the seed.
    const out = planAudioMix(TIMELINE, BOUNDS, OPTS)
    const tirs = out.filter((s) => s.stem.startsWith('tir_a'))
    expect(tirs).toHaveLength(2)
    expect(mixSeed(1, 'tir_a')).not.toBe(mixSeed(3, 'tir_a'))
  })

  it('the draw stays in the list of declared variants', () => {
    for (const s of planAudioMix(TIMELINE, BOUNDS, OPTS)) {
      expect(['tir_a', 'tir_a_2', 'tir_a_3', 'explosion']).toContain(s.stem)
    }
  })

  it('bounding the range DIFFERENTLY does not change the draw of the common sounds', () => {
    // The rank is that of the WHOLE track: exporting a round alone must make its
    // shots sound exactly like in the export of the whole match.
    const large = planAudioMix(TIMELINE, { startMs: 0, endMs: 10_000 }, OPTS)
    const etroit = planAudioMix(TIMELINE, BOUNDS, OPTS)
    const communs = large.filter((s) => s.atMs >= 1000 && s.atMs <= 5000).map((s) => s.stem)
    expect(etroit.map((s) => s.stem)).toEqual(communs)
  })

  it('places the end-of-match takes ON the end bound', () => {
    const out = planAudioMix(TIMELINE, BOUNDS, { ...OPTS, endMatchStems: ['fanfare'] })
    const fin = out.find((s) => s.stem === 'fanfare')
    expect(fin?.atMs).toBe(4000)
    // No variation on a fanfare: the RANGED ranges are those of the weapons.
    expect(fin?.draw).toEqual({ gainDb: 0, playbackRate: 1 })
  })

  it('returns the list sorted by moment', () => {
    const out = planAudioMix(TIMELINE, BOUNDS, { ...OPTS, endMatchStems: ['fanfare'] })
    expect(out.map((s) => s.atMs)).toEqual([...out.map((s) => s.atMs)].sort((a, b) => a - b))
  })
})

/**
 * THE PLACE FOR THE CLIP'S LISTENER: a 3D export follows a player, and its sounds are placed for
 * him like those of the page — gain according to distance, pan according to the bearing. Without a listener,
 * the mix is EXACTLY the one from before (no placement, no extra wiring).
 */
describe('planAudioMix — the placement for the clip listener', () => {
  // The listener is at the origin, turned toward +X: its right is -Y.
  const TIMELINE_LIEE: ReplaySoundEvent[] = [
    { ms: 2000, stem: 'proche', at: { x: 0, y: -0.2 } },
    { ms: 3000, stem: 'lointain', at: { x: 0, y: -10 } },
    { ms: 4000, stem: 'sans_lieu' },
  ]
  const AUDITEUR = () => ({ x: 0, y: 0, heading: 0 })

  it('a distant sound is lower than a close one, and a sound on the right pans right', () => {
    const out = planAudioMix(TIMELINE_LIEE, BOUNDS, { ...OPTS, listenerAt: AUDITEUR })
    const proche = out.find((s) => s.stem === 'proche')
    const loin = out.find((s) => s.stem === 'lointain')
    expect(proche?.place).toEqual({ gain: 1, pan: 0 })
    expect(loin?.place?.gain).toBeCloseTo(0.3)
    expect(loin?.place?.gain).toBeLessThan(1)
    expect(loin?.place?.pan).toBeGreaterThan(0)
    // Without a place, no placement: the sound plays as is.
    expect(out.find((s) => s.stem === 'sans_lieu')?.place).toBeUndefined()
  })

  it('without a listener, the mix is EXACTLY the one from before', () => {
    const sans = planAudioMix(TIMELINE_LIEE, BOUNDS, OPTS)
    const avec = planAudioMix(TIMELINE_LIEE, BOUNDS, { ...OPTS, listenerAt: AUDITEUR })
    expect(sans).toEqual(avec.map(({ place: _place, ...reste }) => reste))
  })
})

describe('scheduleMix — the placement, same wiring as the player', () => {
  const BUFFERS = new Map([['s', { duration: 1 } as AudioBuffer]])

  it('multiplies the hold gain by the gain of the placement', () => {
    const ctx = new FakeContext()
    const sons: MixedSound[] = [
      { atMs: 0, stem: 's', draw: { gainDb: 0, playbackRate: 1 }, family: 'sfx', place: { gain: 0.25, pan: 0 } },
    ]
    scheduleMix(ctx as unknown as BaseAudioContext, {} as AudioNode, sons, BUFFERS)
    expect(ctx.gains[0].gain.value).toBe(0.25)
    expect(ctx.panners).toHaveLength(0)
    expect(ctx.gains[0].connections).toHaveLength(1)
  })

  it('places a panner only when the pan is at a side', () => {
    const ctx = new FakeContext()
    const sons: MixedSound[] = [
      { atMs: 0, stem: 's', draw: { gainDb: 0, playbackRate: 1 }, family: 'sfx', place: { gain: 0.5, pan: 0.4 } },
    ]
    scheduleMix(ctx as unknown as BaseAudioContext, ctx.destination as AudioNode, sons, BUFFERS)
    expect(ctx.panners).toHaveLength(1)
    expect(ctx.panners[0].pan.value).toBe(0.4)
    expect(ctx.gains[0].connections).toEqual([ctx.panners[0]])
    expect(ctx.panners[0].connections).toEqual([ctx.destination])
  })

  it('without place: gain wired directly, no panner', () => {
    const ctx = new FakeContext()
    const sons: MixedSound[] = [
      { atMs: 0, stem: 's', draw: { gainDb: 0, playbackRate: 1 }, family: 'sfx' },
    ]
    scheduleMix(ctx as unknown as BaseAudioContext, ctx.destination as AudioNode, sons, BUFFERS)
    expect(ctx.panners).toHaveLength(0)
    expect(ctx.gains[0].connections).toEqual([ctx.destination])
  })
})

/** Makes N simultaneous sounds — enough to saturate the voice ceiling. */
function simultanes(n: number, atMs = 0): MixedSound[] {
  return Array.from({ length: n }, (_, i) => ({
    atMs,
    stem: `s${i}`,
    draw: { gainDb: 0, playbackRate: 1 },
    family: 'sfx' as const,
  }))
}

describe('applyVoiceCap — the same accounting as the real-time player', () => {
  const UNE_SECONDE = () => 1

  it('lets pass until the ceiling is reached', () => {
    expect(applyVoiceCap(simultanes(SOUND_MAX_VOICES), UNE_SECONDE)).toHaveLength(SOUND_MAX_VOICES)
  })

  it('refuses beyond the ceiling', () => {
    // Without that the export would sound louder and more confused than the page.
    expect(applyVoiceCap(simultanes(SOUND_MAX_VOICES + 5), UNE_SECONDE)).toHaveLength(
      SOUND_MAX_VOICES,
    )
  })

  it('releases the voices when the sounds have stopped', () => {
    const serres = simultanes(SOUND_MAX_VOICES, 0)
    const plusTard = simultanes(3, 5000)
    expect(applyVoiceCap([...serres, ...plusTard], UNE_SECONDE)).toHaveLength(
      SOUND_MAX_VOICES + 3,
    )
  })

  it('an absent asset is a silence, and occupies NO voice', () => {
    const sons = [...simultanes(2, 0), { atMs: 0, stem: 'absent', draw: { gainDb: 0, playbackRate: 1 }, family: 'sfx' as const }]
    const out = applyVoiceCap(sons, (stem) => (stem === 'absent' ? null : 1))
    expect(out.map((s) => s.stem)).toEqual(['s0', 's1'])
  })
})

/**
 * PARITY GUARDRAIL (item 11, 2026-09-26): the conclusion escaped the ceiling at the export
 * since 29/08, but not at the page — the fanfare of a dense end was heard in the clip and
 * not in the replay. The same saturated situation passes here through the TWO paths.
 */
describe('the conclusion — same rule at the page and at the export', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('ceiling full: the two paths keep the conclusion and refuse the extra ordinary sound', async () => {
    const conclusion = (stem: string): MixedSound => ({
      atMs: 0, stem, draw: { gainDb: 0, playbackRate: 1 }, family: 'music', conclusion: true,
    })
    const sons = [...simultanes(SOUND_MAX_VOICES + 1), conclusion('voix'), conclusion('fanfare')]
    const exportes = applyVoiceCap(sons, () => 1).map((s) => s.stem)

    const { ctx } = installFakeAudio(1)
    const p = new ReplayAudioPlayer(1)
    p.preload(sons.map((s) => `/${s.stem}.ogg`))
    await flushAudio()
    const joues: string[] = []
    for (const s of sons) {
      const avant = ctx.sources.length
      if (s.conclusion) p.playConclusion(`/${s.stem}.ogg`)
      else p.play(`/${s.stem}.ogg`)
      if (ctx.sources.length > avant) joues.push(s.stem)
    }

    expect(exportes).toHaveLength(SOUND_MAX_VOICES + 2)
    expect(exportes).toContain('fanfare')
    expect(joues).toEqual(exportes)
  })
})

describe('tailSeconds — what OVERFLOWS the bound', () => {
  const buffers = new Map([['fanfare', { duration: 10 } as AudioBuffer]])

  it('returns the overflow, not the absolute end', () => {
    // A 10 s fanfare placed at 4 s of a 5 s clip overflows by 9 s, not by 14.
    const sons: MixedSound[] = [{ atMs: 4000, stem: 'fanfare', draw: { gainDb: 0, playbackRate: 1 }, family: 'music' }]
    expect(tailSeconds(sons, buffers, 5000)).toBe(9)
  })

  it('returns zero when everything fits in the range', () => {
    const sons: MixedSound[] = [{ atMs: 0, stem: 'fanfare', draw: { gainDb: 0, playbackRate: 1 }, family: 'music' }]
    expect(tailSeconds(sons, buffers, 60_000)).toBe(0)
  })
})

/**
 * PARITY GUARDRAIL (control n° 7, 2026-10-21): the "round ended" voice lands in the middle
 * of the last shots and explosions of the round, which hold the eight voices. It passes out of
 * ceiling through the TWO paths, like the conclusion.
 */
describe('the round voice — out of ceiling at the page and at the export', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('planAudioMix carries the mark, and the full ceiling lets it pass on both sides', async () => {
    const timeline: ReplaySoundEvent[] = [
      ...Array.from({ length: SOUND_MAX_VOICES }, (_, i) => ({ ms: 1000, stem: `s${i}` })),
      { ms: 1000, stem: 'round_over_fr', announcer: true },
    ]
    const planned = planAudioMix(timeline, { startMs: 0, endMs: 5000 }, OPTS)
    expect(planned.find((s) => s.stem === 'round_over_fr')?.announcer).toBe(true)
    const exportes = applyVoiceCap(planned, () => 1).map((s) => s.stem)
    expect(exportes).toContain('round_over_fr')

    const { ctx } = installFakeAudio(1)
    const p = new ReplayAudioPlayer(1)
    p.preload(planned.map((s) => `/${s.stem}.ogg`))
    await flushAudio()
    const joues: string[] = []
    for (const s of planned) {
      const avant = ctx.sources.length
      if (s.announcer) p.playAnnouncer(`/${s.stem}.ogg`)
      else p.play(`/${s.stem}.ogg`)
      if (ctx.sources.length > avant) joues.push(s.stem)
    }
    expect(joues).toEqual(exportes)
    expect(joues).toHaveLength(SOUND_MAX_VOICES + 1)
  })
})
