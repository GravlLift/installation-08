// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayAudioMix.ts — THE SOUND TRACK OF THE EXPORT, mixed OFF REAL TIME.
 *
 * # THE SAME TRACK, PLAYED DIFFERENTLY
 *
 * The page's sound replay is a PLAYER: a cursor advances with playback and triggers
 * the sounds in passing (`replaySoundCursor.ts`), one by one, at real time. The export has no
 * playback to follow — it knows the whole track in advance and can therefore PLACE it: each event
 * at its absolute moment in an `OfflineAudioContext`, which renders the complete mixing much
 * faster than its duration. The sources enter that context just in time, a step ahead of the
 * render (`mixRender.ts`): placed all at once, the render of a long range grows with its square.
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
import { drawVariation, withEventGain, type SoundDraw } from './weaponSoundLogic'
import {
  MIX_CHANNELS,
  MIX_SAMPLE_RATE,
  renderAudioMix,
  type MixBuffers,
  type MixJob,
  type RenderHooks,
} from './mixRender'
import {
  admitVoice,
  soundEnvelopeOf,
  soundOccupiesVoice,
  soundShapeOf,
  voiceLevelOf,
  type SoundShape,
  type VoiceSlot,
} from './replayAudio'
import { WEAPON_SOUND_VARIATIONS } from './weaponSoundVariations'
import { pickVariantStem, type ReplaySoundEvent } from './replaySoundVariants'
import { INAUDIBLE_LEVEL, placeOf, type SoundListener, type SoundPlacement } from './soundSpatial'
import {
  engineStemsOf,
  engineTailSeconds,
  planEngineSegments,
  type EngineSegment,
} from './vehicleEngineMix'
import {
  planShieldSegments,
  shieldTailSeconds,
  type ShieldMixSource,
  type ShieldSegment,
} from './shieldMix'
import { SHIELD_SOUND_STEMS } from './shieldSound'
import type { EnginePlan } from './vehicleEngineSound'
import { staticAssetURL } from '@/lib/staticAssets'

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
  /** A foot or movement sound: it takes only another such sound's slot (`admitVoice`), as in live. */
  footstep?: boolean
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
   * THE SHIELD of the followed player (`followedShieldReader`, a first-person export only: the
   * bar's alarms are his own, the page plays them for whoever is followed). Its loops and
   * one-shots are placed by `shieldMix.ts` with the SAME cues, rise pick and bus as the
   * real-time playback. Like the engines, it is a SOUND EFFECT and counts in no voice ceiling.
   */
  shield?: ShieldMixSource
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
      ...(e.footstep ? { footstep: true } : {}),
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
 * The player and the export apply ONE rule, `admitVoice` (`replayAudio.ts`): a source occupies a
 * voice from its moment until the end of its envelope, and at the ceiling a louder sound takes the
 * slot of the quietest voice (whose cut is written here into its shape, `stealS`). Without that, the export would stack everything and sound louder
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
  /** The occupied voices, on the clip axis in seconds, with the index of their sound in `kept`. */
  let busy: Array<VoiceSlot & { keptAt: number }> = []
  for (const s of sounds) {
    const seconds = durationOf(s.stem)
    if (seconds === null) continue
    // AN ANNOUNCEMENT ALWAYS PASSES (conclusion, round voice) and occupies no voice
    // (`soundOccupiesVoice`): it disputes nothing with the sound effects, it tells the course.
    if (!soundOccupiesVoice(s)) {
      kept.push(s)
      continue
    }
    const atS = s.atMs / 1000
    busy = busy.filter((v) => v.endS > atS)
    const level = voiceLevelOf(s.draw, s.place)
    // Out of earshot, as in the page player: not played, no voice spent.
    if (s.place && level < INAUDIBLE_LEVEL) continue
    // THE SAME RULE AS THE PAGE (`admitVoice`): at the ceiling, a louder sound takes the slot of
    // the quietest voice, which then fades out there — the cut is written into its shape.
    const footstep = s.footstep === true
    const verdict = admitVoice(busy, atS, level, footstep)
    if (!verdict.admit) continue
    if (verdict.steal) {
      const v = verdict.steal as VoiceSlot & { keptAt: number }
      const victim = kept[v.keptAt]
      kept[v.keptAt] = { ...victim, shape: { ...victim.shape, stealS: atS - victim.atMs / 1000 } }
      busy = busy.filter((b) => b !== v)
    }
    const { fadeStartS, stopS } = soundEnvelopeOf(seconds, s.shape)
    busy.push({ endS: atS + stopS, fadeStartS: atS + fadeStartS, level, footstep, keptAt: kept.length })
    kept.push(s)
  }
  return kept
}

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
 * without `OfflineAudioContext` — and when `hooks.cancelled` stopped a render. The caller then
 * outputs a SILENT clip rather than no clip, or reads its own cancellation.
 *
 * `hooks.progress` receives the rendered share of ALL the tracks, 0..1, while they render.
 */
export async function mixReplayAudio(
  timeline: readonly ReplaySoundEvent[],
  bounds: MixBounds,
  options: MixOptions & { volume: number; urlOf: (stem: string) => string | undefined; trimToBounds?: boolean; hooks?: RenderHooks },
): Promise<MixedTracks | null> {
  if (typeof OfflineAudioContext !== 'function') return null
  const planned = planAudioMix(timeline, bounds, options)
  const enginePlans = options.engines ?? []
  // "Nothing to mix" counts the ENGINES and the SHIELD: a match without an event but with a
  // vehicle occupied in the range, or a followed Spartan with a low bar, has well a sound
  // track to render.
  if (planned.length === 0 && enginePlans.length === 0 && !options.shield) return null
  const durationMs = bounds.endMs - bounds.startMs
  // A THROWAWAY CONTEXT FOR THE SOLE DECODING: `decodeAudioData` needs a context, but
  // not the one that will render the mixing — whose length depends precisely on the decoded durations.
  const probe = new OfflineAudioContext(MIX_CHANNELS, 1, MIX_SAMPLE_RATE)
  const buffers = await decodeMixSources(
    // The shield's files too: unloaded, every shield segment reads as "file absent" and skips.
    [...planned.map((s) => s.stem), ...engineStemsOf(enginePlans), ...(options.shield ? SHIELD_SOUND_STEMS : [])],
    options.urlOf,
    probe,
  )
  const durOf = (stem: string) => buffers.get(stem)?.duration ?? null
  const kept = applyVoiceCap(planned, durOf)
  // THE ENGINE SEGMENTS: same bounds as the page, bounded to the range. Out of the voice ceiling.
  const engineSegments = enginePlans.flatMap((p) => planEngineSegments(p, bounds, durOf))
  // THE SHIELD SEGMENTS: the followed Spartan's bar, first person only, out of the voice ceiling.
  const shieldSegments = options.shield ? planShieldSegments(options.shield, bounds, durOf) : []
  if (kept.length === 0 && engineSegments.length === 0 && shieldSegments.length === 0) return null
  // THE DURATION IS THAT OF THE COMPLETE MIXING FOR ALL TRACKS: tracks of different
  // lengths would offset in playback in a montage. The tail takes the longest of the
  // worlds — the last enveloped event, an engine `exit` engraved, or a shield one-shot
  // that goes out near the bound.
  const tail = Math.max(
    tailSeconds(kept, buffers, durationMs),
    engineTailSeconds(engineSegments, durOf, durationMs / 1000),
    shieldTailSeconds(shieldSegments, durOf, durationMs / 1000),
  )
  const total = durationMs + (options.trimToBounds ? 0 : tail * 1000)
  const level = { volume: options.volume, distancePercent: options.distancePercent ?? 0 }
  return renderTracks(trackJobs(kept, engineSegments, shieldSegments), (job, hooks) => renderAudioMix(job, buffers, total, level, hooks), options.hooks)
}

/** One track to render: its family (`null` = the complete mixing) and what it mixes. */
type TrackJob = MixJob & { family: SoundFamily | null }

/** The complete mixing first, then the NON-EMPTY families in `FAMILY_ORDER`. */
function trackJobs(
  kept: readonly MixedSound[],
  engines: readonly EngineSegment[],
  shields: readonly ShieldSegment[],
): TrackJob[] {
  const jobs: TrackJob[] = [{ family: null, sounds: kept, engines, shields }]
  for (const family of FAMILY_ORDER) {
    const sounds = kept.filter((s) => s.family === family)
    // The engines and the shield are SOUND EFFECTS: they come out in the `sfx` track, like in
    // the mixing.
    const sfx = family === 'sfx'
    const familyEngines = sfx ? engines : []
    const familyShields = sfx ? shields : []
    if (sounds.length > 0 || familyEngines.length > 0 || familyShields.length > 0) {
      jobs.push({ family, sounds, engines: familyEngines, shields: familyShields })
    }
  }
  return jobs
}

/**
 * renderTracks renders the jobs one after the other, the progress of each scaled into the share
 * of the whole. `null` as soon as one render was cancelled.
 */
async function renderTracks(
  jobs: readonly TrackJob[],
  render: (job: MixJob, hooks: RenderHooks) => Promise<AudioBuffer | null>,
  hooks: RenderHooks = {},
): Promise<MixedTracks | null> {
  const out: { family: SoundFamily | null; buffer: AudioBuffer }[] = []
  for (const [i, job] of jobs.entries()) {
    const buffer = await render(job, {
      cancelled: hooks.cancelled,
      progress: (f) => hooks.progress?.((i + f) / jobs.length),
    })
    if (!buffer) return null
    out.push({ family: job.family, buffer })
  }
  const families = out.slice(1).flatMap((t) => (t.family ? [{ family: t.family, buffer: t.buffer }] : []))
  return { full: out[0].buffer, families }
}