/**
 * reticleRanges3d.ts — THE RED-RETICLE RANGE OF EACH WEAPON, read from the weapon library index
 * (`reticle_ranges`, written by the server from each weapon's `weap` tag: its autoaim range, and
 * per zoom level that range scaled by the level's magnification). World units.
 *
 * A weapon absent from the table has no range: its reticle never turns red. There is no shared
 * value for "any weapon". While the index cannot be read (`indexField3d`) every weapon has no
 * range.
 */
import { IndexField, type FetchJson } from './indexField3d'

/** One weapon's entry in the index: `zoomed[level - 1]` is the range at that zoom level. */
export interface ReticleRangeEntry {
  unscoped: number
  zoomed: number[]
}

export type ReticleRangeTable = Readonly<Record<string, ReticleRangeEntry>>

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
    out[key] = { unscoped: e.unscoped, zoomed }
  }
  return out
}

/** ReticleRanges — the table of the library served at `indexUrl`, read on first use. */
export class ReticleRanges {
  private readonly table: IndexField<ReticleRangeTable>

  constructor(indexUrl: string, fetchJson?: FetchJson) {
    this.table = new IndexField(indexUrl, parseReticleRanges, fetchJson)
  }

  /** range is the range of the weapon of model key `key` at `zoomLevel`, null when it has none (yet). */
  range(key: string, zoomLevel: number): number | null {
    const table = this.table.get()
    return table ? reticleRangeAt(table[key], zoomLevel) : null
  }

  dispose(): void {
    this.table.dispose()
  }
}
