// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * padOffsets3d.ts — HOW A PAD HOLDS ITS ITEM, read from the weapon library index (`pad_offsets`,
 * written by the server from each weapon and equipment model's `weapon_pad_offset` marker,
 * `internal/weapons/pad_offsets.go`): per model key, that marker's frame in model space, GLB axes.
 *
 * The game poses a pad's item so that this marker's frame is the pad's holding frame: a weapon sits
 * at its middle, level; the Shroud Screen stands upright with its tip down, the Repulsor's disc on
 * its edge, the Thruster and the Grapple on their side. `padItemPose` composes it with the pad's own
 * frame (its holding point and its spin about up). While the index cannot be read, no key has one.
 */
import * as THREE from 'three'

import { IndexField, type FetchJson } from './indexField3d'

/** A model's pad marker: position and rotation in model space (GLB axes). */
export interface PadOffset {
  readonly p: THREE.Vector3
  readonly q: THREE.Quaternion
}

export type PadOffsetTable = ReadonlyMap<string, PadOffset>

const TAG_KEY = /^[0-9a-f]{8}$/
const finite = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x))

/** parsePadOffsets reads the table out of an index document; null when the field is absent (an older library). */
export function parsePadOffsets(doc: unknown): PadOffsetTable | null {
  const raw = (doc as { pad_offsets?: unknown } | null)?.pad_offsets
  if (!raw || typeof raw !== 'object') return null
  const out = new Map<string, PadOffset>()
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    const e = v as { p?: unknown; q?: unknown }
    if (!TAG_KEY.test(key) || !finite(e?.p, 3) || !finite(e?.q, 4)) continue
    const q = new THREE.Quaternion(e.q[0], e.q[1], e.q[2], e.q[3])
    if (q.lengthSq() < 1e-6) continue
    out.set(key, { p: new THREE.Vector3(e.p[0], e.p[1], e.p[2]), q: q.normalize() })
  }
  return out
}

/**
 * padItemRotation — the item's model rotation on a pad: turned so that its pad marker's frame is
 * the pad's holding frame `hold` (its spin about up). The game spins the item about its middle,
 * not about the marker's position (the Grapple's marker sits at its back end): the caller centers
 * the item's bounds on the pad. `out` may be `hold`.
 */
export function padItemRotation(offset: PadOffset, hold: THREE.Quaternion, out: THREE.Quaternion): THREE.Quaternion {
  const h = HOLD.copy(hold)
  return out.copy(offset.q).invert().premultiply(h)
}
const HOLD = new THREE.Quaternion()

/**
 * parseGroundScales reads the index's `ground_scales` (per model key, the scale the game draws an
 * item at while it lies in the world or floats on a pad: weapons 1.3, the Shroud Screen 1.5, the
 * Grapple 2.75); null when the field is absent (an older library).
 */
export function parseGroundScales(doc: unknown): ReadonlyMap<string, number> | null {
  const raw = (doc as { ground_scales?: unknown } | null)?.ground_scales
  if (!raw || typeof raw !== 'object') return null
  const out = new Map<string, number>()
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (TAG_KEY.test(key) && typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 10) out.set(key, v)
  }
  return out
}

/** PadOffsets — the pad markers and ground scales of the library served at `indexUrl`, read on first use. */
export class PadOffsets {
  private readonly table: IndexField<PadOffsetTable>
  private readonly scales: IndexField<ReadonlyMap<string, number>>

  constructor(indexUrl: string, fetchJson?: FetchJson) {
    this.table = new IndexField(indexUrl, parsePadOffsets, fetchJson)
    this.scales = new IndexField(indexUrl, parseGroundScales, fetchJson)
  }

  /** of is the pad marker of model `key`, null when it has none (yet). */
  of(key: string): PadOffset | null {
    return this.table.get()?.get(key) ?? null
  }

  /** groundScale is the ground scale of model `key`, null when it has none (yet). */
  groundScale(key: string): number | null {
    return this.scales.get()?.get(key) ?? null
  }

  dispose(): void {
    this.table.dispose()
    this.scales.dispose()
  }
}
