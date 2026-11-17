// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ragdollBakery3d.ts — THE BAKES FOR A MATCH'S DEATHS, done on demand without blocking the page.
 *
 * A death is baked once (`ragdollBake3d`); while its bake isn't ready, the body falls through
 * the game's death clips (`fall3d`), nothing breaks. Order: bodies visible at the current frame
 * first, then deaths closest to the playhead. Every view frame advances the bakes within a time
 * budget (`pump`); the rest happens while the browser is idle (`requestIdleCallback`), in slices.
 *
 * Bakes depend on the Spartan (its skeleton, its clips) and the map's surfaces: a new Spartan or
 * a layer placed on the map (`Ground.version`) forgets all of them.
 */
import { heldWeaponAt } from './heldWeapon3d'
import type { ActionContext } from './actionScene3d'
import type { Death3d } from './deaths3d'
import { Motion3d } from './motion3d'
import { bakeBytes, RagdollJob, type RagdollBake } from './ragdollBake3d'
import { MeshTriangleSource, bodySurfaces } from './ragdollPatch3d'
import { makeScratch, startOf, type Scratch } from './ragdollStart3d'

/** The baking time a view frame allows itself (ms). */
export const FRAME_BUDGET_MS = 3
/** Time left to the browser within an idle slice (ms). */
const IDLE_SLACK_MS = 1
/** With no Spartan loaded, idle baking rests this long before retrying (ms). */
const RETRY_MS = 500

/** Measurements of the bakes done. */
export interface BakeryStats {
  baked: number
  failed: number
  totalMs: number
  maxMs: number
  bytes: number
}

type IdleHandle = { kind: 'idle' | 'timer'; id: number }

export class RagdollBakery {
  private readonly ctx: ActionContext
  private readonly motion: Motion3d
  private deaths: readonly Death3d[] = []
  private keys = new Map<Death3d, string>()
  private readonly bakes = new Map<string, RagdollBake | null>()
  private readonly jobs = new Map<string, RagdollJob>()
  private source: object | null = null
  private version = -1
  private scratch: Scratch | null = null
  private world: MeshTriangleSource | null = null
  private playhead = 0
  private hold = 1
  private idle: IdleHandle | null = null
  private disposed = false
  private readonly totals: BakeryStats = { baked: 0, failed: 0, totalMs: 0, maxMs: 0, bytes: 0 }

  constructor(ctx: ActionContext) {
    this.ctx = ctx
    this.motion = new Motion3d(ctx, (slot, frame) => heldWeaponAt(ctx.doc, slot, Math.floor(frame), ctx.inputs().locale))
  }

  /**
   * setDeaths: the match's deaths. A rebuilt list keeps the bakes of the deaths it still holds
   * (same key, `deathKey`) and forgets the rest.
   */
  setDeaths(deaths: readonly Death3d[]): void {
    this.deaths = deaths
    this.keys = new Map(deaths.map((d) => [d, deathKey(d)]))
    const kept = new Set(this.keys.values())
    for (const k of [...this.bakes.keys()]) if (!kept.has(k)) this.bakes.delete(k)
    for (const k of [...this.jobs.keys()]) if (!kept.has(k)) this.jobs.delete(k)
    this.recount()
    this.wake()
  }

  /** get: death `d`'s ready bake, null otherwise (the body then falls through the clips). */
  get(d: Death3d): RagdollBake | null {
    this.validate()
    const k = this.keys.get(d)
    return (k !== undefined && this.bakes.get(k)) || null
  }

  /**
   * pump advances bakes up to deadline `deadline` (`performance.now()`), bodies visible at frame
   * `frame` first; `hold`: how long a body stays (frames).
   */
  pump(frame: number, hold: number, deadline: number): void {
    this.playhead = frame
    this.hold = hold
    if (!this.validate()) return
    while (performance.now() < deadline) {
      const d = this.next()
      if (!d) return
      this.advance(d, deadline)
    }
  }

  /**
   * bakeVisible finishes, with no time budget, the bakes of the bodies visible at `frame`, and
   * only those: the video export must not encode a body falling by the clips stopgap, and it can
   * afford to wait where the screen cannot. Bodies further away keep the budgeted path.
   */
  bakeVisible(frame: number, hold: number): void {
    this.playhead = frame
    this.hold = hold
    if (!this.validate()) return
    for (;;) {
      const d = this.next()
      if (!d || !this.visible(d)) return
      this.advance(d, Infinity)
    }
  }

  stats(): BakeryStats {
    return { ...this.totals }
  }

  dispose(): void {
    this.disposed = true
    this.cancelIdle()
    this.forget()
  }

  private advance(d: Death3d, deadline: number): void {
    const k = this.keys.get(d) ?? deathKey(d)
    let job = this.jobs.get(k)
    if (!job) {
      const start = this.scratch && this.world ? startOf(this.ctx, this.motion, this.scratch, this.world, d) : null
      const made = start ? RagdollJob.start(start) : null
      if (!made) {
        this.bakes.set(k, null)
        this.totals.failed++
        return
      }
      job = made
      this.jobs.set(k, job)
    }
    const bake = job.advance(deadline)
    if (job.failed) {
      this.jobs.delete(k)
      this.bakes.set(k, null)
      this.totals.failed++
      return
    }
    if (!bake) return
    this.jobs.delete(k)
    this.bakes.set(k, bake)
    this.totals.baked++
    this.totals.totalMs += bake.stats.ms
    this.totals.maxMs = Math.max(this.totals.maxMs, bake.stats.ms)
    this.totals.bytes += bakeBytes(bake)
  }

  /** next: the death to bake first (visible at the frame, then closest to the playhead). */
  private next(): Death3d | null {
    let best: Death3d | null = null
    let bestKey = Infinity
    for (const d of this.deaths) {
      if (!d.body || this.bakes.has(this.keys.get(d) ?? '')) continue
      const key = (this.visible(d) ? 0 : 1e9) + Math.abs(d.body.start - this.playhead)
      if (key < bestKey) {
        bestKey = key
        best = d
      }
    }
    return best
  }

  /** visible: is the body of death `d` drawn at the playhead? */
  private visible(d: Death3d): boolean {
    return !!d.body && d.body.start <= this.playhead && this.playhead - d.frame < this.hold
  }

  /** validate: are the Spartan and the map the ones the bakes were made for? If not, everything is forgotten. False with no Spartan. */
  private validate(): boolean {
    const source = this.ctx.spartanModel()
    const version = this.ctx.ground.version
    if (source !== this.source || version !== this.version) {
      this.forget()
      this.source = source
      this.version = version
      this.scratch = source ? makeScratch(source) : null
      this.world = new MeshTriangleSource(bodySurfaces(this.ctx.ground.surfaces()))
      this.wake()
    }
    return this.scratch !== null
  }

  private forget(): void {
    this.bakes.clear()
    this.jobs.clear()
    this.recount()
  }

  /** recount redoes the measurements from the kept bakes. */
  private recount(): void {
    const t: BakeryStats = { baked: 0, failed: 0, totalMs: 0, maxMs: 0, bytes: 0 }
    for (const b of this.bakes.values()) {
      if (!b) {
        t.failed++
        continue
      }
      t.baked++
      t.totalMs += b.stats.ms
      t.maxMs = Math.max(t.maxMs, b.stats.ms)
      t.bytes += bakeBytes(b)
    }
    Object.assign(this.totals, t)
  }

  /** wake restarts idle baking (only one at a time). */
  private wake(): void {
    if (this.disposed || this.idle) return
    if (typeof requestIdleCallback === 'function') {
      this.idle = { kind: 'idle', id: requestIdleCallback((dl) => this.onIdle(dl)) }
    }
  }

  private onIdle(dl: IdleDeadline): void {
    this.idle = null
    if (this.disposed) return
    if (!this.validate()) {
      this.idle = { kind: 'timer', id: window.setTimeout(() => {
        this.idle = null
        this.wake()
      }, RETRY_MS) }
      return
    }
    this.pump(this.playhead, this.hold, performance.now() + Math.max(0, dl.timeRemaining() - IDLE_SLACK_MS))
    if (this.next()) this.wake()
  }

  private cancelIdle(): void {
    if (!this.idle) return
    if (this.idle.kind === 'idle') cancelIdleCallback(this.idle.id)
    else window.clearTimeout(this.idle.id)
    this.idle = null
  }
}

/**
 * deathKey: what makes a death bake the same way from one rebuilt list to another (the victim,
 * the killer, the frame, the body's start, and the fall's style).
 */
export function deathKey(d: Pick<Death3d, 'victim' | 'killer' | 'frame' | 'body'>): string {
  return `${d.victim}|${d.killer}|${d.frame}|${d.body?.start}|${d.body?.fall.kind}`
}
