// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ambienceBed.ts — THE MAP'S AMBIENT BEDS ("room tone"): one long loop per acoustic zone, played
 * quietly under the replay so the scene never goes dead silent.
 *
 * WHAT IT IS. The server (`internal/ambience`) extracts, per map, the background sound of each
 * acoustic zone: quad Wwise Vorbis loops of 16 to 78 s, written to repeat end to end, served for
 * a match as a layout (`/api/matches/<id>/ambience.json`) and one file per loop. The game plays
 * the bed of the zone the listener stands in; this player follows that rule (`ambienceZones.ts`):
 * the containing zone with the smallest volume (area x height) wins, the `fallback` loop when no
 * zone contains the listener or there is none (2D view). Web Audio downmixes the quad to stereo.
 *
 * WHY IT IS LAZY. A decoded 78 s stereo loop is ~30 MB, and a map can carry many zones: a loop's
 * file is fetched and decoded only when it becomes the target, at most `AMBIENCE_MAX_DECODED`
 * decoded buffers are kept, and the least recently used one that is not sounding is evicted.
 *
 * WHY THE SWITCH IS HELD. The camera crosses a doorway in a frame or two; switching beds on every
 * crossing would flap. A new target must hold for `AMBIENCE_SWITCH_HOLD_S` of audio clock before
 * it takes effect; the old voice then crossfades out over `AMBIENCE_CROSSFADE_S` while the new
 * one ramps in. Each loop remembers its own offset (`bedOffsetS`), so coming back to a zone
 * resumes that loop where it left off. While the new target is still loading, the current loop
 * keeps playing; when it lands, it crossfades in only if it is still the target.
 *
 * WHEN IT SOUNDS (`ambienceAudible`): while the replay PLAYS, with sound on, at a speed that keeps
 * sound. The pause fades it out like every other sound of the viewer (`stopAll`), and the resume
 * picks it up where it stopped, so a pause does not restart the loop from its head.
 *
 * WHERE IT GOES: a bus of its own on the player's master (`engineBus`), so the volume setting,
 * the mute, the distance chain and the recording faucet all apply without this file knowing them.
 * Absent from the out-of-real-time export: a clip carries the event sounds only.
 */
import { prepareAmbienceZones, ambienceLoopAt, type PreparedAmbience } from './ambienceZones'
import type { SoundListener } from './soundSpatial'
import type { ZoneReverbPlayer } from './zoneReverb'

/**
 * Unity: each loop's level is the game's own, the summed Wwise volume of its sound and every
 * container above it (the layout's `gains`, in dB; Streets' main bed -17 dB, Live Fire's -29 dB).
 * The output bus those containers feed is not read, so this is the one level still chosen here.
 */
export const AMBIENCE_BUS_GAIN = 1
/** Fades, in seconds: in slow enough to be felt as a room settling, out as short as a pause. */
export const AMBIENCE_FADE_IN_S = 0.8
export const AMBIENCE_FADE_OUT_S = 0.25
/** How long a new zone must hold the listener before the bed switches to it (doorway flapping). */
export const AMBIENCE_SWITCH_HOLD_S = 0.3
/** The zone switch: old voice down and new one up over this many seconds, overlapping. */
export const AMBIENCE_CROSSFADE_S = 1.5
/** Decoded loops kept in memory at once (a 78 s stereo loop decoded is ~30 MB). */
export const AMBIENCE_MAX_DECODED = 3

/** ambienceAudible says whether the bed sounds: playing, sound on, a speed that keeps sound. */
export function ambienceAudible(state: { on: boolean; playing: boolean; speedKeepsSound: boolean }): boolean {
  return state.on && state.playing && state.speedKeepsSound
}

/** bedOffsetS is where a loop of `durationS` stands after playing `playedS` from `fromS`. */
export function bedOffsetS(fromS: number, playedS: number, durationS: number): number {
  if (!(durationS > 0)) return 0
  const at = (fromS + Math.max(0, playedS)) % durationS
  return at < 0 ? 0 : at
}

/** What the beds need of the audio player: a context and the bus they play into. */
export interface AmbienceBus {
  ctx: Pick<BaseAudioContext, 'currentTime' | 'createGain' | 'createBufferSource' | 'createBuffer' | 'decodeAudioData'>
  out: AudioNode
}

/**
 * downmixToStereo — a quad Vorbis buffer (channel order FL, FR, RL, RR) into a new 2-channel
 * buffer: L = (FL + RL) / 2, R = (FR + RR) / 2. The caller drops the 4-channel buffer.
 */
function downmixToStereo(ctx: AmbienceBus['ctx'], quad: AudioBuffer): AudioBuffer {
  const out = ctx.createBuffer(2, quad.length, quad.sampleRate)
  const left = out.getChannelData(0)
  const right = out.getChannelData(1)
  const c0 = quad.getChannelData(0)
  const c1 = quad.getChannelData(1)
  const c2 = quad.getChannelData(2)
  const c3 = quad.getChannelData(3)
  for (let i = 0; i < left.length; i++) {
    left[i] = (c0[i] + c2[i]) / 2
    right[i] = (c1[i] + c3[i]) / 2
  }
  return out
}

/** A sounding voice of one loop. */
interface Voice {
  src: AudioBufferSourceNode
  gain: GainNode
  startedAt: number
}

/**
 * AmbienceZonesPlayer — plays the bed of the zone the listener stands in. A layout that does not
 * exist (404: library not built yet, or a map the game gives none) is a clean silence; so is a
 * loop whose file 404s. Nothing starts after `dispose`, a decode landing later included.
 */
export class AmbienceZonesPlayer {
  private readonly bus: AmbienceBus
  private readonly layoutUrl: string
  private readonly fileUrl: (file: string) => string
  private readonly fetcher: (url: string) => Promise<Response>
  private prepared: PreparedAmbience | null = null
  private files: Record<string, string> | null = null
  private gains: Record<string, number> = {}
  private target: string | null = null
  private candidate: string | null = null
  private candidateSince = 0
  private readonly buffers = new Map<string, AudioBuffer>()
  private readonly lastUsed = new Map<string, number>()
  private readonly offsets = new Map<string, number>()
  private readonly voices = new Map<string, Voice>()
  private readonly fading = new Set<string>()
  private readonly loading = new Set<string>()
  private audible = false
  private disposed = false
  /** The zone reverb rides on the beds' layout and listener (`zoneReverb.ts`); optional. */
  private readonly reverb: ZoneReverbPlayer | null

  constructor(
    bus: AmbienceBus,
    layoutUrl: string,
    fileUrl: (file: string) => string,
    fetcher: (url: string) => Promise<Response> = (u) => fetch(u),
    reverb: ZoneReverbPlayer | null = null,
  ) {
    this.bus = bus
    this.reverb = reverb
    this.layoutUrl = layoutUrl
    this.fileUrl = fileUrl
    this.fetcher = fetcher
    void this.loadLayout()
  }

  /** setListener tells where the listener stands (or that there is none, 2D view); cheap to call
   * every frame. A new zone must hold for `AMBIENCE_SWITCH_HOLD_S` before the bed switches. */
  setListener(pos: SoundListener | null): void {
    this.reverb?.setListener(pos)
    if (this.disposed || !this.prepared) return
    const want = ambienceLoopAt(this.prepared, pos)
    if (want === this.target) {
      this.candidate = null
      return
    }
    if (want !== this.candidate) {
      this.candidate = want
      this.candidateSince = this.bus.ctx.currentTime
    }
    if (this.bus.ctx.currentTime - this.candidateSince < AMBIENCE_SWITCH_HOLD_S) return
    this.target = want
    this.candidate = null
    this.ensureLoaded(want)
    if (this.audible && this.buffers.has(want)) this.crossfadeTo(want)
  }

  /** setAudible starts the bed (fade in) or stops it (fade out); cheap to call every frame. */
  setAudible(audible: boolean): void {
    this.audible = audible
    if (this.disposed) return
    if (audible) {
      const t = this.target
      if (t && this.buffers.has(t) && !this.voices.has(t)) this.startVoice(t, AMBIENCE_FADE_IN_S)
      else if (t && !this.buffers.has(t)) this.ensureLoaded(t) // its landing starts it
    } else {
      for (const [loop] of [...this.voices]) this.stopVoice(loop, AMBIENCE_FADE_OUT_S)
    }
  }

  /** dispose stops everything for good (unmount, another match). */
  dispose(): void {
    for (const [loop] of [...this.voices]) this.stopVoice(loop, AMBIENCE_FADE_OUT_S)
    this.reverb?.dispose()
    this.disposed = true
  }

  private async loadLayout(): Promise<void> {
    try {
      const res = await this.fetcher(this.layoutUrl)
      if (!res.ok) return // clean silence, as a map with no bed
      const body = (await res.json()) as unknown
      if (
        typeof body !== 'object' || body === null ||
        typeof (body as { fallback?: unknown }).fallback !== 'string' ||
        typeof (body as { files?: unknown }).files !== 'object' || (body as { files: unknown }).files === null ||
        !Array.isArray((body as { zones?: unknown }).zones)
      ) return // a bad body is a clean silence too
      const layout = body as Parameters<typeof prepareAmbienceZones>[0]
      if (this.disposed) return
      this.prepared = prepareAmbienceZones(layout)
      this.files = layout.files
      this.gains = layout.gains ?? {}
      this.reverb?.setLayout(layout)
      this.target = layout.fallback
      this.ensureLoaded(layout.fallback)
    } catch (err) {
      console.warn('replay 3D: ambience layout unavailable, silence:', this.layoutUrl, err)
    }
  }

  /** Fetch and decode a loop's file, once; a loop loads only when it becomes the target. */
  private ensureLoaded(loop: string): void {
    if (this.buffers.has(loop) || this.loading.has(loop)) return
    const file = this.files?.[loop]
    if (!file) return
    this.loading.add(loop)
    void this.loadLoop(loop, file)
  }

  private async loadLoop(loop: string, file: string): Promise<void> {
    try {
      const res = await this.fetcher(this.fileUrl(file))
      if (!res.ok) return // a missing file is a silence, not an error
      const raw = await this.bus.ctx.decodeAudioData(await res.arrayBuffer())
      const buf = raw.numberOfChannels === 4 ? downmixToStereo(this.bus.ctx, raw) : raw
      if (this.disposed) return
      this.ejectIfFull()
      this.buffers.set(loop, buf)
      this.touch(loop)
      if (this.audible && this.target === loop && !this.voices.has(loop)) this.crossfadeTo(loop)
    } catch (err) {
      console.warn('replay 3D: ambience loop unavailable, silence:', loop, err)
    } finally {
      this.loading.delete(loop)
    }
  }

  /** A new target lands: the sounding voice(s) fade out while the new one fades in. */
  private crossfadeTo(loop: string): void {
    for (const [other] of [...this.voices]) this.stopVoice(other, AMBIENCE_CROSSFADE_S)
    this.startVoice(loop, AMBIENCE_CROSSFADE_S)
  }

  private startVoice(loop: string, fadeInS: number): void {
    const buf = this.buffers.get(loop)
    if (!buf || this.voices.has(loop) || this.disposed) return
    const { ctx, out } = this.bus
    const t0 = ctx.currentTime
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(10 ** ((this.gains[loop] ?? 0) / 20), t0 + fadeInS)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    src.connect(gain)
    gain.connect(out)
    src.start(t0, this.offsets.get(loop) ?? 0)
    this.voices.set(loop, { src, gain, startedAt: t0 })
    this.fading.delete(loop)
    this.touch(loop)
  }

  private stopVoice(loop: string, fadeOutS: number): void {
    const v = this.voices.get(loop)
    if (!v) return
    this.voices.delete(loop)
    const t0 = this.bus.ctx.currentTime
    // The loop REMEMBERS where it stands, so coming back resumes it, not its head.
    this.offsets.set(loop, bedOffsetS(this.offsets.get(loop) ?? 0, t0 - v.startedAt, v.src.buffer?.duration ?? 0))
    v.gain.gain.cancelScheduledValues(t0)
    v.gain.gain.setValueAtTime(v.gain.gain.value, t0)
    v.gain.gain.linearRampToValueAtTime(0, t0 + fadeOutS)
    v.src.stop(t0 + fadeOutS)
    this.fading.add(loop)
    v.src.onended = () => {
      v.src.disconnect()
      v.gain.disconnect()
      this.fading.delete(loop)
    }
  }

  /** Keep at most `AMBIENCE_MAX_DECODED` decoded buffers: evict the least recently used one that
   * is not sounding (a fading-out voice still counts as sounding) and is not the current target
   * (paused, it sounds again on resume; a late landing of a former target must not cost it). */
  private ejectIfFull(): void {
    while (this.buffers.size >= AMBIENCE_MAX_DECODED) {
      let victim: string | null = null
      let victimAt = Infinity
      for (const [loop] of this.buffers) {
        if (this.voices.has(loop) || this.fading.has(loop) || loop === this.target) continue
        const at = this.lastUsed.get(loop) ?? 0
        if (at < victimAt) {
          victimAt = at
          victim = loop
        }
      }
      if (!victim) return // everything is sounding: no buffer to give up
      this.buffers.delete(victim)
      this.lastUsed.delete(victim)
    }
  }

  private touch(loop: string): void {
    this.lastUsed.set(loop, this.bus.ctx.currentTime)
  }
}
