// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * vehicleEnginePlayer.ts — THE REAL-TIME PLAYBACK of the vehicle engines, and nothing else.
 *
 * The event player (`replayAudio.ts`) plays envelopped one-shots; an engine is a
 * CONTINUOUS STATE (cf. the header of `vehicleEngineSound.ts`, which carries the plan and the
 * contract of the bank). This module holds the Web Audio sources of this state:
 *
 *  - CONTINUOUS ENTRY (the playback crosses T0): `enter` goes out, and its crossfade toward `loop`
 *    is PRE-PROGRAMMED at the construction (Web Audio automation) — no beat to watch,
 *    the junction lands to the sample whatever the load of the page.
 *  - SEEK IN THE MIDDLE OF AN EPISODE: resume DIRECTLY on `loop` (framing decision n° 6,
 *    never a re-enter — an engine start that did not take place would be a lie).
 *  - EXIT (the playback crosses T1): crossfade toward `exit`, which plays WHOLE and ends at
 *    zero by itself (engraved ends — NO added envelope, contract of the bank).
 *  - LONG STOP mid-episode (phase `arret`): the loop fades out
 *    (`ENGINE_STOP_FADE_S`) and the chain stays open WITHOUT a voice; on the resume, a new
 *    loop rises in a fade (`ENGINE_RESTART_FADE_S`). Neither `enter` nor `exit`: the engine
 *    was not cut.
 *  - PAUSE / CUT / UNMOUNT: short ramp (`ENGINE_STOP_RAMP_S`, 20 ms) — the anti-click
 *    of a stop that the timeline does not narrate, not a musical envelope.
 *  - PLAYBACK SPEED ≠ 1: the BOUNDS follow the timeline (T0/T1 are detected on the ms
 *    of the replay), but the files play at NATURAL SPEED — never a `playbackRate`,
 *    therefore never a "chipmunk" engine. Beyond `SOUND_MAX_SPEED`, the wiring
 *    (`useReplaySound`) stops calling `sync` and calls `stopAll`: same silence as the
 *    rest of the track, same "sound cut by speed" message.
 *
 * THE ENGINES DO NOT COUNT IN `SOUND_MAX_VOICES`: that ceiling arbitrates equivalent one-shots
 * of a melee; cutting an engine in favor of a shot would narrate that a vehicle
 * went silent without reason. Two or three simultaneous engines are the realistic maximum of a match,
 * and the bus at 0.85 keeps them in restraint.
 */
import {
  ENGINE_CROSSFADE_S,
  ENGINE_RESTART_FADE_S,
  ENGINE_STOP_FADE_S,
  ENGINE_STOP_RAMP_S,
  enginePhaseAt,
  equalPowerCurves,
  VEHICLE_ENGINE_STEMS,
  type EngineEpisode,
  type EnginePhase,
  type EnginePlan,
} from './vehicleEngineSound'

/**
 * Timeline jump beyond which a forward move is no longer a continuous playback: same value and
 * same reason as `SOUND_RESYNC_JUMP_MS` (replaySoundCursor.ts) — but here the reseeding does
 * not SKIP sounds, it reconciles a state (cut what should no longer sound, resume the
 * loop of what should).
 */
export const ENGINE_RESYNC_JUMP_MS = 1_000

/** What the engine player asks of its host: the context, the engine bus, the buffers. */
export interface EngineAudioPort {
  ctx: BaseAudioContext
  /** The engine bus (gain 0.85 set by the host), plugged on the master of the player. */
  out: AudioNode
  /** Decoded buffer of a stem, `null`/`undefined` = absent or not yet loaded: silence. */
  bufferOf: (stem: string) => AudioBuffer | null | undefined
}

/** A source in flight: the node, its gain, and what to turn it off cleanly. */
interface EngineVoice {
  src: AudioBufferSourceNode
  gain: GainNode
}

/** The state of an episode in the process of sounding. `holdUntil` protects the enter->loop programmed fade. */
interface EngineChain {
  phase: EnginePhase
  /**
   * The HELD voice (the loop), `null` during a stop. The enter and the exit are one-shots
   * that turn off by themselves.
   */
  held: EngineVoice | null
  /** Context time before which no idle/loop swap is allowed (enter fade in progress). */
  holdUntil: number
}

const CURVES = equalPowerCurves()

export class VehicleEnginePlayer {
  private port: EngineAudioPort
  private plans: EnginePlan[] = []
  /** key `plan:episode` -> chain in flight. */
  private chains = new Map<string, EngineChain>()
  /**
   * The ONE-SHOTS in flight (`enter` during its fade, `exit` up to its engraved end): they
   * are not the held voice of anyone, but a PAUSE must turn them off too — an engine
   * that finishes its start while the playback is stopped would be a sound without an image.
   */
  private tails = new Set<EngineVoice>()
  /** Last moment served, or `null` = the next `sync` is a silent reseeding. */
  private lastMs: number | null = null

  constructor(port: EngineAudioPort) {
    this.port = port
  }

  /** setPlans replaces the plan (document change). Everything that sounds stops. */
  setPlans(plans: EnginePlan[]): void {
    this.stopAll()
    this.plans = plans
  }

  /**
   * sync makes the state of the engines follow the moment `ms` of the replay. To call at each
   * audible beat; a jump (scrub, resume) is detected here and reconciled in silence.
   */
  sync(ms: number): void {
    const continuous =
      this.lastMs !== null && ms >= this.lastMs && ms - this.lastMs <= ENGINE_RESYNC_JUMP_MS
    const last = this.lastMs
    this.lastMs = ms
    this.forEachEpisode((key, plan, ep) => {
      const chain = this.chains.get(key)
      const phase = enginePhaseAt(ep, ms)
      if (!continuous || last === null) {
        this.reconcile(key, plan, chain, phase)
        return
      }
      // ENTRY: the playback CROSSES T0 — the only path that plays `enter`.
      if (!chain && last < ep.t0Ms && ms >= ep.t0Ms && phase !== null) {
        this.startEnter(key, plan, phase)
        return
      }
      // EXIT: the playback CROSSES T1 — fade toward `exit`, which plays whole.
      if (chain && last < ep.t1Ms && ms >= ep.t1Ms) {
        this.startExit(key, plan, chain)
        return
      }
      // RUNNING <-> STOP mid-episode, once the enter fade has settled.
      if (chain && phase !== null && chain.phase !== phase && this.port.ctx.currentTime >= chain.holdUntil) {
        this.swapHeld(plan, chain, phase)
        return
      }
      // Episode entered by a non-continuous path covered above? Reconciliation by default.
      if (!chain && phase !== null) this.startHeld(key, plan, phase)
    })
  }

  /** stopAll turns everything off by the short ramp. The next `sync` will be a reseeding. */
  stopAll(): void {
    for (const chain of this.chains.values()) this.release(chain)
    this.chains.clear()
    const t0 = this.port.ctx.currentTime
    for (const tail of this.tails) this.fadeOutVoice(tail, t0, ENGINE_STOP_RAMP_S)
    this.tails.clear()
    this.lastMs = null
  }

  dispose(): void {
    this.stopAll()
  }

  private forEachEpisode(fn: (key: string, plan: EnginePlan, ep: EngineEpisode) => void): void {
    for (let p = 0; p < this.plans.length; p++) {
      const plan = this.plans[p]
      for (let e = 0; e < plan.episodes.length; e++) fn(`${p}:${e}`, plan, plan.episodes[e])
    }
  }

  /** reconcile — the wanted state WITHOUT history: direct loop in, silence out. */
  private reconcile(
    key: string,
    plan: EnginePlan,
    chain: EngineChain | undefined,
    phase: EnginePhase,
  ): void {
    if (chain && (phase === null || chain.phase !== phase)) {
      this.release(chain)
      this.chains.delete(key)
    }
    if (phase !== null && (!chain || chain.phase !== phase)) this.startHeld(key, plan, phase)
  }

  /**
   * startHeld opens the chain WITHOUT enter (the seek path): the direct loop in running,
   * no voice during a stop.
   */
  private startHeld(key: string, plan: EnginePlan, phase: Exclude<EnginePhase, null>): void {
    if (phase === 'arret') {
      this.chains.set(key, { phase, held: null, holdUntil: 0 })
      return
    }
    const held = this.spawnLoop(plan, this.port.ctx.currentTime, 0)
    if (!held) return
    this.chains.set(key, { phase, held, holdUntil: 0 })
  }

  /**
   * startEnter plays `enter` and PRE-PROGRAMS its crossfade toward the held voice: the two
   * automations are placed now, the junction needs no beat.
   */
  private startEnter(key: string, plan: EnginePlan, phase: Exclude<EnginePhase, null>): void {
    const stems = VEHICLE_ENGINE_STEMS[plan.family]
    const buf = stems ? this.port.bufferOf(stems.enter) : null
    const t0 = this.port.ctx.currentTime
    if (!buf) {
      // Enter absent (late loading): the direct loop is better than a silence.
      this.startHeld(key, plan, phase)
      return
    }
    const fadeAt = t0 + Math.max(buf.duration - ENGINE_CROSSFADE_S, 0)
    const voice = this.spawnVoice(buf, false, t0, 1)
    this.trackTail(voice)
    voice.gain.gain.setValueCurveAtTime(CURVES.fadeOut, fadeAt, ENGINE_CROSSFADE_S)
    voice.src.stop(fadeAt + ENGINE_CROSSFADE_S)
    const held = this.spawnLoop(plan, fadeAt, ENGINE_CROSSFADE_S)
    if (!held) return
    this.chains.set(key, { phase: 'loop', held, holdUntil: fadeAt + ENGINE_CROSSFADE_S })
  }

  /** startExit fades the held voice toward `exit`, which plays WHOLE (engraved ends). */
  private startExit(key: string, plan: EnginePlan, chain: EngineChain): void {
    const stems = VEHICLE_ENGINE_STEMS[plan.family]
    const buf = stems ? this.port.bufferOf(stems.exit) : null
    const t0 = this.port.ctx.currentTime
    this.fadeOutHeld(chain, t0, ENGINE_CROSSFADE_S)
    this.chains.delete(key)
    if (!buf) return
    const voice = this.spawnVoice(buf, false, t0, 0)
    this.trackTail(voice)
    voice.gain.gain.setValueCurveAtTime(CURVES.fadeIn, t0, ENGINE_CROSSFADE_S)
    // No `stop` placed: the source stops at the end of its file, and `onended` cleans up.
  }

  /** trackTail follows a one-shot in flight so that `stopAll` can turn it off too. */
  private trackTail(voice: EngineVoice): void {
    this.tails.add(voice)
    const inner = voice.src.onended
    voice.src.onended = (ev) => {
      this.tails.delete(voice)
      if (inner) (inner as (this: AudioScheduledSourceNode, ev: Event) => void).call(voice.src, ev)
    }
  }

  /** fadeOutVoice — short ramp then stop of any voice. */
  private fadeOutVoice(voice: EngineVoice, at: number, fadeS: number): void {
    const g = voice.gain.gain
    try {
      g.cancelScheduledValues(at)
      g.setValueCurveAtTime(scaledFadeOut(g.value), at, fadeS)
    } catch (err) {
      // A fade ALREADY IN PROGRESS (entry, exit or crossfade) overlaps the stop curve: the
      // browser refuses the programming. A pause that throws an exception would leave the
      // engine running; we therefore cut outright (a click is better than an engine
      // idling on a stopped frame), and the cause is said.
      console.warn("[replay-audio] stop fade refused, hard cut:", err)
      voice.src.stop(at)
      return
    }
    voice.src.stop(at + fadeS)
  }

  /** swapHeld — running -> stop: the loop fades out; stop -> running: it rises. */
  private swapHeld(plan: EnginePlan, chain: EngineChain, phase: Exclude<EnginePhase, null>): void {
    const t0 = this.port.ctx.currentTime
    if (phase === 'arret') {
      this.fadeOutHeld(chain, t0, ENGINE_STOP_FADE_S)
    } else {
      const next = this.spawnLoop(plan, t0, ENGINE_RESTART_FADE_S)
      if (!next) return
      chain.held = next
    }
    chain.phase = phase
  }

  /** spawnLoop creates the HELD voice: the loop of the family, optional input fade. */
  private spawnLoop(plan: EnginePlan, at: number, fadeS: number): EngineVoice | null {
    const stem = VEHICLE_ENGINE_STEMS[plan.family]?.loop
    const buf = stem ? this.port.bufferOf(stem) : null
    if (!buf) return null
    const voice = this.spawnVoice(buf, true, at, fadeS > 0 ? 0 : 1)
    if (fadeS > 0) voice.gain.gain.setValueCurveAtTime(CURVES.fadeIn, at, fadeS)
    return voice
  }

  /** spawnVoice — source + gain plugged on the bus, cleaned at the end of the source. */
  private spawnVoice(buf: AudioBuffer, loop: boolean, at: number, gain0: number): EngineVoice {
    const ctx = this.port.ctx
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(gain0, at)
    const src = ctx.createBufferSource()
    src.buffer = buf
    // THE LOOP FADE IS IN THE FILE (contract of the bank): `loop = true` suffices.
    src.loop = loop
    src.connect(gain)
    gain.connect(this.port.out)
    src.onended = () => {
      src.disconnect()
      gain.disconnect()
    }
    src.start(Math.max(at, ctx.currentTime))
    return { src, gain }
  }

  /** fadeOutHeld turns off the held voice by a fade, then stops it. */
  private fadeOutHeld(chain: EngineChain, at: number, fadeS: number): void {
    if (!chain.held) return
    this.fadeOutVoice(chain.held, at, fadeS)
    chain.held = null
  }

  /** release — the emergency stop (pause, cut): 20 ms ramp, never a click. */
  private release(chain: EngineChain): void {
    const t0 = this.port.ctx.currentTime
    this.fadeOutHeld(chain, t0, ENGINE_STOP_RAMP_S)
  }
}

/** The output curve, rescaled to the current gain (a fade that starts from where we are). */
function scaledFadeOut(from: number): Float32Array {
  const base = CURVES.fadeOut
  const out = new Float32Array(base.length)
  for (let i = 0; i < base.length; i++) out[i] = base[i] * from
  return out
}
