// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * zoneReverb.ts — THE MAP'S ZONE REVERB: each acoustic zone names a sound environment, and the
 * game convolves the world's sounds with that environment's impulse response while the listener
 * stands in the zone.
 *
 * WHAT IT PLAYS. The server (`internal/ambience/reverb.go`) reads, per sound environment, the
 * game's convolution reverb (its wet level and the energy of its impulse response in time and
 * frequency) and synthesizes a stereo impulse response with that energy and random phases, served
 * as a 48 kHz float WAV next to the beds. The game's exact recording is not recovered; its decay,
 * color and level are. A map shares four or so environments across all its zones.
 *
 * THE RULE: the same smallest-containing-zone lookup as the beds (`ambienceZones.ts`), over the
 * zones that name an environment; `fallbackReverb` where none holds the listener or there is none
 * (2D view). A new environment must hold `REVERB_SWITCH_HOLD_S` (doorways), then the send into the
 * old convolver ramps down and the new one up over `REVERB_CROSSFADE_S`: the old room's tail rings
 * out on its own, as it would.
 *
 * THE WIRING: the player's reverb send (`ReplayAudioPlayer.reverbBus`) -> one input gain per
 * environment -> its ConvolverNode (normalize OFF: the response carries the game's level) -> the
 * wet level -> the master. Every environment's response loads with the layout (a few hundred KB
 * each), so a switch never waits on the network. Not in the out-of-real-time export.
 */
import { ambienceLoopAt, prepareReverbZones, type AmbienceLayout, type PreparedAmbience } from './ambienceZones'
import type { SoundListener } from './soundSpatial'

/** The one level still chosen here, by ear (Jordan, 0.1.1-test.5: "slightly loud"): 3 dB under
 * the game's own chain (impulse response level x wet level), for a sound sending at the
 * reference below. The reverb bus's own volume is not read. */
export const REVERB_SEND_DB = -3

/**
 * THE SEND A SOUND'S OWN SEND IS MEASURED FROM. The game gives each sound a game-defined aux send
 * (node property 0x17, summed along its node chain, `wwise.MediaMix.GameAuxSendDB`), falling
 * with distance on the same curve as its volume (curve use 1 of its attenuation is curve 0 on
 * the shots and foot steps probed). Those sends are large and positive on world sounds (median
 * +20 dB over the 3439 foot step, movement and shot takes extracted 2026-11-19, quartiles +18
 * and +24), so the game's reverb bus is quiet and they only make sense against each other: a
 * sound sending at +20 keeps the level tuned above, one at +23 is 3 dB wetter, the shooter's own
 * shot (-60) is dry. A sound without data sends at the reference.
 */
export const REVERB_SEND_REFERENCE_DB = 20

/**
 * DRY: a sound whose node chain switches the game-defined aux sends OFF, so it never reaches the
 * zone reverb whatever its 0x17 sum says. Read 2026-11-19 from the aux bits after each node's
 * property bundles (bit 0 overrides the parent, bit 1 uses the game-defined sends; the layout is
 * inferred from the Wwise v135 format, and consistent across every chain probed): the
 * third-person Bandit layers turn them on (`21352ab8`, 0x03); the first-person shot's take, thump
 * and click never do (the top actor-mixer `280705ab` leaves them off and nothing below turns them
 * on); the followed player's shield sounds have them overridden off (`12e5d734`, 0x01).
 */
export const DRY_SEND_DB = -Infinity

/** reverbSendOf — the linear send of a sound into the zone reverb, against its dry level; 0 when inaudible. */
export function reverbSendOf(reverbDb: number | undefined): number {
  if (reverbDb === undefined) return 1
  const g = 10 ** ((reverbDb - REVERB_SEND_REFERENCE_DB) / 20)
  return g < 1e-4 ? 0 : g
}
/** How long a new environment must hold the listener before the reverb switches (doorways). */
export const REVERB_SWITCH_HOLD_S = 0.3
/** The switch: send into the old convolver down and into the new one up over this many seconds. */
export const REVERB_CROSSFADE_S = 0.5

/** What the reverb needs of the audio player: a context, the send to listen on, the bus to return into. */
export interface ReverbBus {
  ctx: Pick<BaseAudioContext, 'currentTime' | 'createGain' | 'createConvolver' | 'decodeAudioData'>
  send: AudioNode
  out: AudioNode
}

interface Room {
  input: GainNode
  conv: ConvolverNode
  wet: GainNode
}

/**
 * ZoneReverbPlayer — follows the listener from environment to environment. A layout without
 * reverbs, or a response file that fails, leaves that room dry; nothing starts after `dispose`.
 */
export class ZoneReverbPlayer {
  private readonly bus: ReverbBus
  private readonly fileUrl: (file: string) => string
  private readonly fetcher: (url: string) => Promise<Response>
  private prepared: PreparedAmbience | null = null
  private readonly rooms = new Map<string, Room>()
  private target = ''
  private candidate: string | null = null
  private candidateSince = 0
  private disposed = false

  constructor(bus: ReverbBus, fileUrl: (file: string) => string, fetcher: (url: string) => Promise<Response> = (u) => fetch(u)) {
    this.bus = bus
    this.fileUrl = fileUrl
    this.fetcher = fetcher
  }

  /** setLayout takes the match's layout (once, from the beds' load) and loads every response. */
  setLayout(layout: AmbienceLayout): void {
    if (this.disposed || !layout.reverbs) return
    this.prepared = prepareReverbZones(layout)
    this.target = this.prepared.fallback
    for (const [id, r] of Object.entries(layout.reverbs)) void this.loadRoom(id, r.file, r.wetDb)
  }

  /** setListener tells where the listener stands (or that there is none); cheap every frame. */
  setListener(pos: SoundListener | null): void {
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
    if (this.bus.ctx.currentTime - this.candidateSince < REVERB_SWITCH_HOLD_S) return
    const from = this.target
    this.target = want
    this.candidate = null
    this.ramp(from, 0)
    this.ramp(want, 1)
  }

  /** The room the listener is in now ('' when dry); for tests and the HUD's diagnostics. */
  current(): string {
    return this.target
  }

  /** dispose unhooks every room for good (unmount, another match). */
  dispose(): void {
    this.disposed = true
    for (const room of this.rooms.values()) {
      room.input.disconnect()
      room.conv.disconnect()
      room.wet.disconnect()
    }
    this.rooms.clear()
  }

  private async loadRoom(id: string, file: string, wetDb: number): Promise<void> {
    try {
      const res = await this.fetcher(this.fileUrl(file))
      if (!res.ok) return // a missing response leaves the room dry
      const buf = await this.bus.ctx.decodeAudioData(await res.arrayBuffer())
      if (this.disposed) return
      const { ctx, send, out } = this.bus
      const input = ctx.createGain()
      input.gain.value = 0
      const conv = ctx.createConvolver()
      conv.normalize = false
      conv.buffer = buf
      const wet = ctx.createGain()
      wet.gain.value = 10 ** ((wetDb + REVERB_SEND_DB) / 20)
      send.connect(input)
      input.connect(conv)
      conv.connect(wet)
      wet.connect(out)
      this.rooms.set(id, { input, conv, wet })
      if (id === this.target) this.ramp(id, 1)
    } catch (err) {
      console.warn('replay 3D: zone reverb unavailable, dry:', id, err)
    }
  }

  private ramp(id: string, to: number): void {
    const room = this.rooms.get(id)
    if (!room) return
    const t0 = this.bus.ctx.currentTime
    const g = room.input.gain
    g.cancelScheduledValues(t0)
    g.setValueAtTime(g.value, t0)
    g.linearRampToValueAtTime(to, t0 + REVERB_CROSSFADE_S)
  }
}
