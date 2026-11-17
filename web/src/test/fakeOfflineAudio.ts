// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * fakeOfflineAudio.ts — a small, sample-level `OfflineAudioContext` for the tests of the export's
 * mix render (jsdom has no Web Audio at all).
 *
 * It implements the subset the render uses, with real signal processing: buffer sources (loop,
 * offset, playback rate, start and stop), gains with their automation (set, linear ramp, value
 * curve), the stereo panner (mono law), the low-pass biquad (the spec's coefficients, state kept
 * across quanta), buffers, connect and disconnect, and `suspend`/`resume` on render quanta. The
 * graph is pulled quantum by quantum from the destination, as a real engine does, and every node
 * processed for a quantum is counted (`renderCost`), so a test can measure how a render scales.
 *
 * Timing is in FRAMES, as in the engines: every time handed to the context becomes the frame
 * position `time * sampleRate`; a source plays from the first frame at or after its start, its
 * playhead `(frame - start) * rate` interpolated linearly (sub-sample accurate), and an automation
 * event applies from the first frame at or after it. A time moved by a rounding error across a
 * frame therefore shows, as it would in a browser.
 *
 * `dryRun` skips the per-sample work and keeps the counting: the cost tests use it on long tracks.
 */
const QUANTUM = 128

/** Counters shared by every fake context, reset by the tests. */
export const fakeAudioStats = { renderCost: 0, contexts: 0, dryRun: false }

export function resetFakeAudioStats(dryRun = false): void {
  fakeAudioStats.renderCost = 0
  fakeAudioStats.contexts = 0
  fakeAudioStats.dryRun = dryRun
}

export class FakeAudioBuffer {
  readonly numberOfChannels: number
  readonly length: number
  readonly sampleRate: number
  private readonly channels: Float32Array[]
  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels
    this.length = length
    this.sampleRate = sampleRate
    this.channels = Array.from({ length: channels }, () => new Float32Array(length))
  }
  get duration(): number {
    return this.length / this.sampleRate
  }
  getChannelData(c: number): Float32Array {
    return this.channels[c]
  }
}

type Event =
  | { kind: 'set'; time: number; value: number }
  | { kind: 'linear'; time: number; value: number }
  | { kind: 'curve'; time: number; duration: number; curve: Float32Array }

class FakeParam {
  private initial: number
  private events: Event[] = []
  constructor(value: number) {
    this.initial = value
  }
  get value(): number {
    return this.initial
  }
  set value(v: number) {
    this.initial = Math.fround(v)
  }
  setValueAtTime(value: number, time: number): this {
    return this.add({ kind: 'set', time, value })
  }
  linearRampToValueAtTime(value: number, time: number): this {
    return this.add({ kind: 'linear', time, value })
  }
  setValueCurveAtTime(curve: Float32Array, time: number, duration: number): this {
    return this.add({ kind: 'curve', time, duration, curve: Float32Array.from(curve) })
  }
  private add(e: Event): this {
    this.events.push(e)
    // Stable: two events at one time keep their call order.
    this.events.sort((a, b) => a.time - b.time)
    return this
  }
  get automated(): boolean {
    return this.events.length > 0
  }
  /**
   * The value at frame `t`, by the spec's rules for these three event kinds. Every event time is
   * turned into a frame position (`time * sampleRate`), as the engines do.
   */
  at(t: number, sampleRate: number): number {
    let v = this.initial
    let prevT = 0
    for (const e of this.events) {
      const et = e.time * sampleRate
      if (e.kind === 'set') {
        if (et > t) break
        v = e.value
        prevT = et
      } else if (e.kind === 'linear') {
        if (et <= t) {
          v = e.value
          prevT = et
          continue
        }
        if (t >= prevT && et > prevT) v = v + ((e.value - v) * (t - prevT)) / (et - prevT)
        break
      } else {
        if (t < et) break
        const n = e.curve.length
        const dur = e.duration * sampleRate
        if (t >= et + dur) {
          v = e.curve[n - 1]
          prevT = et + dur
          continue
        }
        const pos = ((n - 1) * (t - et)) / dur
        const k = Math.floor(pos)
        v = e.curve[k] + (e.curve[Math.min(k + 1, n - 1)] - e.curve[k]) * (pos - k)
        break
      }
    }
    return v
  }
}

type Block = [Float32Array, Float32Array]

abstract class FakeNode {
  readonly inputs = new Set<FakeNode>()
  private readonly outputs = new Set<FakeNode>()
  private memoQ = -1
  private memo: Block | null = null
  readonly context: FakeOfflineAudioContext
  constructor(context: FakeOfflineAudioContext) {
    this.context = context
  }
  connect<T extends FakeNode>(dest: T): T {
    dest.inputs.add(this)
    this.outputs.add(dest)
    return dest
  }
  disconnect(): void {
    for (const o of this.outputs) o.inputs.delete(this)
    this.outputs.clear()
  }
  pull(q: number): Block {
    if (this.memoQ === q && this.memo) return this.memo
    fakeAudioStats.renderCost++
    const out: Block = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)]
    if (!fakeAudioStats.dryRun) this.process(q, out)
    else for (const i of this.inputs) i.pull(q)
    this.memoQ = q
    this.memo = out
    return out
  }
  protected mixInputs(q: number): Block {
    const sum: Block = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)]
    for (const i of this.inputs) {
      const b = i.pull(q)
      for (let c = 0; c < 2; c++) for (let f = 0; f < QUANTUM; f++) sum[c][f] += b[c][f]
    }
    return sum
  }
  protected frameOf(q: number, f: number): number {
    return q * QUANTUM + f
  }
  protected abstract process(q: number, out: Block): void
}

class FakeDestination extends FakeNode {
  protected process(q: number, out: Block): void {
    const s = this.mixInputs(q)
    out[0].set(s[0])
    out[1].set(s[1])
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1)
  protected process(q: number, out: Block): void {
    const s = this.mixInputs(q)
    for (let f = 0; f < QUANTUM; f++) {
      const g = this.gain.automated ? this.gain.at(this.frameOf(q, f), this.context.sampleRate) : this.gain.value
      out[0][f] = s[0][f] * g
      out[1][f] = s[1][f] * g
    }
  }
}

class FakePanner extends FakeNode {
  readonly pan = new FakeParam(0)
  protected process(q: number, out: Block): void {
    const s = this.mixInputs(q)
    // The spec's law for a MONO input (the sources are mono): equal power on the left channel.
    const x = (this.pan.value + 1) / 2
    const gl = Math.cos((x * Math.PI) / 2)
    const gr = Math.sin((x * Math.PI) / 2)
    for (let f = 0; f < QUANTUM; f++) {
      out[0][f] = s[0][f] * gl
      out[1][f] = s[0][f] * gr
    }
  }
}

class FakeBiquad extends FakeNode {
  type = 'lowpass'
  readonly frequency = new FakeParam(350)
  readonly Q = new FakeParam(1)
  private state = [new Float64Array(4), new Float64Array(4)]
  protected process(q: number, out: Block): void {
    const s = this.mixInputs(q)
    const w0 = (2 * Math.PI * this.frequency.value) / this.context.sampleRate
    const alpha = Math.sin(w0) / (2 * Math.pow(10, this.Q.value / 20))
    const cos = Math.cos(w0)
    const a0 = 1 + alpha
    const b0 = (1 - cos) / 2 / a0
    const b1 = (1 - cos) / a0
    const b2 = b0
    const a1 = (-2 * cos) / a0
    const a2 = (1 - alpha) / a0
    for (let c = 0; c < 2; c++) {
      const st = this.state[c]
      for (let f = 0; f < QUANTUM; f++) {
        const x = s[c][f]
        const y = b0 * x + b1 * st[0] + b2 * st[1] - a1 * st[2] - a2 * st[3]
        st[1] = st[0]
        st[0] = x
        st[3] = st[2]
        st[2] = y
        out[c][f] = y
      }
    }
  }
}

class FakeBufferSource extends FakeNode {
  buffer: FakeAudioBuffer | null = null
  loop = false
  readonly playbackRate = new FakeParam(1)
  private when: number | null = null
  private offset = 0
  private stopAt = Infinity
  start(when = 0, offset = 0): void {
    this.when = when
    this.offset = offset
  }
  stop(when = 0): void {
    this.stopAt = when
  }
  protected process(q: number, out: Block): void {
    const buf = this.buffer
    if (!buf || this.when === null) return
    const sr = this.context.sampleRate
    const rate = this.playbackRate.value
    // Frame positions, as the engines compute them; the start is sub-sample accurate.
    const startF = this.when * sr
    const stopF = this.stopAt * sr
    for (let f = 0; f < QUANTUM; f++) {
      const t = this.frameOf(q, f)
      if (t < startF || t >= stopF) continue
      const pos = this.offset * buf.sampleRate + (t - startF) * rate
      for (let c = 0; c < 2; c++) out[c][f] = this.sample(buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)), pos)
    }
  }
  /** Linear interpolation; zero before the start, zero (or wrapped, when looping) after the end. */
  private sample(data: Float32Array, pos: number): number {
    const n = data.length
    let p = pos
    if (this.loop && p >= 0) p = p % n
    const k = Math.floor(p)
    const frac = p - k
    const get = (i: number) => {
      if (i < 0) return 0
      if (i >= n) return this.loop ? data[i % n] : 0
      return data[i]
    }
    return get(k) * (1 - frac) + get(k + 1) * frac
  }
}

export class FakeOfflineAudioContext {
  readonly sampleRate: number
  readonly length: number
  readonly numberOfChannels: number
  readonly destination: FakeDestination
  currentTime = 0
  private stops = new Map<number, () => void>()
  private resumeNext: (() => void) | null = null
  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels
    this.length = length
    this.sampleRate = sampleRate
    this.destination = new FakeDestination(this)
    fakeAudioStats.contexts++
  }
  createGain(): FakeGain {
    return new FakeGain(this)
  }
  createStereoPanner(): FakePanner {
    return new FakePanner(this)
  }
  createBiquadFilter(): FakeBiquad {
    return new FakeBiquad(this)
  }
  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this)
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(channels, length, sampleRate)
  }
  /** Suspends at the quantum that holds `t`, as the spec rounds it. */
  suspend(t: number): Promise<void> {
    const q = Math.floor((t * this.sampleRate) / QUANTUM)
    return new Promise((resolve) => this.stops.set(q, resolve))
  }
  resume(): Promise<void> {
    this.resumeNext?.()
    return Promise.resolve()
  }
  async startRendering(): Promise<FakeAudioBuffer> {
    const out = new FakeAudioBuffer(this.numberOfChannels, this.length, this.sampleRate)
    const quanta = Math.ceil(this.length / QUANTUM)
    for (let q = 0; q < quanta; q++) {
      const stop = this.stops.get(q)
      if (stop) {
        this.stops.delete(q)
        this.currentTime = (q * QUANTUM) / this.sampleRate
        await new Promise<void>((resume) => {
          this.resumeNext = resume
          stop()
        })
      }
      const b = this.destination.pull(q)
      const n = Math.min(QUANTUM, this.length - q * QUANTUM)
      for (let c = 0; c < this.numberOfChannels; c++) out.getChannelData(c).set(b[c].subarray(0, n), q * QUANTUM)
    }
    this.currentTime = this.length / this.sampleRate
    return out
  }
}

/** The same context without `suspend`: Firefox's shape, for the feature detection. */
export class FakeOfflineAudioContextNoSuspend extends FakeOfflineAudioContext {}
Object.defineProperty(FakeOfflineAudioContextNoSuspend.prototype, 'suspend', { value: undefined })
