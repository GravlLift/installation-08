// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * fakeAudio.ts — THE Web Audio double for replay tests, shared (same pattern as testDoc.ts).
 *
 * jsdom implements neither AudioContext nor decoding: without a double, nothing in the
 * audio chain is testable. This one doesn't simulate sound — it RECORDS what it's asked
 * to do (sources started, envelopes scheduled, stops), which is exactly what breaks
 * silently. The actual rendering is judged by ear, never here.
 *
 * Two tests use it (engine and wiring): it lives in a single place as of the second
 * copy, before they diverge.
 */
import { vi } from 'vitest'

/** A gain parameter that records the envelope programmed into it. */
export class FakeParam {
  value = 1
  calls: Array<[string, number, number]> = []
  setValueAtTime(v: number, t: number) { this.calls.push(['set', v, t]); this.value = v }
  linearRampToValueAtTime(v: number, t: number) { this.calls.push(['ramp', v, t]) }
  cancelScheduledValues(t: number) { this.calls.push(['cancel', 0, t]) }
}

/**
 * FakeGain records WHAT it's connected to as of 2026-08-26 (recording tap): the question
 * "does the clip's sound come out of the same place as the speakers' sound?" can't be
 * answered any other way, and it would break silently — a muted clip throws no error.
 */
export class FakeGain {
  gain = new FakeParam()
  /** Connections RECORDED (recording tap, 2026-08-26): a clip connected to the wrong
   *  place is silent, and that breaks silently — nothing else answers the question. */
  connections: unknown[] = []
  connect(dest?: unknown) { this.connections.push(dest) }
  disconnect() { this.connections.length = 0 }
}

/**
 * The stereo panner for spatialization: it carries a side (`pan`) and records its
 * connections like the gain node — this is what lets us verify that a panned sound
 * goes through it, and that a centered sound doesn't create one.
 */
export class FakeStereoPanner {
  pan = { value: 0 }
  connections: unknown[] = []
  connect(dest?: unknown) { this.connections.push(dest) }
  disconnect() { this.connections.length = 0 }
}

/** The low-pass filter of the distance chain; it records its connections like the gain. */
export class FakeFilter {
  type = ''
  frequency = new FakeParam()
  connections: unknown[] = []
  connect(dest?: unknown) { this.connections.push(dest) }
  disconnect() { this.connections.length = 0 }
}

/** The recording tap: an output node that exposes an audio track. */
export class FakeStreamDestination {
  track = { kind: 'audio' } as unknown as MediaStreamTrack
  stream = { getAudioTracks: () => [this.track] }
}

export class FakeSource {
  buffer: AudioBuffer | null = null
  onended: (() => void) | null = null
  started: number | null = null
  stopped: number | null = null
  /** The PLAYBACK RATE, carried as an AudioParam by real WebAudio (`.value`):
   *  this is what carries a shot's pitch variation (weaponSoundLogic). */
  playbackRate = new FakeParam()
  connect() {}
  disconnect() {}
  /** The OFFSET into the buffer at start (`start(t, offset)`), 0 when omitted. */
  offset = 0
  start(t: number, offset = 0) { this.started = t; this.offset = offset }
  stop(t: number) { this.stopped = t }
  /** Natural end of the source: normally called by the browser, here by the test. */
  end() { this.onended?.() }
}

export class FakeContext {
  currentTime = 10
  destination = {}
  gains: FakeGain[] = []
  panners: FakeStereoPanner[] = []
  sources: FakeSource[] = []
  filters: FakeFilter[] = []
  streamDests: FakeStreamDestination[] = []
  resumed = 0
  closed = 0
  createGain() { const g = new FakeGain(); this.gains.push(g); return g }
  createStereoPanner() { const p = new FakeStereoPanner(); this.panners.push(p); return p }
  createBiquadFilter() { const f = new FakeFilter(); this.filters.push(f); return f }
  createMediaStreamDestination() {
    const d = new FakeStreamDestination()
    this.streamDests.push(d)
    return d
  }
  createBufferSource() { const s = new FakeSource(); this.sources.push(s); return s }
  decodeAudioData(raw: ArrayBuffer) {
    // The buffer's "duration" is encoded in the buffer's size (1 byte = 0.1 s): this lets
    // the test pick long or short sounds without shipping a real sound file.
    return Promise.resolve({ duration: raw.byteLength / 10 } as AudioBuffer)
  }
  close() { this.closed++; return Promise.resolve() }
  resume() { this.resumed++; return Promise.resolve() }
}

/** A successful `fetch` response carrying a buffer that "lasts" `seconds`. */
export function okAudioResponse(seconds: number) {
  return { ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(Math.round(seconds * 10))) }
}

/**
 * installFakeAudio replaces AudioContext and fetch for the duration of a test. Call it
 * in a `beforeEach`, undo it with `vi.unstubAllGlobals()`.
 */
export function installFakeAudio(seconds = 3): {
  ctx: FakeContext
  fetchMock: ReturnType<typeof vi.fn>
} {
  const ctx = new FakeContext()
  // `new AudioContext()` must return OUR double: a constructor function that returns
  // an object ignores the new instance and serves that one instead (vi.fn() isn't constructible).
  vi.stubGlobal('AudioContext', function AudioContextDouble() { return ctx })
  const fetchMock = vi.fn(() => Promise.resolve(okAudioResponse(seconds)))
  vi.stubGlobal('fetch', fetchMock)
  return { ctx, fetchMock }
}

/** Lets loading/decoding promises resolve. */
export const flushAudio = () => new Promise((r) => setTimeout(r, 0))
