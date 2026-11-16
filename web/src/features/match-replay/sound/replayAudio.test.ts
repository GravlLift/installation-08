/**
 * replayAudio.test.ts — THE ENGINE, on a laboratory AudioContext.
 *
 * What is verified here is not heard by ear and breaks silently: that a sound goes out
 * properly (trigger), that it plays to the end of ITS file with an output fade
 * (the duration per category is carried by the asset since 2026-08-16; the player keeps
 * only a safety ceiling), that an absent file stays a MEMORIZED SILENCE (never a
 * re-attempt per kill, never a replacement sound), and that a sustained exchange does
 * not make a wall of voices.
 *
 * jsdom has no Web Audio: the context is an instrumented double that notes what is asked
 * of it. It does not judge the sound render — that is the listening gate that does it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  admitVoice,
  ReplayAudioPlayer,
  SOUND_CUT_MAX_S,
  SOUND_FADE_S,
  SOUND_MAX_VOICES,
  SOUND_STEAL_FADE_S,
  soundEnvelope,
  soundEnvelopeOf,
  voiceLevelOf,
  VOLUME_RAMP_S,
} from './replayAudio'
import {
  type FakeContext,
  flushAudio,
  installFakeAudio,
  okAudioResponse,
} from '../test/fakeAudio'

let ctx: FakeContext
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  const fake = installFakeAudio()
  ctx = fake.ctx
  fetchMock = fake.fetchMock
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const flush = flushAudio
const okResponse = okAudioResponse

describe('ReplayAudioPlayer — trigger', () => {
  it('plays a loaded sound: a source started at the current instant', async () => {
    const p = new ReplayAudioPlayer(1)
    p.preload(['/static/sounds/halo_infinite/hinf_br75.ogg'])
    await flush()
    p.play('/static/sounds/halo_infinite/hinf_br75.ogg')
    expect(ctx.sources).toHaveLength(1)
    expect(ctx.sources[0].started).toBe(ctx.currentTime)
  })

  it('loads the SAME URL only ONCE, even preceded by several requests', async () => {
    const p = new ReplayAudioPlayer(1)
    p.preload(['/a.ogg', '/a.ogg'])
    p.preload(['/a.ogg'])
    await flush()
    p.preload(['/a.ogg'])
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('several SIMULTANEOUS sounds go out together (an exchange, not a queue)', async () => {
    const p = new ReplayAudioPlayer(1)
    p.preload(['/a.ogg', '/b.ogg', '/c.ogg'])
    await flush()
    p.play('/a.ogg')
    p.play('/b.ogg')
    p.play('/c.ogg')
    expect(ctx.sources).toHaveLength(3)
    expect(ctx.sources.every((s) => s.started === ctx.currentTime)).toBe(true)
  })
})

describe('ReplayAudioPlayer — cut', () => {
  it('plays a sound to the end of its file: fade on the end, not at the second', async () => {
    const p = new ReplayAudioPlayer(1)
    p.preload(['/explosion.ogg']) // 3 s of source (a delivered grenade explosion)
    await flush()
    p.play('/explosion.ogg')
    const t0 = ctx.currentTime
    // The voice gain is the last created (the master is born with the player).
    const voice = ctx.gains[ctx.gains.length - 1]
    expect(voice.gain.calls).toEqual([
      ['set', 1, t0],
      ['set', 1, t0 + 3 - SOUND_FADE_S],
      ['ramp', 0, t0 + 3],
    ])
    expect(ctx.sources[0].stopped).toBe(t0 + 3)
  })

  it('a sound longer than the safety ceiling is cut there (asset delivered too long)', async () => {
    const p = new ReplayAudioPlayer(1)
    fetchMock.mockResolvedValueOnce(okResponse(30))
    p.preload(['/entier.ogg'])
    await flush()
    p.play('/entier.ogg')
    const t0 = ctx.currentTime
    const voice = ctx.gains[ctx.gains.length - 1]
    expect(voice.gain.calls).toEqual([
      ['set', 1, t0],
      ['set', 1, t0 + SOUND_CUT_MAX_S - SOUND_FADE_S],
      ['ramp', 0, t0 + SOUND_CUT_MAX_S],
    ])
    expect(ctx.sources[0].stopped).toBe(t0 + SOUND_CUT_MAX_S)
  })

  it('a very short sound plays whole, fade bounded to its half', async () => {
    const p = new ReplayAudioPlayer(1)
    fetchMock.mockResolvedValueOnce(okResponse(0.4))
    p.preload(['/court.ogg'])
    await flush()
    p.play('/court.ogg')
    expect(ctx.sources[0].stopped).toBeCloseTo(ctx.currentTime + 0.4, 6)
    expect(soundEnvelope(0.4).fadeStartS).toBeCloseTo(0.2, 6)
  })
})

describe('ReplayAudioPlayer — clean silence', () => {
  it('absent file (404): NO source, and no re-attempt at each passage', async () => {
    const p = new ReplayAudioPlayer(1)
    fetchMock.mockResolvedValue({ ok: false, status: 404 })
    p.preload(['/absent.ogg'])
    await flush()
    p.play('/absent.ogg')
    p.play('/absent.ogg')
    expect(ctx.sources).toHaveLength(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('URL never requested: silence at that instant, loading for the following', async () => {
    const p = new ReplayAudioPlayer(1)
    p.play('/tard.ogg')
    expect(ctx.sources).toHaveLength(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await flush()
    p.play('/tard.ogg')
    expect(ctx.sources).toHaveLength(1)
  })

  it('undecodable file: memorized silence, never an exception that breaks the reading', async () => {
    const p = new ReplayAudioPlayer(1)
    vi.spyOn(ctx, 'decodeAudioData').mockRejectedValue(new Error('bouillie'))
    p.preload(['/casse.ogg'])
    await flush()
    expect(() => p.play('/casse.ogg')).not.toThrow()
    expect(ctx.sources).toHaveLength(0)
  })
})

describe('ReplayAudioPlayer — voices and volume', () => {
  it('caps the simultaneous voices, and frees one when a sound ends', async () => {
    const p = new ReplayAudioPlayer(1)
    p.preload(['/a.ogg'])
    await flush()
    for (let i = 0; i < SOUND_MAX_VOICES + 3; i++) p.play('/a.ogg')
    expect(ctx.sources).toHaveLength(SOUND_MAX_VOICES)
    ctx.sources[0].end()
    p.play('/a.ogg')
    expect(ctx.sources).toHaveLength(SOUND_MAX_VOICES + 1)
  })

  it('the CONCLUSION goes out of ceiling, with the normal envelope, without occupying a voice', async () => {
    const p = new ReplayAudioPlayer(1)
    p.preload(['/a.ogg', '/voix.ogg', '/fanfare.ogg'])
    await flush()
    for (let i = 0; i < SOUND_MAX_VOICES; i++) p.play('/a.ogg')
    p.playConclusion('/voix.ogg')
    p.playConclusion('/fanfare.ogg')
    expect(ctx.sources).toHaveLength(SOUND_MAX_VOICES + 2)
    // Normal envelope: to the end of the file (3 s here), fade included.
    expect(ctx.sources[SOUND_MAX_VOICES].stopped).toBeCloseTo(ctx.currentTime + 3)
    // An ordinary sound stays refused: the ceiling has not moved.
    p.play('/a.ogg')
    expect(ctx.sources).toHaveLength(SOUND_MAX_VOICES + 2)
    // The end of the conclusions does not return any voice they had not taken.
    ctx.sources[SOUND_MAX_VOICES].end()
    ctx.sources[SOUND_MAX_VOICES + 1].end()
    p.play('/a.ogg')
    expect(ctx.sources).toHaveLength(SOUND_MAX_VOICES + 2)
  })

  it('stopAll (the PAUSE) turns off EVERYTHING in flight, the conclusion excepted', async () => {
    const p = new ReplayAudioPlayer(1)
    p.preload(['/a.ogg', '/voix.ogg'])
    await flush()
    p.play('/a.ogg')
    p.play('/a.ogg')
    p.playConclusion('/voix.ogg')
    p.stopAll()
    const rampEnd = ctx.currentTime + VOLUME_RAMP_S
    // The two ordinary sounds are stopped by the short ramp, not at the end of their file.
    expect(ctx.sources[0].stopped).toBeCloseTo(rampEnd)
    expect(ctx.sources[1].stopped).toBeCloseTo(rampEnd)
    // The conclusion, gone out at the end bound, keeps its normal envelope (3 s here).
    expect(ctx.sources[2].stopped).toBeCloseTo(ctx.currentTime + 3)
  })

  it('the ANNOUNCER voice (round ended) is out of ceiling AND cut by the pause: two distinct rules', async () => {
    const p = new ReplayAudioPlayer(1)
    p.preload(['/a.ogg', '/manche.ogg', '/voix.ogg'])
    await flush()
    for (let i = 0; i < SOUND_MAX_VOICES; i++) p.play('/a.ogg')
    p.playAnnouncer('/manche.ogg') // ceiling reached: the announcement goes out anyway
    p.playConclusion('/voix.ogg')
    expect(ctx.sources).toHaveLength(SOUND_MAX_VOICES + 2)
    p.stopAll()
    const rampEnd = ctx.currentTime + VOLUME_RAMP_S
    expect(ctx.sources[SOUND_MAX_VOICES].stopped).toBeCloseTo(rampEnd) // the announcement stops at the pause
    expect(ctx.sources[SOUND_MAX_VOICES + 1].stopped).toBeCloseTo(ctx.currentTime + 3) // the conclusion survives
  })

  it('stopAll returns their voices to the sounds turned off (a finished sound is not cut twice)', async () => {
    const p = new ReplayAudioPlayer(1)
    p.preload(['/a.ogg'])
    await flush()
    p.play('/a.ogg')
    ctx.sources[0].end()
    p.stopAll()
    expect(ctx.sources[0].stopped).toBeCloseTo(ctx.currentTime + 3)
  })

  it('the initial volume is set at the construction (no first sound at full blast)', () => {
    new ReplayAudioPlayer(0.4)
    expect(ctx.gains[0].gain.value).toBe(0.4)
  })

  it('setVolume ramps (no click) and bounds within 0..1', () => {
    const p = new ReplayAudioPlayer(1)
    const master = ctx.gains[0]
    p.setVolume(0.5)
    p.setVolume(4)
    p.setVolume(-1)
    const t0 = ctx.currentTime
    expect(master.gain.calls.filter((c) => c[0] === 'ramp')).toEqual([
      ['ramp', 0.5, t0 + VOLUME_RAMP_S],
      ['ramp', 1, t0 + VOLUME_RAMP_S],
      ['ramp', 0, t0 + VOLUME_RAMP_S],
    ])
  })

  it('dispose closes the context (nothing runs after the unmount)', () => {
    const p = new ReplayAudioPlayer(1)
    p.dispose()
    expect(ctx.closed).toBe(1)
  })
})

/**
 * SCHEDULED AHEAD ON THE AUDIO CLOCK (fix of 2026-11-16, "sounds come out late, jammed up"). A
 * sound started at the beat that read it came out as late as the frame was long, and every sound
 * of a long frame came out on one instant. What breaks silently: a `when` ignored (the sound starts
 * now, late again), a past `when` honored (a start in the past), a jump that leaves the sounds
 * scheduled ahead to play on the new moment.
 */
describe('ReplayAudioPlayer — scheduling ahead', () => {
  it('play(…, when) starts the source AT `when`, envelope included', async () => {
    const p = new ReplayAudioPlayer(1)
    p.preload(['/a.ogg'])
    await flush()
    p.play('/a.ogg', undefined, undefined, undefined, { when: ctx.currentTime + 0.08 })
    const at = ctx.currentTime + 0.08
    expect(ctx.sources[0].started).toBeCloseTo(at, 9)
    expect(ctx.sources[0].stopped).toBeCloseTo(at + 3, 9)
    const voice = ctx.gains[ctx.gains.length - 1]
    expect(voice.gain.calls[0]).toEqual(['set', 1, at])
  })

  it('a `when` already past starts now, never in the past', async () => {
    const p = new ReplayAudioPlayer(1)
    p.preload(['/a.ogg'])
    await flush()
    p.play('/a.ogg', undefined, undefined, undefined, { when: ctx.currentTime - 0.5 })
    expect(ctx.sources[0].started).toBe(ctx.currentTime)
  })

  it('timeAt maps a page moment onto the audio clock, a past one onto now', () => {
    const p = new ReplayAudioPlayer(1)
    expect(p.timeAt(1_080, 1_000)).toBeCloseTo(ctx.currentTime + 0.08, 9)
    expect(p.timeAt(900, 1_000)).toBe(ctx.currentTime)
  })

  it('cancelPending drops what has not started, and leaves what sounds', async () => {
    const p = new ReplayAudioPlayer(1)
    p.preload(['/a.ogg'])
    await flush()
    p.play('/a.ogg') // sounding
    p.play('/a.ogg', undefined, undefined, undefined, { when: ctx.currentTime + 0.05 }) // scheduled ahead
    p.cancelPending()
    expect(ctx.sources[0].stopped).toBeCloseTo(ctx.currentTime + 3, 9)
    // Stopped before its start: it never sounds.
    expect(ctx.sources[1].stopped!).toBeLessThanOrEqual(ctx.sources[1].started!)
  })

  it('the pause (stopAll) drops the sounds scheduled ahead too', async () => {
    const p = new ReplayAudioPlayer(1)
    p.preload(['/a.ogg'])
    await flush()
    p.play('/a.ogg', undefined, undefined, undefined, { when: ctx.currentTime + 0.05 })
    p.stopAll()
    expect(ctx.sources[0].stopped!).toBeLessThanOrEqual(ctx.sources[0].started!)
  })
})

/**
 * THE CEILING ON THE AUDIO CLOCK, AND WHO KEEPS A SLOT. A slot used to be returned when the
 * browser delivered `onended`, which a busy main thread delays; and a full ceiling refused
 * whatever came last, so the far footsteps of seven Spartans held the slots against the followed
 * player's own shots (measured on d01ba030: 20-29% of his sounds refused).
 */
describe('ReplayAudioPlayer — the ceiling keeps the loudest', () => {
  const far = { gain: 0.1, pan: 0 }

  it('a slot frees at its sound\'s END on the audio clock, without waiting for `onended`', async () => {
    const p = new ReplayAudioPlayer(1)
    p.preload(['/a.ogg'])
    await flush()
    for (let i = 0; i < SOUND_MAX_VOICES; i++) p.play('/a.ogg')
    ctx.currentTime += 3 // the eight have ended; no `onended` delivered yet
    p.play('/a.ogg')
    expect(ctx.sources).toHaveLength(SOUND_MAX_VOICES + 1)
  })

  it('full of far sounds, a louder one takes the quietest slot, which fades out without a click', async () => {
    const p = new ReplayAudioPlayer(1)
    p.preload(['/a.ogg'])
    await flush()
    for (let i = 0; i < SOUND_MAX_VOICES - 1; i++) p.play('/a.ogg', undefined, undefined, { gain: 0.3, pan: 0 })
    p.play('/a.ogg', undefined, undefined, far) // the quietest, the last one in
    const victim = ctx.sources[SOUND_MAX_VOICES - 1]
    const victimGain = ctx.gains[ctx.gains.length - 1]
    p.play('/a.ogg') // the followed player's own sound: full level
    expect(ctx.sources).toHaveLength(SOUND_MAX_VOICES + 1)
    const t0 = ctx.currentTime
    expect(victim.stopped).toBeCloseTo(t0 + SOUND_STEAL_FADE_S, 9)
    expect(victimGain.gain.calls.slice(-2)).toEqual([['set', 0.1, t0], ['ramp', 0, t0 + SOUND_STEAL_FADE_S]])
    // The others keep their whole file.
    expect(ctx.sources[0].stopped).toBeCloseTo(t0 + 3, 9)
  })

  it('a sound no louder than every voice in flight is refused, as before', async () => {
    const p = new ReplayAudioPlayer(1)
    p.preload(['/a.ogg'])
    await flush()
    for (let i = 0; i < SOUND_MAX_VOICES; i++) p.play('/a.ogg', undefined, undefined, far)
    p.play('/a.ogg', undefined, undefined, far) // same level: no slot taken
    expect(ctx.sources).toHaveLength(SOUND_MAX_VOICES)
    expect(ctx.sources.every((s) => s.stopped === ctx.currentTime + 3)).toBe(true)
  })
})

describe('admitVoice — the single rule of the ceiling', () => {
  const slot = (level: number, endS = 10, fadeStartS = 9) => ({ level, endS, fadeStartS })

  it('under the ceiling: admitted, nothing taken', () => {
    expect(admitVoice([slot(1)], 0, 0.01)).toEqual({ admit: true })
  })

  it('ended slots do not count', () => {
    const full = Array.from({ length: SOUND_MAX_VOICES }, () => slot(1, 2))
    expect(admitVoice(full, 2, 0.01)).toEqual({ admit: true })
  })

  it('full: takes the QUIETEST, only if strictly quieter than the newcomer', () => {
    const full = [...Array.from({ length: SOUND_MAX_VOICES - 2 }, () => slot(0.5)), slot(0.2), slot(0.05)]
    expect(admitVoice(full, 0, 0.3)).toEqual({ admit: true, steal: full[SOUND_MAX_VOICES - 1] })
    expect(admitVoice(full, 0, 0.05)).toEqual({ admit: false })
  })

  it('a FOOTSTEP takes only a footstep\'s slot, never a shot\'s, even a quieter one', () => {
    const shots = Array.from({ length: SOUND_MAX_VOICES - 1 }, () => slot(0.1))
    const withFoot = [...shots, { ...slot(0.2), footstep: true }]
    // Louder than every shot, but a step: it may only take the step's slot, and only if louder.
    expect(admitVoice([...shots, slot(0.1)], 0, 0.7, true)).toEqual({ admit: false })
    expect(admitVoice(withFoot, 0, 0.7, true)).toEqual({ admit: true, steal: withFoot[SOUND_MAX_VOICES - 1] })
    // A shot takes any quieter slot, a step's included.
    expect(admitVoice(withFoot, 0, 0.5)).toEqual({ admit: true, steal: shots[0] })
  })

  it('a voice already in its fade is never taken: it frees its slot on its own', () => {
    const full = [...Array.from({ length: SOUND_MAX_VOICES - 1 }, () => slot(0.5)), slot(0.01, 10, 1)]
    expect(admitVoice(full, 2, 0.3)).toEqual({ admit: false })
  })

  it('voiceLevelOf: event gain x distance, the level the voice plays at', () => {
    expect(voiceLevelOf()).toBe(1)
    expect(voiceLevelOf({ gainDb: -6 }, { gain: 0.5 })).toBeCloseTo(0.5 * 10 ** (-6 / 20), 9)
  })

  it('a taken slot cuts the envelope where it is taken (the export writes it into the shape)', () => {
    expect(soundEnvelopeOf(3, { stealS: 1 })).toEqual({ fadeStartS: 1, stopS: 1 + SOUND_STEAL_FADE_S, loop: false })
    // Taken during its own fade: nothing changes.
    expect(soundEnvelopeOf(3, { stealS: 2.9 })).toEqual(soundEnvelopeOf(3))
    expect(soundEnvelopeOf(1, { holdS: 5, stealS: 2 }).loop).toBe(true)
  })
})

/**
 * THE STEREO PAN — a spatialized sound sounds lower according to its distance and to one side.
 * What breaks silently: a centered sound that would still open a panner (one more node, a
 * cost for nothing), or a sound to one side that would pass without it (no error raised, the
 * sound would sound at the center).
 */
describe('ReplayAudioPlayer — the stereo pan', () => {
  it('without a place: NO panner, and the gain is unchanged', async () => {
    const p = new ReplayAudioPlayer(1)
    p.preload(['/a.ogg'])
    await flush()
    p.play('/a.ogg')
    expect(ctx.panners).toHaveLength(0)
    const voice = ctx.gains[ctx.gains.length - 1]
    expect(voice.gain.calls[0]).toEqual(['set', 1, ctx.currentTime])
  })

  it('a place to one side: a panner on the right side, and the gain multiplied', async () => {
    const p = new ReplayAudioPlayer(1)
    p.preload(['/a.ogg'])
    await flush()
    p.play('/a.ogg', undefined, undefined, { gain: 0.5, pan: 0.6 })
    expect(ctx.panners).toHaveLength(1)
    expect(ctx.panners[0].pan.value).toBe(0.6)
    const voice = ctx.gains[ctx.gains.length - 1]
    expect(voice.gain.calls[0]).toEqual(['set', 0.5, ctx.currentTime])
  })

  it('a CENTERED place (pan 0): no panner, but the gain is multiplied', async () => {
    const p = new ReplayAudioPlayer(1)
    p.preload(['/a.ogg'])
    await flush()
    p.play('/a.ogg', undefined, undefined, { gain: 0.5, pan: 0 })
    expect(ctx.panners).toHaveLength(0)
    const voice = ctx.gains[ctx.gains.length - 1]
    expect(voice.gain.calls[0]).toEqual(['set', 0.5, ctx.currentTime])
  })
})

/**
 * THE RECORDING TAP — the parallel output that feeds the captured video.
 *
 * WHAT BREAKS SILENTLY HERE, and that is the reason for these three cases: a mute clip
 * raises no error. If the tap is plugged somewhere other than the real output — on the
 * master while the distance chain is in place — the sound continues out of the speakers and
 * the file, for its part, contains nothing. Nothing in the interface would say it.
 */
describe('ReplayAudioPlayer — the recording track', () => {
  it('plugs the MASTER on the tap, IN ADDITION to the speakers', () => {
    const p = new ReplayAudioPlayer(1)
    const master = ctx.gains[0]
    expect(ctx.streamDests).toHaveLength(0) // nothing until we film
    const track = p.recordingTrack()
    expect(ctx.streamDests).toHaveLength(1)
    expect(track).toBe(ctx.streamDests[0].track)
    // The TWO outputs, not one in place of the other: filming does not cut the listening.
    expect(master.connections).toContain(ctx.destination)
    expect(master.connections).toContain(ctx.streamDests[0])
  })

  it('opens only ONE tap, even requested several times', () => {
    // A following clip reuses the same track; recreating one per recording would leave
    // nodes behind it, and the graph would grow at each button press.
    const p = new ReplayAudioPlayer(1)
    const a = p.recordingTrack()
    const b = p.recordingTrack()
    expect(ctx.streamDests).toHaveLength(1)
    expect(a).toBe(b)
  })

  it('follows the DISTANCE CHAIN: it is the last node that feeds the tap', () => {
    const p = new ReplayAudioPlayer(1)
    p.recordingTrack()
    p.setDistance({ gainDb: -6, cutoffHz: 4_000 })
    const filtre = ctx.filters[0]
    expect(filtre.connections).toContain(ctx.destination)
    expect(filtre.connections).toContain(ctx.streamDests[0])
    // And the master no longer doubles the output: it passes through the chain.
    expect(ctx.gains[0].connections).not.toContain(ctx.streamDests[0])
  })

  it('a browser without an audio stream returns `null` rather than raising', () => {
    ;(ctx as unknown as Record<string, unknown>).createMediaStreamDestination = undefined
    const p = new ReplayAudioPlayer(1)
    expect(p.recordingTrack()).toBeNull()
  })
})
