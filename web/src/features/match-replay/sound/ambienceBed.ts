/**
 * ambienceBed.ts — THE MAP'S AMBIENT BED ("room tone"): one long loop the game authors per
 * acoustic zone of the map, played quietly under the replay so the scene never goes dead silent.
 *
 * WHAT IT IS. The server extracts, per map, the background sound of the zone the map's level
 * palette uses most (`internal/ambience`): a quad Wwise Vorbis loop of 8 to 78 s, written to
 * repeat end to end, served for a match at `/api/matches/<id>/ambience.ogg`. The game switches
 * beds as the camera moves between zones and adds positional emitters on top; this player is the
 * first step: ONE non-positional bed for the whole map (Web Audio downmixes the quad to stereo).
 *
 * WHEN IT SOUNDS (`ambienceAudible`): while the replay PLAYS, with sound on, at a speed that keeps
 * sound. The pause fades it out like every other sound of the viewer (`stopAll`), and the resume
 * picks it up where it stopped, so a pause does not restart the loop from its head.
 *
 * WHERE IT GOES: a bus of its own on the player's master (`engineBus`), so the volume setting,
 * the mute, the distance chain and the recording faucet all apply without this file knowing them.
 * Absent from the out-of-real-time export: a clip carries the event sounds only.
 */

/** The bed's level under the master: quiet, a floor under the action, never a layer over it. */
export const AMBIENCE_BUS_GAIN = 0.35
/** Fades, in seconds: in slow enough to be felt as a room settling, out as short as a pause. */
export const AMBIENCE_FADE_IN_S = 0.8
export const AMBIENCE_FADE_OUT_S = 0.25

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

/** What the bed needs of the audio player: a context and the bus it plays into. */
export interface AmbienceBus {
  ctx: Pick<BaseAudioContext, 'currentTime' | 'createGain' | 'createBufferSource' | 'decodeAudioData'>
  out: AudioNode
}

/**
 * AmbienceBedPlayer — loads one bed and loops it while asked to be audible. A bed that does not
 * exist (404: library not built yet, or a map the game gives none) is a clean silence.
 */
export class AmbienceBedPlayer {
  private buffer: AudioBuffer | null | undefined = undefined
  private voice: { src: AudioBufferSourceNode; gain: GainNode; startedAt: number } | null = null
  private offsetS = 0
  private audible = false
  private disposed = false
  private readonly bus: AmbienceBus

  constructor(bus: AmbienceBus, url: string, fetcher: (url: string) => Promise<Response> = (u) => fetch(u)) {
    this.bus = bus
    void this.load(url, fetcher)
  }

  private async load(url: string, fetcher: (url: string) => Promise<Response>): Promise<void> {
    try {
      const res = await fetcher(url)
      if (!res.ok) {
        this.buffer = null
        return
      }
      const buf = await this.bus.ctx.decodeAudioData(await res.arrayBuffer())
      this.buffer = buf
      if (this.audible && !this.disposed) this.start()
    } catch (err) {
      console.warn('replay 3D: ambience unavailable, silence:', url, err)
      this.buffer = null
    }
  }

  /** Is the bed decoded and ready to loop? */
  get loaded(): boolean {
    return !!this.buffer
  }

  /** setAudible starts the loop (fade in) or stops it (fade out); cheap to call every frame. */
  setAudible(audible: boolean): void {
    this.audible = audible
    if (this.disposed) return
    if (audible && !this.voice) this.start()
    else if (!audible && this.voice) this.stop()
  }

  private start(): void {
    const buf = this.buffer
    if (!buf) return
    const { ctx, out } = this.bus
    const t0 = ctx.currentTime
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(1, t0 + AMBIENCE_FADE_IN_S)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    src.connect(gain)
    gain.connect(out)
    src.start(t0, this.offsetS)
    this.voice = { src, gain, startedAt: t0 }
  }

  private stop(): void {
    const v = this.voice
    if (!v) return
    this.voice = null
    const t0 = this.bus.ctx.currentTime
    this.offsetS = bedOffsetS(this.offsetS, t0 - v.startedAt, this.buffer?.duration ?? 0)
    v.gain.gain.cancelScheduledValues(t0)
    v.gain.gain.setValueAtTime(v.gain.gain.value, t0)
    v.gain.gain.linearRampToValueAtTime(0, t0 + AMBIENCE_FADE_OUT_S)
    v.src.stop(t0 + AMBIENCE_FADE_OUT_S)
    v.src.onended = () => {
      v.src.disconnect()
      v.gain.disconnect()
    }
  }

  /** dispose stops the loop for good (unmount, another map). */
  dispose(): void {
    this.stop()
    this.disposed = true
  }
}
