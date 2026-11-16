/**
 * soundLatencyHarness.ts — a clocked Web Audio double for MEASURING the live sound path.
 *
 * `fakeAudio.ts` notes what is asked of a context frozen in time; this one runs a SIMULATED
 * clock shared by the audio context (`currentTime`) and the page (`performance.now`), so a
 * test can drive the real replay sound hook with the beat of a slow main thread and read, for
 * every source, the moment it was asked to start against the moment its event sits on the
 * replay clock. It also notes when every node is created and released, for the voice and node
 * counts, and dispatches `onended` the way a browser does: only when the main thread is free.
 *
 * Nothing here judges the sound itself; it measures timing and load.
 */

/** The simulated clock, in milliseconds of page time. */
export class SimClock {
  nowMs = 0
}

/** An AudioParam double that keeps the last value set (enough for the gain bookkeeping). */
class SimParam {
  value = 1
  setValueAtTime(v: number) { this.value = v }
  linearRampToValueAtTime() {}
  setValueCurveAtTime() {}
  cancelScheduledValues() {}
}

/** A node double that notes its creation and release times (page ms). */
class SimNode {
  readonly createdMs: number
  releasedMs: number | null = null
  private readonly clock: SimClock
  constructor(clock: SimClock) {
    this.clock = clock
    this.createdMs = clock.nowMs
  }
  connect() {}
  disconnect() {
    if (this.releasedMs === null) this.releasedMs = this.clock.nowMs
  }
}

class SimGain extends SimNode {
  gain = new SimParam()
}

class SimPanner extends SimNode {
  pan = { value: 0 }
}

class SimFilter extends SimNode {
  type = ''
  frequency = new SimParam()
}

/** A decoded buffer double: its duration, and the URL it was fetched from. */
export interface SimBuffer {
  duration: number
  url: string
}

export class SimSource extends SimNode {
  buffer: SimBuffer | null = null
  loop = false
  onended: (() => void) | null = null
  /** Requested start, in context seconds. */
  started: number | null = null
  /** Requested stop, in context seconds (the latest call wins, as in Web Audio). */
  stopped: number | null = null
  ended = false
  playbackRate = new SimParam()
  start(t: number) { this.started = t }
  stop(t: number) { this.stopped = t }
}

/** The context's time origin: `currentTime` = (page ms - origin) / 1000. */
export const SIM_CONTEXT_ORIGIN_MS = -10_000

export class SimContext {
  destination = {}
  sources: SimSource[] = []
  nodes: SimNode[] = []
  readonly clock: SimClock
  constructor(clock: SimClock) {
    this.clock = clock
  }
  get currentTime(): number {
    return (this.clock.nowMs - SIM_CONTEXT_ORIGIN_MS) / 1000
  }
  private track<T extends SimNode>(n: T): T {
    this.nodes.push(n)
    return n
  }
  createGain() { return this.track(new SimGain(this.clock)) }
  createStereoPanner() { return this.track(new SimPanner(this.clock)) }
  createBiquadFilter() { return this.track(new SimFilter(this.clock)) }
  createMediaStreamDestination() { return { stream: { getAudioTracks: () => [] } } }
  createBufferSource() {
    const s = this.track(new SimSource(this.clock))
    this.sources.push(s)
    return s
  }
  decodeAudioData(raw: ArrayBuffer & { url?: string; seconds?: number }) {
    return Promise.resolve({ duration: raw.seconds ?? 0, url: raw.url ?? '' } as SimBuffer)
  }
  resume() { return Promise.resolve() }
  close() { return Promise.resolve() }
  /**
   * The browser's side of a source's end: once its stop time has passed, `onended` is QUEUED,
   * and it runs only when the main thread is free — the harness calls this at each beat.
   */
  dispatchEnded(): void {
    const t = this.currentTime
    for (const s of this.sources) {
      if (s.ended || s.started === null) continue
      const end = s.stopped ?? Number.POSITIVE_INFINITY
      if (end <= t) {
        s.ended = true
        s.onended?.()
      }
    }
  }
}

/** pageMsOf — a context time (seconds) on the page clock (ms). */
export function pageMsOf(contextSeconds: number): number {
  return contextSeconds * 1000 + SIM_CONTEXT_ORIGIN_MS
}

/** A seeded uniform generator (mulberry32), so two runs measure the same beat. */
export function simRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (a >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** quantile of a sorted array (nearest rank). */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[i]
}

/** opusDurationSeconds — the duration of an Ogg Opus file from its last page's granule. */
export function opusDurationSeconds(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const findLast = (tag: string): number => {
    outer: for (let i = bytes.length - tag.length; i >= 0; i--) {
      for (let k = 0; k < tag.length; k++) if (bytes[i + k] !== tag.charCodeAt(k)) continue outer
      return i
    }
    return -1
  }
  const findFirst = (tag: string): number => {
    outer: for (let i = 0; i + tag.length <= bytes.length; i++) {
      for (let k = 0; k < tag.length; k++) if (bytes[i + k] !== tag.charCodeAt(k)) continue outer
      return i
    }
    return -1
  }
  const last = findLast('OggS')
  if (last < 0) return null
  const granule = Number(view.getBigInt64(last + 6, true))
  const opus = findFirst('OpusHead')
  if (opus >= 0) return Math.max(0, granule - view.getUint16(opus + 10, true)) / 48_000
  // Vorbis: the identification header carries the sample rate after version (4) and channels (1).
  const vorbis = findFirst('vorbis')
  if (vorbis < 0) return null
  const rate = view.getUint32(vorbis + 6 + 4 + 1, true)
  return rate > 0 ? granule / rate : null
}
