// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * recoilShots3d.ts — LES TIRS RÉCENTS D'UN TIREUR, d'où se calcule le recul de son arme (`recoil3d`).
 *
 * Les tirs de la page (`shotFx`, tir continu compris) sont rangés une fois par emplacement de bipède,
 * triés par image FRACTIONNAIRE (`ShotFxEntry.time`, l'offset intra-frame compris), dans des tableaux
 * typés ; à chaque image, deux recherches dichotomiques bornent les tirs encore dans la fenêtre de
 * recul : aucune allocation par image. Un tir d'arme DE VÉHICULE ne fait pas reculer l'arme en main ;
 * une arme de joueur tirée d'un siège, si.
 */
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import type { ShotFxEntry } from '../model/shotFx'
import type { Action3dInputs } from './action3dInputs'
import { RECOIL_PROFILES, clearRecoil, recoilAt, recoilKindOfKey, recoilWindow, type Recoil, type RecoilKind } from './recoil3d'

/** Les tirs d'un emplacement : leurs images fractionnaires (triées) et leurs germes, dans le même ordre. */
export interface SlotShots {
  frames: Float64Array
  seeds: Float64Array
}

const NONE = new Float64Array(0)

/** indexShotTimes : les tirs à pied (ou d'une arme de joueur) de chaque emplacement, triés par image fractionnaire. */
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

/** firstAbove : l'indice du premier élément de `sorted` strictement au-dessus de `value` (`strict`) ou au moins égal. */
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
 * ShooterRecoil — le recul de l'arme d'un tireur à une image : ses tirs récents, la famille de recul de
 * l'arme en main (par la clé de son libellé), la cadence du document. Réindexe quand la page change
 * de liste de tirs.
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

  /** at écrit dans `out` l'écart de l'arme `weaponId` tenue par l'emplacement `slot` à l'image `frame`. */
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
