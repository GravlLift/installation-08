// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * recoilShots3d.ts — A SHOOTER'S RECENT SHOTS, from which their weapon's recoil is computed (`recoil3d`).
 *
 * The page's shots (`shotFx`, including sustained fire) are sorted once per biped slot, by
 * FRACTIONAL frame (`ShotFxEntry.time`, intra-frame offset included), into typed arrays; on every
 * frame, two binary searches bound the shots still within the recoil window: no allocation per
 * frame. A VEHICLE weapon's shot does not recoil the held weapon; a player weapon fired from a
 * seat does.
 */
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import type { ShotFxEntry } from '../model/shotFx'
import type { Action3dInputs } from './action3dInputs'
import { RECOIL_PROFILES, clearRecoil, recoilAt, recoilKindOfKey, recoilWindow, type Recoil, type RecoilKind } from './recoil3d'

/** A slot's shots: their fractional frames (sorted) and their seeds, in the same order. */
export interface SlotShots {
  frames: Float64Array
  seeds: Float64Array
}

const NONE = new Float64Array(0)

/** indexShotTimes: each slot's on-foot (or player weapon) shots, sorted by fractional frame. */
export function indexShotTimes(shots: readonly ShotFxEntry[]): Map<number, SlotShots> {
  const lists = new Map<number, ShotFxEntry[]>()
  for (const e of shots) {
    if (e.vehicleShot?.arme === 'vehicule') continue
    const list = lists.get(e.slot)
    if (list) list.push(e)
    else lists.set(e.slot, [e])
  }
  const out = new Map<number, SlotShots>()
  for (const [slot, list] of lists) {
    list.sort((p, q) => p.time - q.time)
    out.set(slot, { frames: Float64Array.from(list, (e) => e.time), seeds: Float64Array.from(list, (e) => e.seed) })
  }
  return out
}

/** firstAbove: the index of the first element of `sorted` strictly above `value` (`strict`) or at least equal. */
export function firstAbove(sorted: ArrayLike<number>, value: number, strict: boolean): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const below = strict ? sorted[mid] <= value : sorted[mid] < value
    if (below) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * ShooterRecoil — a shooter's weapon recoil at a frame: their recent shots, the held weapon's
 * recoil family (by its label's key), the document's frame rate. Reindexes when the page serves
 * a different shot list.
 */
export class ShooterRecoil {
  private source: readonly ShotFxEntry[] | null = null
  private bySlot = new Map<number, SlotShots>()
  private readonly kinds = new Map<string, RecoilKind>()
  private readonly span = { frames: NONE as ArrayLike<number>, seeds: NONE as ArrayLike<number>, from: 0, to: 0 }
  private readonly doc: ReplayDocumentReady
  private readonly inputs: () => Pick<Action3dInputs, 'shotFx' | 'framesPerSecond'>

  constructor(doc: ReplayDocumentReady, inputs: () => Pick<Action3dInputs, 'shotFx' | 'framesPerSecond'>) {
    this.doc = doc
    this.inputs = inputs
  }

  /** at writes to `out` the offset of weapon `weaponId` held by slot `slot` at frame `frame`. */
  at(slot: number, frame: number, weaponId: string, out: Recoil): Recoil {
    const inputs = this.inputs()
    if (inputs.shotFx !== this.source) {
      this.source = inputs.shotFx
      this.bySlot = indexShotTimes(inputs.shotFx)
    }
    const shots = this.bySlot.get(slot)
    const profile = RECOIL_PROFILES[this.kindOf(weaponId)]
    const fps = Math.max(1, inputs.framesPerSecond)
    const window = recoilWindow(profile) * fps
    if (!shots || window === 0) return clearRecoil(out)
    const span = this.span
    span.frames = shots.frames
    span.seeds = shots.seeds
    span.from = firstAbove(shots.frames, frame - window, false)
    span.to = firstAbove(shots.frames, frame, true)
    return recoilAt(span, frame, fps, profile, out)
  }

  private kindOf(id: string): RecoilKind {
    let kind = this.kinds.get(id)
    if (kind === undefined) {
      kind = recoilKindOfKey(this.doc.weaponLabels?.[id]?.key)
      this.kinds.set(id, kind)
    }
    return kind
  }
}
