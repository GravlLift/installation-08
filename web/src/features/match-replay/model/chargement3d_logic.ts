// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * chargement3d_logic.ts — the loading progress of the 3D scene, one honest bar for the whole load.
 *
 * The load runs in phases of very different cost: the downloads of the map GLB and of the match's
 * variant GLB (Forge objects, up to ~200 MB), the decode of the map's images, the ray index (BVH),
 * the variant's own build (server side) and preparation, the players' and weapons' models, the
 * shader compilation, and the first drawn frame. Each phase carries a weight in estimated seconds
 * (bytes times a per-MB cost for the GLB phases, a fixed cost for the others) and its own
 * `done / total`; the bar is the weighted sum.
 *
 * The weights change while the load runs (a GLB's size is known only once its response arrives,
 * the variant may turn out absent): on each change the remaining raw progress is mapped onto the
 * remaining bar (`rebase`), so the bar never jumps backward and never stalls waiting for the new
 * weights to catch up. It reaches 1 only when every phase is complete.
 */

/** The phases, in the order the label reports them (the first one not complete is shown). */
export const LOAD_PHASES_3D = [
  'download',
  'decode',
  'index',
  'variant-build',
  'variant-prepare',
  'assets',
  'warmup',
  'first-frame',
] as const
export type LoadPhase3d = (typeof LOAD_PHASES_3D)[number]

/**
 * The scene's load state. `loading` carries the overall fraction (0..1, monotonic) and the phase
 * the label names, with that phase's own count (`download`: bytes of both GLBs; `decode`: images;
 * `index`: geometries; `assets`: models; 0 / 0 when the phase has no count).
 */
export type LoadState =
  | { kind: 'loading'; fraction: number; phase: LoadPhase3d; done: number; total: number }
  | { kind: 'ready' }
  /** `stalled`: the phase the load sat in with no progress at all (`checkStall`), when that is why it failed. */
  | { kind: 'error'; stalled?: LoadPhase3d }

/**
 * How long the load may go without any progress report before it is declared stuck. Every phase
 * but the server's variant build reports steadily (bytes, images, geometries, models), so two
 * minutes of silence means something will never answer: test.18/test.19's broken meshopt worker
 * left every match on "Decoding materials" forever, with no error anywhere. Three minutes, not
 * two: the shader warmup reports nothing until it ends, and a weak GPU compiles slowly; a false
 * alarm would kill a load that was about to finish.
 */
export const LOAD_STALL_MS = 180_000

const MB = 1024 * 1024

/** Estimated costs, in seconds (per MB of GLB for the GLB phases). Calibrate from the
 *  `report()` timings the view logs at the end of each load. */
export const LOAD_COSTS_3D = {
  downloadPerMb: 0.004,
  decodePerMb: 0.01,
  indexPerMb: 0.006,
  variantPreparePerMb: 0.02,
  variantBuild: 15,
  assets: 1.5,
  warmup: 2.5,
  firstFrame: 0.3,
  /** The size assumed for a GLB whose response has not arrived yet. */
  unknownMapMb: 100,
  unknownVariantMb: 50,
} as const

type Count = { done: number; total: number }
/** The counted steps: map images decoded, map geometries indexed, the variant's own, models loaded. */
export type CountedStep3d = 'decode' | 'index' | 'variant-decode' | 'variant-index' | 'assets'
type VariantStatus = 'unknown' | 'none' | 'building' | 'present'

function ratio({ done, total }: Count): number {
  return total > 0 ? Math.max(0, Math.min(1, done / total)) : 0
}

/**
 * LoadProgress3d: the loaders report into it (sizes, counts, completed phases), the view reads
 * `snapshot()`. Every report notifies the subscribers. `now` is the clock of the timings report.
 */
export class LoadProgress3d {
  private map: Count & { complete: boolean } = { done: 0, total: 0, complete: false }
  private variant: Count & { complete: boolean; status: VariantStatus } = { done: 0, total: 0, complete: false, status: 'unknown' }
  private counts: Record<CountedStep3d, Count> = {
    decode: { done: 0, total: 0 },
    index: { done: 0, total: 0 },
    'variant-decode': { done: 0, total: 0 },
    'variant-index': { done: 0, total: 0 },
    assets: { done: 0, total: 0 },
  }
  private complete = new Set<LoadPhase3d>()
  private failed = false
  private stalledPhase: LoadPhase3d | null = null
  private lastActivity: number
  private lastSignature = ''
  private shown = 0
  private base = { raw: 0, shown: 0 }
  private weightsKey = ''
  private listeners = new Set<() => void>()
  private readonly started: number
  private readonly now: () => number
  private readonly completedAt = new Map<LoadPhase3d, number>()

  constructor(now: () => number = () => performance.now()) {
    this.now = now
    this.started = now()
    this.lastActivity = this.started
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** The map GLB download: bytes received and the announced size (0 when unknown). */
  mapBytes(loaded: number, total: number): void {
    this.map.done = loaded
    this.map.total = total
    this.changed()
  }

  /** The map GLB is fully received. */
  mapDownloaded(): void {
    this.map.complete = true
    this.changed()
  }

  /** The variant layer is being built on the server: its size is not known yet. */
  variantBuilding(): void {
    if (this.variant.status === 'present' || this.variant.complete) return
    this.variant.status = 'building'
    this.changed()
  }

  /** The variant GLB download: bytes received and the announced size (0 when unknown). */
  variantBytes(loaded: number, total: number): void {
    this.variant.status = 'present'
    this.variant.done = loaded
    this.variant.total = total
    this.complete.add('variant-build')
    this.changed()
  }

  /** The match has no variant layer (none, or it could not be built): its phases weigh nothing. */
  variantNone(): void {
    if (this.variant.status !== 'present') this.variant.status = 'none'
    this.variantSettled()
  }

  /** The variant layer is posed, absent, or failed: all its phases are over. */
  variantSettled(): void {
    this.variant.complete = true
    for (const phase of ['variant-build', 'variant-prepare'] as const) this.mark(phase)
    this.changed()
  }

  /** A counted step: map images decoded, map geometries indexed, the variant's own, models loaded. */
  step(step: CountedStep3d, done: number, total: number): void {
    this.counts[step] = { done, total }
    this.changed()
  }

  /** A phase is over (its fraction becomes 1). */
  finish(phase: LoadPhase3d): void {
    this.mark(phase)
    this.changed()
  }

  fail(): void {
    this.failed = true
    this.changed()
  }

  /**
   * checkStall fails the load when nothing has reported progress for `stallMs` and returns the
   * phase it was stuck in; otherwise null. The server's variant build is exempt (the page only
   * waits on it, the server's own build queue shows and logs it), and its silence does not count
   * against the phases after it.
   */
  checkStall(stallMs: number = LOAD_STALL_MS): LoadPhase3d | null {
    const state = this.snapshot()
    if (state.kind !== 'loading') return null
    const now = this.now()
    // Progress is a change in what the loaders reported, not a call: a repeated identical report
    // does not keep a stuck load alive.
    const signature = this.progressSignature()
    if (signature !== this.lastSignature || state.phase === 'variant-build') {
      this.lastSignature = signature
      this.lastActivity = now
      return null
    }
    if (now - this.lastActivity < stallMs) return null
    this.stalledPhase = state.phase
    this.fail()
    return state.phase
  }

  /** The current state: error, ready (every phase complete), or loading with its fraction and phase. */
  snapshot(): LoadState {
    if (this.failed) return this.stalledPhase ? { kind: 'error', stalled: this.stalledPhase } : { kind: 'error' }
    const fractions = this.fractions()
    const weights = this.weights()
    const key = LOAD_PHASES_3D.map((p) => weights[p].toFixed(3)).join('|')
    let sum = 0
    let weighted = 0
    for (const phase of LOAD_PHASES_3D) {
      sum += weights[phase]
      weighted += weights[phase] * fractions[phase]
    }
    const raw = sum > 0 ? weighted / sum : 0
    // The first weights are the base; a later change maps the remaining progress onto the rest of the bar.
    if (key !== this.weightsKey) {
      if (this.weightsKey !== '') this.base = { raw, shown: this.shown }
      this.weightsKey = key
    }
    const allDone = LOAD_PHASES_3D.every((p) => fractions[p] >= 1)
    if (allDone) {
      this.shown = 1
      return { kind: 'ready' }
    }
    const { raw: r0, shown: s0 } = this.base
    const mapped = r0 >= 1 ? s0 : s0 + ((raw - r0) * (1 - s0)) / (1 - r0)
    // Below 1 until every phase is complete: a full bar means the scene is ready.
    this.shown = Math.min(0.99, Math.max(this.shown, mapped))
    const phase = LOAD_PHASES_3D.find((p) => fractions[p] < 1) ?? 'first-frame'
    const count = this.countOf(phase)
    return { kind: 'loading', fraction: this.shown, phase, done: count.done, total: count.total }
  }

  /** The measured timings: when each phase completed, in ms since the load started, and the sizes. */
  report(): { mapMb: number; variantMb: number; phasesMs: Partial<Record<LoadPhase3d, number>> } {
    const phasesMs: Partial<Record<LoadPhase3d, number>> = {}
    for (const [phase, at] of this.completedAt) phasesMs[phase] = Math.round(at - this.started)
    return { mapMb: Math.round(this.map.done / MB), variantMb: Math.round(this.variant.done / MB), phasesMs }
  }

  /** Everything the loaders have reported, as one string: it changes exactly when progress is made. */
  private progressSignature(): string {
    const counts = Object.values(this.counts).map((c) => `${c.done}/${c.total}`).join(',')
    return [
      `${this.map.done}/${this.map.total}/${this.map.complete}`,
      `${this.variant.done}/${this.variant.total}/${this.variant.complete}/${this.variant.status}`,
      counts,
      [...this.complete].sort().join(','),
    ].join('|')
  }

  private mark(phase: LoadPhase3d): void {
    if (this.complete.has(phase)) return
    this.complete.add(phase)
    this.completedAt.set(phase, this.now())
  }

  private changed(): void {
    if (this.downloadComplete() && !this.completedAt.has('download')) this.completedAt.set('download', this.now())
    this.listeners.forEach((notify) => notify())
  }

  /** Both downloads are over: the map's, and the variant's when it has one (a variant still
   *  being built has nothing to download yet; its build is a phase of its own). */
  private downloadComplete(): boolean {
    if (!this.map.complete) return false
    if (this.variant.status !== 'present' || this.variant.complete) return true
    return this.variant.total > 0 && this.variant.done >= this.variant.total
  }

  private mapMb(): number {
    const bytes = Math.max(this.map.total, this.map.done)
    return bytes > 0 || this.map.complete ? bytes / MB : LOAD_COSTS_3D.unknownMapMb
  }

  private variantMb(): number {
    if (this.variant.status === 'none') return 0
    if (this.variant.status !== 'present') return this.variant.complete ? 0 : LOAD_COSTS_3D.unknownVariantMb
    const bytes = Math.max(this.variant.total, this.variant.done)
    return bytes > 0 ? bytes / MB : LOAD_COSTS_3D.unknownVariantMb
  }

  private weights(): Record<LoadPhase3d, number> {
    const c = LOAD_COSTS_3D
    const mapMb = this.mapMb()
    const variantMb = this.variantMb()
    return {
      download: (mapMb + variantMb) * c.downloadPerMb,
      decode: mapMb * c.decodePerMb,
      index: mapMb * c.indexPerMb,
      // A variant built on the server right now: its build is a cost of its own.
      'variant-build': this.variant.status === 'building' && !this.variant.complete ? c.variantBuild : 0,
      'variant-prepare': variantMb * c.variantPreparePerMb,
      assets: c.assets,
      warmup: c.warmup,
      'first-frame': c.firstFrame,
    }
  }

  private fractions(): Record<LoadPhase3d, number> {
    const done = (phase: LoadPhase3d, partial: number) => (this.complete.has(phase) ? 1 : Math.min(partial, 0.999))
    const mapBytes = Math.max(this.map.total, this.map.done)
    const variantBytes = this.variant.status === 'present' ? Math.max(this.variant.total, this.variant.done) : 0
    const downloaded = this.map.done + (this.variant.status === 'present' ? this.variant.done : 0)
    const variantPrep = 0.6 * ratio(this.counts['variant-decode']) + 0.4 * ratio(this.counts['variant-index'])
    return {
      download: this.downloadComplete() ? 1 : Math.min(0.999, mapBytes + variantBytes > 0 ? downloaded / (mapBytes + variantBytes) : 0),
      decode: done('decode', ratio(this.counts.decode)),
      index: done('index', ratio(this.counts.index)),
      'variant-build': done('variant-build', 0),
      'variant-prepare': done('variant-prepare', variantPrep),
      assets: done('assets', ratio(this.counts.assets)),
      warmup: done('warmup', 0),
      'first-frame': done('first-frame', 0),
    }
  }

  private countOf(phase: LoadPhase3d): Count {
    switch (phase) {
      case 'download': {
        const variant = this.variant.status === 'present' ? this.variant : { done: 0, total: 0 }
        const total = this.map.total > 0 && (this.variant.status !== 'present' || variant.total > 0) ? this.map.total + variant.total : 0
        return { done: this.map.done + variant.done, total }
      }
      case 'decode': return this.counts.decode
      case 'index': return this.counts.index
      case 'variant-prepare': return this.counts['variant-index'].total > 0 ? this.counts['variant-index'] : this.counts['variant-decode']
      case 'assets': return this.counts.assets
      default: return { done: 0, total: 0 }
    }
  }
}
