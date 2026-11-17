// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shieldSoundPlayer.ts — PLAYS the followed Spartan's shield alarms (`shieldSound.ts` says what
 * and when) on a bus of the main player, like the engines and the ambient bed.
 *
 * `sync` is called at each animation step of a playback with the shield reading of the frame:
 *  - the LOOP of the frame's state (low or depleted beep) sounds, entered at the beat the state's
 *    start gives, so a seek lands where a playback would;
 *  - the ONE-SHOTS (break, recharge, full) of the transitions crossed since the last step sound
 *    only when the step CONTINUES the last one (same life, forward, under SOUND_RESYNC_JUMP_MS):
 *    a seek, a rewind, another life or another player crosses nothing.
 * `stopAll` (pause, sound cut, muted speed, no player followed) silences everything in flight and
 * forgets the last step, so the next one crosses nothing either.
 */
import { SOUND_RESYNC_JUMP_MS } from './replaySoundCursor'
import { VOLUME_RAMP_S } from './replayAudio'
import { loopOffsetS, pickRechargeRise, SHIELD_SOUND, shieldCuesBetween, shieldLoopAt, type ShieldCue, type ShieldLoop, type ShieldSoundReading } from './shieldSound'

/** The shield bus under the master: the HUD's own sounds, at the level of the event sounds. */
export const SHIELD_BUS_GAIN = 1

/** A recharge rise cut before its end fades this long (the game's stop action: 100 ms). */
export const SHIELD_RISE_CUT_S = 0.1

export interface ShieldBus {
  ctx: Pick<BaseAudioContext, 'currentTime' | 'createGain' | 'createBufferSource'>
  out: AudioNode
  /** The decoded buffer of a stem, undefined while loading, null when absent. */
  bufferOf: (stem: string) => AudioBuffer | null | undefined
}

interface Voice {
  src: AudioBufferSourceNode
  gain: GainNode
}

const LOOP_STEM: Record<ShieldLoop, string> = { low: SHIELD_SOUND.lowLoop, broken: SHIELD_SOUND.brokenLoop }

export class ShieldSoundPlayer {
  private readonly bus: ShieldBus
  private last: { life: object; frame: number; ms: number } | null = null
  private loop: { loop: ShieldLoop; since: number; voice: Voice } | null = null
  private rise: Voice[] = []
  private shots: Voice[] = []

  constructor(bus: ShieldBus) {
    this.bus = bus
  }

  /** sync follows the frame `frame` (at `ms`, `frameMs` per frame); `reading` null = nothing to hear. */
  sync(reading: ShieldSoundReading | null, frame: number, ms: number, frameMs: number, continuous: boolean): void {
    if (!reading) {
      this.stopAll()
      return
    }
    const last = this.last
    if (continuous && last && last.life === reading.life && ms >= last.ms && ms - last.ms <= SOUND_RESYNC_JUMP_MS) {
      for (const cue of shieldCuesBetween(reading.track, last.frame, frame)) this.cue(cue)
    } else this.stopShots()
    this.last = { life: reading.life, frame, ms }
    this.syncLoop(shieldLoopAt(reading.track, frame), frame, frameMs)
  }

  private cue(cue: ShieldCue): void {
    switch (cue.kind) {
      case 'break':
        this.shot(SHIELD_SOUND.break, this.shots)
        return
      case 'recharge': {
        this.fade(this.rise, SHIELD_RISE_CUT_S)
        const pick = pickRechargeRise(cue.fillMs, SHIELD_SOUND.rises.map((s) => this.durationMs(s)))
        this.shot(SHIELD_SOUND.rechargeStart, this.rise)
        this.shot(SHIELD_SOUND.rechargeLayer, this.rise)
        if (pick >= 0) this.shot(SHIELD_SOUND.rises[pick], this.rise)
        return
      }
      case 'rechargeEnd':
        this.fade(this.rise, SHIELD_RISE_CUT_S)
        return
      case 'full':
        this.fade(this.rise, SHIELD_RISE_CUT_S)
        this.shot(SHIELD_SOUND.full, this.shots)
        this.shot(SHIELD_SOUND.fullLayer, this.shots)
    }
  }

  private syncLoop(want: { loop: ShieldLoop; since: number } | null, frame: number, frameMs: number): void {
    const cur = this.loop
    if (cur && want && cur.loop === want.loop && cur.since === want.since) return
    if (cur) this.fade([cur.voice], VOLUME_RAMP_S)
    this.loop = null
    if (!want) return
    const buf = this.bus.bufferOf(LOOP_STEM[want.loop])
    if (!buf) return // not decoded yet: the next step tries again
    const voice = this.start(buf, loopOffsetS((frame - want.since) * frameMs, buf.duration), true)
    this.loop = { ...want, voice }
  }

  private durationMs(stem: string): number | undefined {
    const buf = this.bus.bufferOf(stem)
    return buf ? buf.duration * 1000 : undefined
  }

  private shot(stem: string, into: Voice[]): void {
    const buf = this.bus.bufferOf(stem)
    if (buf) into.push(this.start(buf, 0, false))
  }

  private start(buf: AudioBuffer, offsetS: number, loop: boolean): Voice {
    const { ctx, out } = this.bus
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(1, ctx.currentTime)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = loop
    src.connect(gain)
    gain.connect(out)
    src.onended = () => {
      src.disconnect()
      gain.disconnect()
      for (const list of [this.rise, this.shots]) {
        const i = list.findIndex((v) => v.src === src)
        if (i >= 0) list.splice(i, 1)
      }
    }
    src.start(ctx.currentTime, offsetS)
    return { src, gain }
  }

  /** fade ramps voices to silence over `s` seconds and stops them; the list is emptied. */
  private fade(voices: Voice[], s: number): void {
    const t0 = this.bus.ctx.currentTime
    for (const { src, gain } of voices.splice(0)) {
      gain.gain.cancelScheduledValues(t0)
      gain.gain.setValueAtTime(gain.gain.value, t0)
      gain.gain.linearRampToValueAtTime(0, t0 + s)
      src.stop(t0 + s)
    }
  }

  private stopShots(): void {
    this.fade(this.rise, VOLUME_RAMP_S)
    this.fade(this.shots, VOLUME_RAMP_S)
  }

  /** stopAll silences the loop and the one-shots and forgets the last step. */
  stopAll(): void {
    this.stopShots()
    if (this.loop) this.fade([this.loop.voice], VOLUME_RAMP_S)
    this.loop = null
    this.last = null
  }
}
