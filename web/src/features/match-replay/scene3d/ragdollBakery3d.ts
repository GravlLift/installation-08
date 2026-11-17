// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ragdollBakery3d.ts — LES CUISSONS DES MORTS D'UN MATCH, faites à la demande sans bloquer la page.
 *
 * Une mort se cuit une fois (`ragdollBake3d`) ; tant que sa cuisson n'est pas prête, le corps tombe
 * par les clips de mort du jeu (`fall3d`), rien ne casse. L'ordre : les corps visibles à l'image,
 * puis les morts les plus proches de la tête de lecture. Chaque image de la vue avance les cuissons
 * dans un budget de temps (`pump`) ; le reste se fait quand le navigateur est inoccupé
 * (`requestIdleCallback`), par tranches.
 *
 * Les cuissons dépendent du Spartan (son squelette, ses clips) et des surfaces de la carte : un
 * nouveau Spartan ou un calque posé sur la carte (`Ground.version`) les oublie toutes.
 */
import { heldWeaponAt } from './heldWeapon3d'
import type { ActionContext } from './actionScene3d'
import type { Death3d } from './deaths3d'
import { Motion3d } from './motion3d'
import { bakeBytes, RagdollJob, type RagdollBake } from './ragdollBake3d'
import { MeshTriangleSource, bodySurfaces } from './ragdollPatch3d'
import { makeScratch, startOf, type Scratch } from './ragdollStart3d'

/** Le temps de cuisson qu'une image de la vue s'accorde (ms). */
export const FRAME_BUDGET_MS = 3
/** Le temps laissé au navigateur dans une tranche inoccupée (ms). */
const IDLE_SLACK_MS = 1
/** Sans Spartan chargé, la cuisson inoccupée se repose ce délai avant de réessayer (ms). */
const RETRY_MS = 500

/** Les mesures des cuissons faites. */
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
   * setDeaths : les morts du match. Une liste refaite garde les cuissons des morts qu'elle reprend
   * (même clé, `deathKey`) et oublie les autres.
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

  /** get : la cuisson prête de la mort `d`, null sinon (le corps tombe alors par les clips). */
  get(d: Death3d): RagdollBake | null {
    this.validate()
    const k = this.keys.get(d)
    return (k !== undefined && this.bakes.get(k)) || null
  }

  /**
   * pump avance les cuissons jusqu'à l'échéance `deadline` (`performance.now()`), les corps visibles
   * à l'image `frame` d'abord ; `hold` : la durée d'un corps (images).
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

  /** next : la mort à cuire d'abord (visible à l'image, puis la plus proche de la tête de lecture). */
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

  /** validate : le Spartan et la carte sont-ils ceux des cuissons ? Sinon tout est oublié. Faux sans Spartan. */
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

  /** recount refait les mesures depuis les cuissons gardées. */
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

  /** wake relance la cuisson inoccupée (une seule à la fois). */
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
 * deathKey : ce qui fait qu'une mort se cuit pareil d'une liste refaite à l'autre (la victime, le
 * tueur, l'image, le départ du corps et le style de chute).
 */
export function deathKey(d: Pick<Death3d, 'victim' | 'killer' | 'frame' | 'body'>): string {
  return `${d.victim}|${d.killer}|${d.frame}|${d.body?.start}|${d.body?.fall.kind}`
}
