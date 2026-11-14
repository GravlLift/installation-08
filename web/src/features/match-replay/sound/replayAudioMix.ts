/**
 * replayAudioMix.ts — THE SOUND TRACK OF THE EXPORT, mixed OFF REAL TIME.
 *
 * # THE SAME TRACK, PLAYED DIFFERENTLY
 *
 * The page's sound replay is a PLAYER: a cursor advances with playback and triggers
 * the sounds in passing (`replaySoundCursor.ts`), one by one, at real time. The export has no
 * playback to follow — it knows the whole track in advance and can therefore PLACE it at once:
 * each event at its absolute moment in an `OfflineAudioContext`, which renders the complete mixing
 * much faster than its duration.
 *
 * THE TRACK IS NOT RECONSTRUCTED HERE. It comes from `buildSoundTimeline()`, the very one that
 * the page plays — the exported mixing therefore cannot contain a sound the replay would not have
 * made heard, nor miss one.
 *
 * # WHAT IS TAKEN IDENTICALLY FROM THE PLAYER, AND WHY
 *
 * - THE ENVELOPE (`soundEnvelope`): full hold then fade out. A hard `stop()` in the
 *   middle of a wave clicks; that is true offline as in live.
 * - THE VOICE CEILING (`SOUND_MAX_VOICES`): on a sustained exchange, stacking twenty sources does
 *   not tell anything more than a wall of noise. Without this ceiling, the export would sound DIFFERENTLY
 *   than the page — louder and more confused — while it must be its faithful trace.
 * - THE VARIANT DRAW AND THE WEAPON VARIATION: same functions, `pickVariantStem` and
 *   `drawVariation`, which both accept an injectable generator.
 *
 * # ONLY ONE THING CHANGES: RANDOMNESS BECOMES REPRODUCIBLE
 *
 * In live, drawing a variant at random is what prevents a repeated gesture from sounding like
 * a loop. On a FILE, the same randomness would make two exports of the same match subtly
 * different — impossible to compare, impossible to re-deliver identically. The seed is therefore
 * derived from the EVENT itself (its rank and its stem): two exports of the same match sound
 * the same, and two occurrences of the same gesture still sound differently.
 */
import { distanceChain, drawVariation, gainFromDb, withEventGain, type SoundDraw } from './weaponSoundLogic'
import {
  SOUND_MAX_VOICES,
  soundEnvelopeOf,
  soundOccupiesVoice,
  soundShapeOf,
  type SoundShape,
} from './replayAudio'
import { WEAPON_SOUND_VARIATIONS } from './weaponSoundVariations'
import { pickVariantStem, type ReplaySoundEvent } from './replaySoundVariants'
import { placeOf, type SoundListener, type SoundPlacement } from './soundSpatial'
import {
  engineStemsOf,
  engineTailSeconds,
  planEngineSegments,
  scheduleEngineMix,
  type EngineSegment,
} from './vehicleEngineMix'
import type { EnginePlan } from './vehicleEngineSound'
import { staticAssetURL } from '@/lib/staticAssets'

/** Sampling frequency of the mixing. 48 kHz: the native rate of the delivered assets. */
export const MIX_SAMPLE_RATE = 48_000
/** Two channels: the sources are mono, the container and the players expect stereo. */
export const MIX_CHANNELS = 2

/**
 * The extension of the delivered sounds: Opus in Ogg container (encoded by `cmd/sounds-encode`). The sound
 * URLs are only composed here; the guardrail `replaySoundAssets.guard.test.ts` replays this path
 * against the assets folder.
 */
const SOUND_FILE_EXT = '.ogg'

/**
 * soundUrlOf — THE URL OF A SOUND STEM, and THE ONLY PLACE that makes it.
 *
 * The literal `staticAssetURL('sound', stem, <extension>)` was at its THIRD copy (two in
 * `soundURLsFor`, one here): CLAUDE.md rule n° 6 then imposes centralization. The two
 * copies of the player now consume this function.
 */
export function soundUrlOf(stem: string): string {
  return staticAssetURL('sound', stem, SOUND_FILE_EXT)
}

/**
 * THE THREE SOUND FAMILIES OF A REPLAY, as a montage wants to separate them.
 *
 * They do NOT cover the categories of the player (`weapon`, `grenade`, `melee`, `equipment`,
 * `objective`): those five are ALL sound effects. The voice and the music only exist at the
 * conclusions — the end of round and end of match announcer, and the final fanfare. A track
 * "music" of a replay therefore contains ten seconds at the end, and silence before.
 */
export type SoundFamily = 'sfx' | 'voice' | 'music'

/** A sound kept by the mixing: what to play, when, and with what variation. */
export interface MixedSound {
  /** Moment on the CLIP axis (0 = first exported frame), in milliseconds. */
  atMs: number
  /** The file actually played — variant already drawn. */
  stem: string
  draw: SoundDraw
  /**
   * `true` = THE CONCLUSION (announcer's voice, fanfare). It ESCAPES the voice ceiling, here
   * as in the page player — rule and reason in one place: `soundOccupiesVoice`
   * (`replayAudio.ts`).
   */
  conclusion?: boolean
  /** `true` = a TRACK ANNOUNCER'S VOICE ("round ended"): out of ceiling, same rule. */
  announcer?: boolean
  /** The family this sound belongs to, for the separate tracks of the clip. */
  family: SoundFamily
  /** The SHAPE of a burst sound (held or cut), the same as in live (`soundEnvelopeOf`). */
  shape?: SoundShape
  /**
   * THE PLACE of the sound for the clip's listener (gain according to distance, pan according to the bearing),
   * placed by `planAudioMix` when the mix receives a listener. Absent = the sound plays as
   * is, exactly as without a listener.
   */
  place?: SoundPlacement
}

/** The exported range, on the replay's axis. */
export interface MixBounds {
  startMs: number
  endMs: number
}

export interface MixOptions {
  /** Instance setting of the weapon variation (admin page), in percent. */
  variationPercent: number
  /**
   * INSTANCE SETTING OF DISTANCE (admin page), in percent. It places an attenuation and a
   * low-pass on the master, exactly as `ReplayAudioPlayer.setDistance` does for the
   * speakers. Without it, an export would sound louder and brighter than the page —
   * the opposite of what "the faithful trace" means.
   */
  distancePercent?: number
  /**
   * The takes of END OF MATCH (announcer's voice + fanfare). They have no moment on the
   * track — they are placed on the end bound, and only if it is in the range.
   */
  endMatchStems?: readonly string[]
  /**
   * WHICH STEMS BELONG TO WHICH FAMILY. Anything not there is a SOUND EFFECT:
   * that is by far the most common case, and the safest default — a misclassified sound
   * ends up in the sound effects, never absent from the complete mixing.
   */
  families?: { voice: readonly string[]; music: readonly string[] }
  /**
   * THE ENGINE PLAN OF THE VEHICLES (`vehicleEngineSound.planVehicleEngines`, passed by the
   * page): continuous STATES, placed in segments by `vehicleEngineMix.ts` — same episode
   * bounds, same 150 ms fades and same 0.85 bus as the real-time playback. They are
   * SOUND EFFECTS (family `sfx`) and do not count in the voice ceiling, as in live.
   */
  engines?: readonly EnginePlan[]
  /**
   * THE LISTENER of the clip, a function of the moment in milliseconds: who listens to the mix (the
   * position and the bearing of the followed player in a 3D export, cf. `soundListenerOf`). Each
   * event that carries a place (`at`) is placed for it, SAME rule as the real-time
   * player (`placeOf`: gain according to distance, pan according to the bearing). Without a listener, the mix
   * stays as before — a 2D export does not spatialize, like the page in 2D.
   */
  listenerAt?: (ms: number) => SoundListener | null
}

/**
 * mixSeed — a stable seed derived from the rank and the stem of the event.
 *
 * DERIVED FROM THE EVENT, and not from a global counter: a counter would make the draw of
 * an event depend on ALL those that precede it, therefore change the whole mixing as soon as we bound
 * the range differently. Here, exporting a round alone makes its shots sound exactly like
 * in the export of the whole match.
 */
export function mixSeed(index: number, stem: string): number {
  // FNV-1a 32 bits: short, no dependency, and well dispersed enough to choose a variant.
  let h = 0x811c9dc5 ^ index
  for (let i = 0; i < stem.length; i++) {
    h ^= stem.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * seededRandom — a reproducible uniform generator (mulberry32).
 *
 * `Math.random` is not seedable: that is the only reason this generator exists. It
 * has no cryptographic claim, and does not need any — it chooses among three takes
 * of the same shot.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (a >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * planAudioMix keeps the events of the range and DRAWS their variant, reproducibly.
 *
 * THE RANK USED FOR THE SEED IS THE ONE IN THE WHOLE TRACK, not in the range: that is what
 * makes the draw independent of the bounding (cf. `mixSeed`).
 */
export function planAudioMix(
  timeline: readonly ReplaySoundEvent[],
  bounds: MixBounds,
  options: MixOptions,
): MixedSound[] {
  const out: MixedSound[] = []
  for (let i = 0; i < timeline.length; i++) {
    const e = timeline[i]
    if (e.ms < bounds.startMs || e.ms > bounds.endMs) continue
    const rnd = seededRandom(mixSeed(i, e.stem))
    const stem = pickVariantStem(e, rnd)
    // The RANGED variation only concerns the WEAPONS: the table is indexed by weapon stem, and
    // `drawVariation` returns the exact neutral for any other stem.
    const draw = withEventGain(drawVariation(WEAPON_SOUND_VARIATIONS[stem], options.variationPercent, rnd), e)
    const shape = soundShapeOf(e)
    // THE PLACE FOR THE CLIP'S LISTENER, at its moment, SAME rule as the real-time player
    // (`placeOf`): without a listener or without a place, no placement — the sound stays as is.
    const place = options.listenerAt ? placeOf(options.listenerAt(e.ms), e) : undefined
    out.push({
      atMs: e.ms - bounds.startMs,
      stem,
      draw,
      family: familyOf(stem, options.families),
      ...(shape ? { shape } : {}),
      ...(e.announcer ? { announcer: true } : {}),
      ...(place ? { place } : {}),
    })
  }
  // THE CONCLUSION IS PLACED ON THE END BOUND, and the caller provides it ONLY if the range
  // really reaches the end of the match (cf. `mixExportAudio`): a mid-match excerpt does
  // not end on a victory fanfare. This module cannot judge on its own — it
  // only knows milliseconds, not the end bound of the match.
  for (const stem of options.endMatchStems ?? []) {
    // NO VARIATION HERE, like in the player: the ranges are those of the weapons, a
    // announcer's line and a fanfare play as they are.
    out.push({
      atMs: bounds.endMs - bounds.startMs,
      stem,
      draw: { gainDb: 0, playbackRate: 1 },
      conclusion: true,
      family: familyOf(stem, options.families),
    })
  }
  return out.sort((a, b) => a.atMs - b.atMs)
}

/** familyOf classifies a stem. Out of the two known lists, it is a sound effect (cf. `MixOptions`). */
function familyOf(stem: string, familles: MixOptions['families']): SoundFamily {
  if (!familles) return 'sfx'
  if (familles.music.includes(stem)) return 'music'
  if (familles.voice.includes(stem)) return 'voice'
  return 'sfx'
}

/**
 * applyVoiceCap replays THE SAME voice accounting as the real-time player.
 *
 * The player counts the living sources and refuses those that exceed `SOUND_MAX_VOICES`.
 * Offline, the same rule is computed in advance: a source occupies a voice from its moment
 * until the end of its envelope. Without that, the export would stack everything and sound louder
 * and more confused than the page — measured on the local corpus: 28.7% of sources are refused
 * in live on a sustained exchange.
 *
 * THE CONCLUSION follows the same exception on both sides: out of ceiling, without voice occupied
 * (`soundOccupiesVoice`). Until 2026-09-26, only the export applied it — the page refused
 * the fanfare of a dense end, and "the same accounting" was false on that point (item 11).
 * Parity guardrail: `replayAudioMix.test.ts`.
 *
 * `durationOf` returns the duration of the file in seconds, or `null` if absent — a missing
 * asset is a silence, exactly as in live, and it then occupies no voice.
 */
export function applyVoiceCap(
  sounds: readonly MixedSound[],
  durationOf: (stem: string) => number | null,
): MixedSound[] {
  const kept: MixedSound[] = []
  /** Release moments of the occupied voices, in ms on the clip axis. */
  let busy: number[] = []
  for (const s of sounds) {
    const seconds = durationOf(s.stem)
    if (seconds === null) continue
    // AN ANNOUNCEMENT ALWAYS PASSES (conclusion, round voice) and occupies no voice
    // (`soundOccupiesVoice`): it disputes nothing with the sound effects, it tells the course.
    if (!soundOccupiesVoice(s)) {
      kept.push(s)
      continue
    }
    busy = busy.filter((endsAt) => endsAt > s.atMs)
    if (busy.length >= SOUND_MAX_VOICES) continue
    const { stopS } = soundEnvelopeOf(seconds, s.shape)
    busy.push(s.atMs + stopS * 1000)
    kept.push(s)
  }
  return kept
}

/** What the offline render consumes: the buffers already decoded, by stem. */
export type MixBuffers = ReadonlyMap<string, AudioBuffer | null>

/**
 * decodeMixSources loads and decodes the files the mixing needs.
 *
 * AN ABSENT ASSET IS MEMORIZED AS SUCH (`null`), never re-attempted and never raised as an error:
 * that is the policy of the player (`replayAudio.ts`), and an export must not fail in whole
 * because a file is missing. The silence is clean, and it is said once in the console.
 */
export async function decodeMixSources(
  stems: Iterable<string>,
  urlOf: (stem: string) => string | undefined,
  ctx: BaseAudioContext,
): Promise<Map<string, AudioBuffer | null>> {
  const out = new Map<string, AudioBuffer | null>()
  for (const stem of stems) {
    if (out.has(stem)) continue
    const url = urlOf(stem)
    if (!url) {
      out.set(stem, null)
      continue
    }
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      out.set(stem, await ctx.decodeAudioData(await res.arrayBuffer()))
    } catch (err) {
      console.warn('replay 3D: sound unavailable, silence:', url, err)
      out.set(stem, null)
    }
  }
  return out
}

/**
 * scheduleMix places all the sources in an offline context, each with its envelope.
 *
 * That is the EXACT transposition of `ReplayAudioPlayer.play()`: hold gain, plateau, linear
 * fade to zero, and `playbackRate` when the variation demands one. The only
 * difference is the moment — absolute here, "now" there.
 *
 * THE PLACE follows the same rule as the player: the hold gain is MULTIPLIED by the gain of the
 * placement (a spatialized sound is lower according to its distance), and the stereo panner is born
 * only if the placement demands one at a side — without `place`, or `pan` at 0, the wiring stays
 * `source -> gain -> destination`, no node more.
 */
export function scheduleMix(
  ctx: BaseAudioContext,
  destination: AudioNode,
  sounds: readonly MixedSound[],
  buffers: MixBuffers,
): void {
  for (const s of sounds) {
    const buf = buffers.get(s.stem)
    if (!buf) continue
    const t0 = s.atMs / 1000
    const { fadeStartS, stopS, loop } = soundEnvelopeOf(buf.duration, s.shape)
    const tenue = gainFromDb(s.draw.gainDb) * (s.place?.gain ?? 1)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(tenue, t0)
    gain.gain.setValueAtTime(tenue, t0 + fadeStartS)
    gain.gain.linearRampToValueAtTime(0, t0 + stopS)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = loop
    if (s.draw.playbackRate !== 1) src.playbackRate.value = s.draw.playbackRate
    src.connect(gain)
    // The PAN is born only if demanded and at a SIDE: same rule as the player.
    if (s.place && s.place.pan !== 0) {
      const panner = ctx.createStereoPanner()
      panner.pan.value = s.place.pan
      gain.connect(panner)
      panner.connect(destination)
    } else {
      gain.connect(destination)
    }
    src.start(t0)
    src.stop(t0 + stopS)
  }
}

/**
 * renderAudioMix renders the complete track in a buffer.
 *
 * THE DURATION IS THAT OF THE CLIP, plus the TAIL of the last sound: a hard cut at the bound would slice
 * an end-of-match fanfare that lasts eleven seconds and that begins, by definition, at the
 * last frame.
 */
export async function renderAudioMix(
  sounds: readonly MixedSound[],
  buffers: MixBuffers,
  /** TOTAL duration to render, tail included — the caller computes it once and for all. */
  durationMs: number,
  masterGain: number,
  distancePercent = 0,
  /** The engine segments to place behind their bus (0.85), with the same buffers. */
  engineSegments: readonly EngineSegment[] = [],
): Promise<AudioBuffer> {
  const frames = Math.max(1, Math.ceil((durationMs / 1000) * MIX_SAMPLE_RATE))
  const ctx = new OfflineAudioContext(MIX_CHANNELS, frames, MIX_SAMPLE_RATE)
  const master = ctx.createGain()
  master.gain.value = Math.min(Math.max(masterGain, 0), 1)
  // THE DISTANCE CHAIN, SAME RECIPE AS THE PLAYER (`ReplayAudioPlayer.setDistance`):
  // master -> attenuation -> low-pass -> output. At 0%, `distanceChain` returns `null` and NO
  // node is placed — the signal path stays the original one, "pure sounds" requirement.
  const chain = distanceChain(distancePercent)
  if (chain) {
    const dist = ctx.createGain()
    dist.gain.value = gainFromDb(chain.gainDb)
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = chain.cutoffHz
    master.connect(dist)
    dist.connect(filter)
    filter.connect(ctx.destination)
  } else {
    master.connect(ctx.destination)
  }
  scheduleMix(ctx, master, sounds, buffers)
  scheduleEngineMix(ctx, master, engineSegments, buffers)
  return ctx.startRendering()
}

/**
 * tailSeconds — what OVERFLOWS the bound, and nothing else.
 *
 * The computation carries on the overflow and not on the absolute end of the last sound: adding
 * that last one to the duration of the clip would almost double the track for a whole match.
 */
export function tailSeconds(
  sounds: readonly MixedSound[],
  buffers: MixBuffers,
  durationMs: number,
): number {
  let lastEnd = 0
  for (const s of sounds) {
    const buf = buffers.get(s.stem)
    if (!buf) continue
    lastEnd = Math.max(lastEnd, s.atMs / 1000 + soundEnvelopeOf(buf.duration, s.shape).stopS)
  }
  return Math.max(0, lastEnd - durationMs / 1000)
}

/**
 * THE TRACKS OF A CLIP, IN THE ORDER THE CONTAINER WILL WRITE THEM.
 *
 * `full` COMES FIRST, and that is not a presentation detail: an ordinary player
 * only plays the first track (a browser does not even expose the others). Delivering the
 * families without the mixing would make heard the only sound effects, without music or voice — a
 * regression for everyone but the editor.
 */
export interface MixedTracks {
  full: AudioBuffer
  /** The NON-EMPTY families, in the order `sfx`, `voice`, `music`. */
  families: { family: SoundFamily; buffer: AudioBuffer }[]
}

/** The writing order of the families. Stable, so that two exports resemble each other. */
const FAMILY_ORDER: readonly SoundFamily[] = ['sfx', 'voice', 'music']

/**
 * mixReplayAudio — THE SINGLE ENTRY POINT: from the replay's track to the buffers ready to encode.
 *
 * It chains the four steps in the only possible order: keep and draw (pure), decode
 * (the durations are only known after), cap the voices (it needs them), render.
 *
 * THE FAMILIES ARE RENDERED FROM THE SAME SOUNDS KEPT as the complete mixing — never
 * replanned. That is what guarantees that by superimposing the separate tracks one gets back
 * exactly the mixing: same draw, same voice ceiling, same moments.
 *
 * `null` when there is nothing to mix — empty track, range without the slightest sound, or browser
 * without `OfflineAudioContext`. The caller then outputs a SILENT clip rather than no clip.
 */
export async function mixReplayAudio(
  timeline: readonly ReplaySoundEvent[],
  bounds: MixBounds,
  options: MixOptions & { volume: number; urlOf: (stem: string) => string | undefined; trimToBounds?: boolean },
): Promise<MixedTracks | null> {
  if (typeof OfflineAudioContext !== 'function') return null
  const planned = planAudioMix(timeline, bounds, options)
  const enginePlans = options.engines ?? []
  // "Nothing to mix" counts the ENGINES: a match without an event but with a vehicle
  // occupied in the range has well a sound track to render.
  if (planned.length === 0 && enginePlans.length === 0) return null
  const durationMs = bounds.endMs - bounds.startMs
  // A THROWAWAY CONTEXT FOR THE SOLE DECODING: `decodeAudioData` needs a context, but
  // not the one that will render the mixing — whose length depends precisely on the decoded durations.
  const probe = new OfflineAudioContext(MIX_CHANNELS, 1, MIX_SAMPLE_RATE)
  const buffers = await decodeMixSources(
    [...planned.map((s) => s.stem), ...engineStemsOf(enginePlans)],
    options.urlOf,
    probe,
  )
  const durOf = (stem: string) => buffers.get(stem)?.duration ?? null
  const kept = applyVoiceCap(planned, durOf)
  // THE ENGINE SEGMENTS: same bounds as the page, bounded to the range. Out of the voice ceiling.
  const engineSegments = enginePlans.flatMap((p) => planEngineSegments(p, bounds, durOf))
  if (kept.length === 0 && engineSegments.length === 0) return null
  // THE DURATION IS THAT OF THE COMPLETE MIXING FOR ALL TRACKS: tracks of different
  // lengths would offset in playback in a montage. The tail takes the longest of the
  // two worlds — the last enveloped event, or an engine `exit` engraved that overflows.
  const tail = Math.max(
    tailSeconds(kept, buffers, durationMs),
    engineTailSeconds(engineSegments, durOf, durationMs / 1000),
  )
  const total = durationMs + (options.trimToBounds ? 0 : tail * 1000)
  const rendre = (sons: readonly MixedSound[], engines: readonly EngineSegment[]) =>
    renderAudioMix(sons, buffers, total, options.volume, options.distancePercent ?? 0, engines)
  const full = await rendre(kept, engineSegments)
  const families: MixedTracks['families'] = []
  for (const family of FAMILY_ORDER) {
    const sons = kept.filter((s) => s.family === family)
    // The engines are SOUND EFFECTS: they come out in the `sfx` track, like in the mixing.
    const engines = family === 'sfx' ? engineSegments : []
    if (sons.length === 0 && engines.length === 0) continue
    families.push({ family, buffer: await rendre(sons, engines) })
  }
  return { full, families }
}
