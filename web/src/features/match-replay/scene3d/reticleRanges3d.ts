/**
 * reticleRanges3d.ts — THE RED-RETICLE RANGE OF EACH WEAPON, read from the weapon library index
 * (`reticle_ranges`, written by the server from each weapon's `weap` tag: its autoaim range, and
 * per zoom level that range scaled by the level's magnification). World units.
 *
 * A weapon absent from the table has no range: its reticle never turns red. There is no shared
 * value for "any weapon". The index is read once; while it cannot be read (library not built yet,
 * or built before the field existed and being rebuilt) every weapon has no range, and the read is
 * retried after `RETRY_MS`.
 */
import { api } from '@/lib/api/client'
import { isNotFound } from '@/lib/replay/queries'

/**
 * One weapon's entry in the index: `zoomed[level - 1]` is the range at that zoom level, and
 * `magnifications[level - 1]` is the magnification the tag gives that level (the zoom the
 * first-person view applies). A weapon without a zoom level has an empty list for both.
 */
export interface ReticleRangeEntry {
  unscoped: number
  zoomed: number[]
  magnifications: number[]
}

export type ReticleRangeTable = Readonly<Record<string, ReticleRangeEntry>>

/** Delay before reading the index again after a failed read (ms). */
const RETRY_MS = 15_000

/**
 * reticleRangeAt is the range of the weapon `entry` at the zoom level `zoomLevel` (0 = at the
 * hip): the unscoped range at the hip and for a weapon whose tag declares no zoom level, else the
 * range of that level (a level past the declared ones reads the last one). Null without an entry.
 */
export function reticleRangeAt(entry: ReticleRangeEntry | undefined, zoomLevel: number): number | null {
  if (!entry) return null
  if (zoomLevel <= 0 || entry.zoomed.length === 0) return entry.unscoped
  return entry.zoomed[Math.min(zoomLevel, entry.zoomed.length) - 1]
}

/** parseReticleRanges reads the table out of an index document; null when the field is absent. */
export function parseReticleRanges(doc: unknown): ReticleRangeTable | null {
  const raw = (doc as { reticle_ranges?: unknown } | null)?.reticle_ranges
  if (!raw || typeof raw !== 'object') return null
  const out: Record<string, ReticleRangeEntry> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const e = value as Partial<ReticleRangeEntry> | null
    if (typeof e?.unscoped !== 'number' || e.unscoped <= 0) continue
    const zoomed = Array.isArray(e.zoomed) ? e.zoomed.filter((z): z is number => typeof z === 'number' && z > 0) : []
    // An entry whose magnifications are missing (an index built before the field) is dropped:
    // the weapon then does not zoom, and a retry after the index rebuilds recovers it.
    const mags = Array.isArray(e.magnifications) ? e.magnifications.filter((m): m is number => typeof m === 'number' && m > 1) : null
    if (mags === null) continue
    out[key] = { unscoped: e.unscoped, zoomed, magnifications: mags }
  }
  return out
}

type FetchJson = (url: string, signal: AbortSignal) => Promise<unknown>

const defaultFetch: FetchJson = (url, signal) => api.get<unknown>(url, undefined, { signal })

/** ReticleRanges — the table of the library served at `indexUrl`, read on first use. */
export class ReticleRanges {
  private table: ReticleRangeTable | null = null
  private loading = false
  private retryAt = 0
  private readonly abort = new AbortController()
  private readonly indexUrl: string
  private readonly fetchJson: FetchJson

  constructor(indexUrl: string, fetchJson: FetchJson = defaultFetch) {
    this.indexUrl = indexUrl
    this.fetchJson = fetchJson
  }

  /** range is the range of the weapon of model key `key` at `zoomLevel`, null when it has none (yet). */
  range(key: string, zoomLevel: number): number | null {
    if (!this.table) {
      this.load()
      return null
    }
    return reticleRangeAt(this.table[key], zoomLevel)
  }

  /**
   * magnifications is the zoom magnifications of the weapon of model key `key` (index = level - 1),
   * or null when the index has none for it (yet, or at all): a weapon the tags give no zoom to.
   */
  magnifications(key: string): number[] | null {
    if (!this.table) {
      this.load()
      return null
    }
    const entry = this.table[key]
    return entry && entry.magnifications.length > 0 ? entry.magnifications : null
  }

  dispose(): void {
    this.abort.abort()
  }

  private load(): void {
    if (this.loading || performance.now() < this.retryAt) return
    this.loading = true
    this.fetchJson(this.indexUrl, this.abort.signal).then(
      (doc) => {
        this.table = parseReticleRanges(doc)
        if (!this.table) this.retryAt = performance.now() + RETRY_MS
      },
      (err: unknown) => {
        if (this.abort.signal.aborted) return
        if (!isNotFound(err)) console.warn('replay 3D: weapon index unreadable, no red reticle ranges', err)
        this.retryAt = performance.now() + RETRY_MS
      },
    ).finally(() => { this.loading = false })
  }
}
