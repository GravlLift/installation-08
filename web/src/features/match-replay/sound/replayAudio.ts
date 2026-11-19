// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayAudio.ts — THE Web Audio PLAYBACK of the replay's sounds, and nothing else.
 *
 * THE PLAYED DURATION IS THAT OF THE FILE, and it is the file that carries the duration rule
 * per category (user decision of 2026-08-16, lot R2.1): a weapon, a throw and
 * the melee are delivered at 1.2 s; a grenade explosion and an equipment go up to
 * 4 s, because their source lasts 1.8 to 4.8 s and cutting them at the second made them
 * "cut short" by ear; the lines and fanfares of END OF MATCH (lot C,
 * 2026-08-27) are delivered in full, up to 11.67 s — a cut fanfare is no longer a
 * fanfare. The player therefore no longer imposes ITS second on everyone: it plays what is
 * delivered to it, and `SOUND_CUT_MAX_S` is no more than a SAFETY CEILING against a file delivered too
 * long.
 *
 * THE CUT REMAINS A GAIN ENVELOPE: full hold, then fade out over the
 * last 0.25 s. A hard `stop()` in the middle of a wave would click (discontinuity) — the
 * fade is the clean cut, including at the exact end of a file whose source has been
 * truncated at the ceiling (that is the case of the plasma explosion, source 4.07 s).
 *
 * The AudioContext is born ONLY in the user gesture that activates the sound (browsers'
 * autoplay policy: a context created outside a gesture starts suspended). The sound of
 * the replay being CUT OFF BY DEFAULT, nothing is loaded nor sounds until the user has
 * not clicked — that is also what respects `prefers-reduced-motion` by construction:
 * no undemanded stimulation.
 *
 * A file not found or undecodable is memorized as ABSENT (clean silence, no
 * re-attempt at each kill) — the manifest (replaySound.ts) makes the case exceptional,
 * the assets guardrail makes it visible in CI.
 */

import {
  gainFromDb,
  type DistanceChain,
  type SoundDraw,
} from './weaponSoundLogic'
import { type SoundPlacement } from './soundSpatial'

/**
 * CEILING of played duration, in seconds — not the cut: the duration of a sound is that of its
 * FILE (rule per category, applied at the delivery of the assets: weapons/throws/melee
 * 1.2 s, explosions and equipment up to 4 s, lines and fanfares of END OF MATCH
 * in full). This ceiling therefore does not bite on ANY file delivered today — it exists so
 * that an asset delivered by mistake at full length (a 30 s source) does not hold a voice
 * during a whole exchange.
 *
 * THE RULE IS "CEILING = LONGEST FILE DELIVERED", rounded up: a lower number
 * would truncate a sound WITHOUT anything saying so, a much higher number would no longer protect
 * anything. History of the readings (merge of 2026-08-27, two convergent lots): 4.0 s while
 * explosions and equipment were the longest; 4 -> 6 s when the reconstruction of
 * the Wwise gestures revealed that a container declares HOW MANY TIMES it plays AND AT WHAT RHYTHM
 * (`play_004_mod_mp_ctf_flag_taken_team` 4.588 s, `objective_zone_new` 5.15 s); 6 -> 12 s
 * when the END OF MATCH fanfares enter the catalog — the longest, the tie, makes
 * 11.67 s. The ceiling is not there to shorten a gesture — truncating it in silence is
 * exactly what this comment forbids — but so that an asset delivered by mistake at full
 * length (a 30 s source) does not hold a voice during a whole exchange. It is the
 * guardrail `replaySoundAssets.guard.test.ts` that poses the question at each delivery.
 *
 * WHAT IT CHANGES NOT: what saturates the voices is the SHOT, and a shot always lasts 1.2 s.
 * The long gestures (flag steal, hill move, end fanfare) are the rarest of the track.
 */
export const SOUND_CUT_MAX_S = 12.0

/** Duration of the fade out, in seconds (bounded to half of the sound for the very short). */
export const SOUND_FADE_S = 0.25

/**
 * Maximum simultaneous voices: beyond, the extra sounds are skipped. On a
 * sustained exchange, stacking twenty sources tells nothing more than a wall of noise.
 *
 * IT IS THE ONLY CEILING OF THE WHOLE SOUND CHAIN since ALL shots sound
 * (user decision of 2026-08-15: no editorial filtering). What it costs, measured
 * the same day by simulation at 1x (a voice held 1 s, the played duration of then): on the
 * witness film 000d5950, 46 sources refused for 483 sonic shots; on the 23 artifacts
 * local, 4 897 refusals for 17 068 sources, i.e. 28.7%. Raising it is a change of ONE
 * digit — to do if the listening demands it, not before: it is an ear decision, not
 * code.
 *
 * WHAT THE EXTENSION OF 2026-08-16 CHANGES FOR THIS CEILING: nothing on what makes it
 * bite. What saturates it is the SHOT (17 904 shots in the measured corpus), and a shot lasts
 * always 1.2 s. Only the explosions and the equipment now hold up to 4 s,
 * and they are the rarest events of the track — a grenade kill, a
 * cloak episode. The ceiling stays unchanged (decision of lot R2.1).
 *
 * WHICH sounds it keeps once full is `admitVoice`'s rule (the louder takes the quietest's slot),
 * since the footsteps of every Spartan made them the bulk of the track.
 */
export const SOUND_MAX_VOICES = 8

/**
 * soundOccupiesVoice — THE SINGLE RULE of the voice ceiling, shared by the page player
 * (`ReplayAudioPlayer.play` / `playConclusion` / `playAnnouncer`) and by the export (`applyVoiceCap`).
 *
 * AN ANNOUNCER'S VOICE ESCAPES THE CEILING AND OCCUPIES NO VOICE: the conclusion (voice and
 * fanfare of MATCH end) and the "round ended" voice. The ceiling arbitrates between sounds OF
 * MIXED ACTION, all equivalent; an announcement is not one — it tells the course of the match, and it is
 * precisely at the moments it announces (round end, match end) that the last shots,
 * throws and explosions hold the eight voices: an announcement submitted to the ceiling would be refused
 * in silence.
 */
export function soundOccupiesVoice(sound: { conclusion?: boolean; announcer?: boolean }): boolean {
  return sound.conclusion !== true && sound.announcer !== true
}

/**
 * soundSurvivesPause — THE PAUSE CUTS ONLY WHAT IS NOT THE CONCLUSION. A distinct question from the
 * voice ceiling (`soundOccupiesVoice`): the "round ended" voice escapes the ceiling BUT
 * stops at the pause, like any line in flight on a stopped image; the match conclusion
 * (voice and fanfare) goes out at the moment playback stops by itself, and the pause that follows must not
 * cut it.
 */
export function soundSurvivesPause(sound: { conclusion?: boolean }): boolean {
  return sound.conclusion === true
}

/** What a sound is for the player: does it submit to the voice ceiling, does it survive the pause? */
interface SoundKind {
  voix: boolean
  survitALaPause: boolean
}

/**
 * A VOICE as the ceiling sees it, on the AUDIO clock (seconds): when it frees its slot (`endS`),
 * when its own fade begins (`fadeStartS`), and the LEVEL it plays at — the linear hold gain of the
 * sound (event gain x variation x distance), the master left out.
 */
export interface VoiceSlot {
  endS: number
  fadeStartS: number
  level: number
  /** A foot or movement sound (`ReplaySoundEvent.footstep`). */
  footstep?: boolean
}

/**
 * voiceLevelOf — THE LEVEL a sound plays at, the one quantity the ceiling ranks voices by. Shared
 * by the page player and the export so both rank a voice the same.
 */
export function voiceLevelOf(draw?: { gainDb: number }, place?: { gain: number }): number {
  return (draw ? gainFromDb(draw.gainDb) : 1) * (place?.gain ?? 1)
}

/**
 * admitVoice — THE SINGLE RULE of the voice ceiling, on the audio clock, for the page player and
 * the export alike (`applyVoiceCap`).
 *
 * A slot is busy from its sound's start until its envelope ends (`endS`), measured on the clock
 * the sound plays on — never on the moment the browser happens to deliver `onended`, which a
 * busy main thread delays and which then held slots for sounds long finished.
 *
 * Under the ceiling, the sound passes. At the ceiling, it TAKES THE SLOT OF THE QUIETEST voice in
 * flight if that voice is strictly quieter than it, and is refused otherwise. Since the footsteps
 * of every Spartan entered the track (measured on d01ba030, the busiest 30 s of combat: 89% of the
 * events are footsteps, the ceiling sat full in the median second, and a first-come ceiling
 * refused 20-29% of the followed player's own sounds and 28-32% of the others' shots while 230
 * distant footsteps played), "first come" handed the slots to whatever was most frequent, not to
 * what is heard: the level is what the listener hears, so it is the rank. The followed player's
 * own sounds play at full level and outrank every placed sound; a far footstep is the first to go.
 *
 * A FOOTSTEP TAKES ONLY A FOOTSTEP'S SLOT. The footsteps are what fills the ceiling (92% of the
 * events of the busiest two minutes of the same match), they are the shortest and the most
 * redundant sounds of the track (one per stride), and they sit at -3 dB where the others' shots sit
 * at -4 dB: by level alone, a Spartan's step would cut the tail of a shot fired where he stands. So
 * a footstep competes with footsteps; a shot, a throw or an equipment takes any quieter slot.
 *
 * Only a voice still on its plateau (`fadeStartS` after the moment) can be taken: one already
 * fading frees its slot on its own, and cutting into a ramp would click.
 */
export function admitVoice(
  slots: readonly VoiceSlot[],
  atS: number,
  level: number,
  footstep = false,
): { admit: false } | { admit: true; steal?: VoiceSlot } {
  let busy = 0
  let victim: VoiceSlot | undefined
  for (const v of slots) {
    if (v.endS <= atS) continue
    busy++
    if (footstep && !v.footstep) continue
    if (v.fadeStartS > atS && (!victim || v.level < victim.level)) victim = v
  }
  if (busy < SOUND_MAX_VOICES) return { admit: true }
  if (victim && victim.level < level) return { admit: true, steal: victim }
  return { admit: false }
}

/**
 * Duration of the fade of a voice whose slot is taken (`admitVoice`), in seconds: the same short
 * ramp as the volume (`VOLUME_RAMP_S`), long enough not to click.
 */
export const SOUND_STEAL_FADE_S = 0.02

/**
 * SOUND_LOOKAHEAD_S — how far ahead of the playback the page schedules its sounds, in seconds of
 * real time, on the AUDIO clock (`start(when)`).
 *
 * The beat that reads the track runs in the animation loop: a sound used to start at the beat that
 * crossed it, so it came out as late as the frame was long, and every sound of a long frame came
 * out at the same instant. Measured on d01ba030 (busiest 30 s, beats 30-50 ms apart): median 25 ms
 * late, 90th percentile 44 ms, 10% of the sounds bunched on another's instant; with a 250 ms frame
 * every 5 s, 99th percentile 180 ms. Scheduled ahead, a sound starts at its own moment as long as
 * no gap between two beats exceeds the lookahead: 100 ms covers twice the slowest beat of that
 * measurement and a 10 fps stall, and is short enough that a jump or a pause cancels at most a
 * tenth of a second of sounds that had not started.
 */
export const SOUND_LOOKAHEAD_S = 0.1

/** soundKindOf — the two rules above for an ordinary sound, an announcement or a conclusion. */
function soundKindOf(sound: { conclusion?: boolean; announcer?: boolean }): SoundKind {
  return { voix: soundOccupiesVoice(sound), survitALaPause: soundSurvivesPause(sound) }
}

/**
 * Duration of the volume ramp, in seconds. Setting `gain.value` all at once while a sound
 * plays makes a CLICK (discontinuity) — at the volume cursor, which emits dozens of
 * values per second, that would be a crackle. 20 ms suffice and are not heard.
 */
export const VOLUME_RAMP_S = 0.02

/**
 * soundEnvelope computes the envelope of a source of `durationS` seconds: the moment where
 * the fade begins and the one where everything stops. Pure, tested (replaySound.test.ts).
 *
 * The sound plays until the END OF ITS FILE (delivery regulates the duration per
 * category), except beyond the safety ceiling. The fade is bounded to half of the sound
 * for the very short: without that, a 0.1 s sound would be a fade and nothing else.
 */
export function soundEnvelope(durationS: number): { fadeStartS: number; stopS: number } {
  const stopS = Math.min(Math.max(durationS, 0), SOUND_CUT_MAX_S)
  const fade = Math.min(SOUND_FADE_S, stopS / 2)
  return { fadeStartS: stopS - fade, stopS }
}

/**
 * The SHAPE of a burst sound (schema 71, lot M4b): held in loop for `holdS`, or cut to
 * `cutS` (the next shot of a loopless burst). Absent = the ordinary envelope.
 */
export interface SoundShape {
  holdS?: number
  cutS?: number
  /**
   * The moment its slot was TAKEN by a louder sound (`admitVoice`), in seconds from its start: the
   * sound fades out there over `SOUND_STEAL_FADE_S`. Set by the export's ceiling only; the page
   * player cuts the voice in flight the same way.
   */
  stealS?: number
}

/**
 * Duration of the RELEASE of a held sound, in seconds: the loop dies out in 50 ms at the release of the
 * trigger — enough not to click, short enough that the tail shot that follows reads.
 */
export const SOUND_HOLD_RELEASE_S = 0.05

/**
 * soundEnvelopeOf — the envelope of a sound ACCORDING TO ITS SHAPE: held (loop until `holdS`, then
 * release), cut (stop at `cutS`, fade bounded to half), or ordinary (`soundEnvelope`).
 * Pure, and the SAME for playback and for the export.
 */
export function soundEnvelopeOf(
  durationS: number,
  shape?: SoundShape,
): { fadeStartS: number; stopS: number; loop: boolean } {
  const env = shapedEnvelope(durationS, shape)
  const steal = shape?.stealS
  if (steal !== undefined && steal >= 0 && steal < env.fadeStartS) {
    return { fadeStartS: steal, stopS: steal + SOUND_STEAL_FADE_S, loop: env.loop }
  }
  return env
}

/** shapedEnvelope — the envelope of a held, cut or ordinary sound, before any taken slot. */
function shapedEnvelope(durationS: number, shape?: SoundShape): { fadeStartS: number; stopS: number; loop: boolean } {
  if (shape?.holdS !== undefined && shape.holdS > 0) {
    const hold = Math.min(shape.holdS, SOUND_CUT_MAX_S)
    return { fadeStartS: hold, stopS: hold + SOUND_HOLD_RELEASE_S, loop: true }
  }
  if (shape?.cutS !== undefined && shape.cutS > 0) {
    const stopS = Math.min(Math.max(durationS, 0), shape.cutS, SOUND_CUT_MAX_S)
    return { fadeStartS: stopS - Math.min(SOUND_FADE_S, stopS / 2), stopS, loop: false }
  }
  return { ...soundEnvelope(durationS), loop: false }
}

/** soundShapeOf — the shape of an event of the track, in seconds. */
export function soundShapeOf(e: { holdMs?: number; cutMs?: number }): SoundShape | undefined {
  if (e.holdMs !== undefined) return { holdS: e.holdMs / 1000 }
  if (e.cutMs !== undefined) return { cutS: e.cutMs / 1000 }
  return undefined
}

/** A sound of the player, in flight or scheduled: its nodes and its slot on the audio clock. */
interface LiveVoice extends VoiceSlot {
  src: AudioBufferSourceNode
  gain: GainNode
  startS: number
  survitALaPause: boolean
  voix: boolean
  loop: boolean
}

/**
 * ReplayAudioPlayer — context, master volume, buffer cache, enveloped playback.
 *
 * The constructor MUST be called in a user gesture (click on the sound button).
 */
export class ReplayAudioPlayer {
  private ctx: AudioContext
  private master: GainNode
  /** URL -> decoded buffer, or null = absent/undecodable (memorized silence). */
  private buffers = new Map<string, AudioBuffer | null>()
  /** URL -> loading in progress: one request per URL, and a promise we can await. */
  private loading = new Map<string, Promise<void>>()
  /**
   * ALL the sounds in flight or scheduled (a pause cuts everything off, not only the held
   * bursts), with their slot on the audio clock. `survitALaPause` is true only for a CONCLUSION
   * of match (fanfare, end announcer): it goes out at the very moment playback stops by itself at
   * the bound, and the pause that follows must not cut it (`soundSurvivesPause`). `voix` says
   * whether it holds a slot of the ceiling; `loop` marks a HELD sound (full-auto fire burst),
   * which the jump cuts too.
   */
  private live = new Set<LiveVoice>()
  /** Distance chain (instance setting, admin page). Null = NO node added:
   *  the signal path stays the original one, source -> envelope -> master. */
  private distGain: GainNode | null = null
  private distFilter: BiquadFilterNode | null = null
  /**
   * THE RECORDING FAUCET (2026-08-26): a second output, wired IN PARALLEL with
   * `ctx.destination`, whose track goes to the `MediaRecorder` of the video capture.
   *
   * It exists only if demanded (`recordingTrack`): a replay we do not film does not
   * pay for one more node. Once born it STAYS — a following recording resumes the
   * same track, and recreating it at each clip would leave nodes behind it.
   */
  private recordDest: MediaStreamAudioDestinationNode | null = null
  /**
   * The last node BEFORE the output: `master` without distance chain, `distFilter` with.
   * Following it is what allows the faucet to wire to the RIGHT place — wiring `master`
   * while the distance chain is set would record a sound that no one hears.
   */
  private out: AudioNode
  /**
   * THE REVERB SEND (`zoneReverb.ts`): every world sound (`play`, and the buses asked `wet`) feeds
   * it as well as the master; the zone reverb hangs its convolvers on it and returns them to the
   * master. Nothing hangs on it until a map's reverbs load, and an unconnected gain costs nothing.
   * The announcer, the intro music and the match conclusion stay dry: they are not in the world.
   */
  private send: GainNode

  /** `volume` is set AT CONSTRUCTION: a default gain at 1 would pass the first
   *  sound at full before the user's preference is applied. */
  constructor(volume: number) {
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.master.gain.value = Math.min(Math.max(volume, 0), 1)
    this.send = this.ctx.createGain()
    this.out = this.master
    this.connectOut(this.master)
  }

  /** reverbBus — the context, the send every world sound feeds, and the master to return into. */
  reverbBus(): { ctx: BaseAudioContext; send: AudioNode; out: AudioNode } {
    return { ctx: this.ctx, send: this.send, out: this.master }
  }

  /**
   * connectOut wires a node to the OUTPUTS: the speakers always, and the
   * recording faucet when it exists. The three points of the class that reached
   * `ctx.destination` go through here — otherwise setting the distance chain during
   * a recording would cut the sound of the clip without cutting that of the speakers.
   */
  private connectOut(node: AudioNode): void {
    this.out = node
    node.connect(this.ctx.destination)
    if (this.recordDest) node.connect(this.recordDest)
  }

  /**
   * recordingTrack returns the audio track to join to a video, or `null` if this browser does
   * not know how to make one. The faucet is created ON FIRST REQUEST, then kept.
   */
  recordingTrack(): MediaStreamTrack | null {
    if (typeof this.ctx.createMediaStreamDestination !== 'function') return null
    if (!this.recordDest) {
      this.recordDest = this.ctx.createMediaStreamDestination()
      // The faucet is born AFTER the wiring: it therefore must be re-hooked to the current output,
      // the very one the speakers receive.
      this.out.connect(this.recordDest)
    }
    return this.recordDest.stream.getAudioTracks()[0] ?? null
  }

  /**
   * setVolume adjusts the master volume (bounded 0..1) by a SHORT RAMP: that is what
   * distinguishes a setting from a click. Volume 0 = cut-off — the sounds already in flight die out
   * with the master, none is left in the background.
   */
  setVolume(v: number): void {
    const t0 = this.ctx.currentTime
    const g = this.master.gain
    g.cancelScheduledValues(t0)
    g.setValueAtTime(g.value, t0)
    g.linearRampToValueAtTime(Math.min(Math.max(v, 0), 1), t0 + VOLUME_RAMP_S)
  }

  /**
   * setDistance sets or removes the distance chain (attenuation + low-pass) BETWEEN the
   * master and the output. Instance setting (admin): at 0%, `chain` is null and the two
   * nodes are disconnected — the extracted file plays as is, "pure sounds" requirement.
   */
  setDistance(chain: DistanceChain | null): void {
    this.master.disconnect()
    if (!chain) {
      this.connectOut(this.master)
      return
    }
    if (!this.distGain || !this.distFilter) {
      this.distGain = this.ctx.createGain()
      this.distFilter = this.ctx.createBiquadFilter()
      this.distFilter.type = 'lowpass'
      this.distGain.connect(this.distFilter)
    }
    this.distGain.gain.value = gainFromDb(chain.gainDb)
    this.distFilter.frequency.value = chain.cutoffHz
    this.distFilter.disconnect()
    this.connectOut(this.distFilter)
    this.master.connect(this.distGain)
  }

  /**
   * engineBus — THE PORT OF THE VEHICLE ENGINES (`vehicleEnginePlayer.ts`): the context, a
   * dedicated gain bus wired to the MASTER, and access to the buffers already decoded.
   *
   * The bus goes through `master` and not through the output: the engines thus follow the volume
   * set, the distance chain AND the recording faucet without any of the three having
   * to know their existence. The bus gain (0.85, user decision of 2026-09-04) is
   * set by the caller — this player knows no engine rule. `wet` also feeds the bus to the zone
   * reverb's send (world sounds: engines, shields; not the ambient beds, which are room tone).
   */
  engineBus(gain: number, wet = false): { ctx: BaseAudioContext; out: AudioNode; bufferOf: (url: string) => AudioBuffer | null | undefined } {
    const bus = this.ctx.createGain()
    bus.gain.value = gain
    bus.connect(this.master)
    if (wet) bus.connect(this.send)
    return { ctx: this.ctx, out: bus, bufferOf: (url) => this.buffers.get(url) }
  }

  /** resume restarts the context (to call in the activation gesture). */
  resume(): void {
    void this.ctx.resume()
  }

  /** dispose closes the context (unmount of the component). */
  dispose(): void {
    void this.ctx.close()
  }

  /**
   * preload loads and decodes the URLs not yet known, in background. A failure
   * (404, decoding) is memorized as absent: never a re-attempt per event.
   */
  preload(urls: Iterable<string>): void {
    for (const url of urls) {
      if (this.buffers.has(url) || this.loading.has(url)) continue
      this.loading.set(url, this.load(url))
    }
  }

  private async load(url: string): Promise<void> {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const raw = await res.arrayBuffer()
      this.buffers.set(url, await this.ctx.decodeAudioData(raw))
    } catch (err) {
      // Clean silence AND said: a manifest asset missing at runtime is a
      // deployment anomaly, not a nominal case — a trace, not one per kill.
      console.warn('replay 3D: sound unavailable, silence:', url, err)
      this.buffers.set(url, null)
    } finally {
      this.loading.delete(url)
    }
  }

  /**
   * play plays an already loaded URL: full hold then fade (soundEnvelope), at `slot.when` on the
   * audio clock (`timeAt`), or now when it is absent or already past; `slot.footstep` marks a foot
   * sound for the ceiling (`admitVoice`). Not yet loaded (scrub
   * before the end of the preload) or absent: silence, never a wait — a sound late on its image is
   * worse than a missed sound.
   */
  play(url: string, draw?: SoundDraw, shape?: SoundShape, place?: SoundPlacement, slot: { when?: number; footstep?: boolean } = {}): void {
    this.start(url, soundKindOf({}), { draw, shape, place, when: slot.when, footstep: slot.footstep, wet: true })
  }

  /**
   * playConclusion plays an END OF MATCH sound (announcer's voice, fanfare): same envelope as
   * `play`, but OUTSIDE THE CEILING and without counting a voice — rule and reason: `soundOccupiesVoice`.
   */
  playConclusion(url: string): void {
    this.start(url, soundKindOf({ conclusion: true }))
  }

  /**
   * playAnnouncer plays a TRACK ANNOUNCER'S VOICE ("round ended"): same envelope as
   * `play`, OUTSIDE THE CEILING and without counting a voice — rule and reason: `soundOccupiesVoice`.
   * `when` as for `play`.
   */
  playAnnouncer(url: string, when?: number): void {
    this.start(url, soundKindOf({ announcer: true }), { when })
  }

  /**
   * timeAt — THE AUDIO-CLOCK MOMENT of a page moment (`performance.now()` milliseconds): what
   * `play(…, when)` takes. The page's animation loop dates its frames on the page clock, the
   * sources start on the audio clock; the two are read together here, so a sound scheduled ahead
   * lands at its frame's moment whatever the beat that scheduled it. A past moment reads as now.
   */
  timeAt(pageMs: number, nowPageMs: number = performance.now()): number {
    const t = this.ctx.currentTime
    return Math.max(t, t + (pageMs - nowPageMs) / 1000)
  }

  /** Is the URL decoded (buffer ready, not a memorized absent)? */
  isLoaded(url: string): boolean {
    return !!this.buffers.get(url)
  }

  /** Resolves when the loading of the URL is done, successful or not; launches it if needed. */
  whenLoaded(url: string): Promise<void> {
    this.preload([url])
    return this.loading.get(url) ?? Promise.resolve()
  }

  /**
   * playFrom plays like `play` (ordinary path, voice ceiling), but entering the buffer at
   * `offsetS`: a sound that went out late stays aligned on the moment it should have gone out (intro
   * music, A4.9). The rest of the envelope is offset by that much.
   */
  playFrom(url: string, offsetS: number): void {
    this.start(url, soundKindOf({}), { offsetS })
  }

  /** start places an enveloped source; `kind` says whether it submits to the ceiling (and holds it) and whether the pause cuts it. */
  private start(
    url: string,
    kind: SoundKind,
    opts: { draw?: SoundDraw; shape?: SoundShape; offsetS?: number; place?: SoundPlacement; when?: number; footstep?: boolean; wet?: boolean } = {},
  ): void {
    const footstep = opts.footstep === true
    const { draw, shape, place } = opts
    const offsetS = opts.offsetS ?? 0
    const { voix, survitALaPause } = kind
    const buf = this.buffers.get(url)
    if (!buf) {
      if (buf === undefined) this.preload([url])
      return
    }
    const now = this.ctx.currentTime
    const t0 = Math.max(now, opts.when ?? now)
    const env = soundEnvelopeOf(buf.duration, shape)
    const [fadeStartS, stopS, loop] = [env.fadeStartS - offsetS, env.stopS - offsetS, env.loop]
    // The VARIATION of this playback (the game's RANGED ranges, drawn upstream): a gain
    // of start and a playback speed. Without a draw, the hold is at 1 — unchanged. The PLACE
    // (`place`) multiplies it: a spatialized sound is lower according to its distance, at the same
    // wiring as a non-spatialized sound when we do not ask for one. It is also the voice's rank.
    const tenue = voiceLevelOf(draw, place)
    if (voix) {
      const verdict = admitVoice(this.slotsAt(now), t0, tenue, footstep)
      if (!verdict.admit) return
      if (verdict.steal) this.cut(verdict.steal as LiveVoice, t0, SOUND_STEAL_FADE_S)
    }
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(tenue, t0)
    gain.gain.setValueAtTime(tenue, t0 + fadeStartS)
    gain.gain.linearRampToValueAtTime(0, t0 + stopS)
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.loop = loop
    if (draw && draw.playbackRate !== 1) src.playbackRate.value = draw.playbackRate
    src.connect(gain)
    // The PAN is born only if demanded and at a SIDE: without `place`, or `pan` at 0,
    // the wiring stays exactly gain -> master, no node more.
    let panner: StereoPannerNode | null = null
    if (place && place.pan !== 0) {
      panner = this.ctx.createStereoPanner()
      panner.pan.value = place.pan
      gain.connect(panner)
      panner.connect(this.master)
      if (opts.wet) panner.connect(this.send)
    } else {
      gain.connect(this.master)
      if (opts.wet) gain.connect(this.send)
    }
    // A HELD SOUND (`loop`) is held back: the pause and the jump cut it (`stopHeld`), otherwise a
    // burst of ten seconds would keep firing on a stopped image.
    const voice: LiveVoice = {
      src, gain, survitALaPause, voix, loop,
      startS: t0, fadeStartS: t0 + fadeStartS, endS: t0 + stopS, level: tenue, footstep,
    }
    this.live.add(voice)
    // `onended` only RELEASES THE NODES: the slot is already free on the audio clock (`endS`),
    // whenever the browser gets round to delivering this event.
    src.onended = () => {
      this.live.delete(voice)
      src.disconnect()
      gain.disconnect()
      if (panner) panner.disconnect()
    }
    src.start(t0, offsetS)
    src.stop(t0 + stopS)
  }

  /** slotsAt — the voices that hold a slot of the ceiling and have not ended by `t` (audio clock). */
  private slotsAt(t: number): LiveVoice[] {
    const out: LiveVoice[] = []
    for (const v of this.live) if (v.voix && v.endS > t) out.push(v)
    return out
  }

  /**
   * cut fades a voice out from `atS` over `fadeS` (no click) and frees its slot there. A voice
   * scheduled to start after `atS` never sounds. `atS` is never before now.
   */
  private cut(v: LiveVoice, atS: number, fadeS: number): void {
    const g = v.gain.gain
    g.cancelScheduledValues(atS)
    if (atS < v.startS) {
      g.setValueAtTime(0, atS)
      v.src.stop(atS)
    } else {
      // On its plateau (or already fading): hold the level it has at `atS`, then ramp down.
      g.setValueAtTime(atS < v.fadeStartS ? v.level : g.value, atS)
      g.linearRampToValueAtTime(0, atS + fadeS)
      v.src.stop(atS + fadeS)
    }
    v.endS = Math.min(v.endS, atS)
    v.fadeStartS = Math.min(v.fadeStartS, atS)
  }

  /** stopHeld cuts off the HELD sounds in flight (volume ramp), at the pause and the jump. */
  stopHeld(): void {
    const t0 = this.ctx.currentTime
    for (const v of this.live) {
      if (!v.loop || v.endS <= t0) continue
      this.cut(v, t0, VOLUME_RAMP_S)
      this.live.delete(v)
    }
  }

  /**
   * cancelPending drops the sounds SCHEDULED AHEAD that have not started yet (`SOUND_LOOKAHEAD_S`):
   * at a jump, they belong to the moment left. What already sounds plays out, as before.
   */
  cancelPending(): void {
    const t0 = this.ctx.currentTime
    for (const v of this.live) {
      if (v.startS <= t0) continue
      this.cut(v, t0, VOLUME_RAMP_S)
      this.live.delete(v)
    }
  }

  /**
   * stopAll cuts off EVERYTHING that is in flight or scheduled (volume ramp), conclusion excepted
   * (`soundSurvivesPause`): that is the PAUSE. A vehicle explosion, a line, the voice of
   * round or the intro excerpt do not end on a stopped image; stopHeld only covered
   * the held bursts.
   */
  stopAll(): void {
    const t0 = this.ctx.currentTime
    for (const v of this.live) {
      if (v.survitALaPause) continue
      this.cut(v, t0, VOLUME_RAMP_S)
      this.live.delete(v)
    }
  }
}
