// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * eye3d.ts — THE EYE'S DROP: how much height (world units) the eye loses crouched or in a slide,
 * fading in on entry and fading out on exit.
 *
 * The game holds first person at the same eye height crouched and in a slide: the spans of both
 * postures at a slot are merged, and the drop is their continuous envelope — fade in on entry,
 * fade out on exit, never a jump, never past what the fade-in reached. A pure function of the
 * frame: nothing is remembered between frames, and the same frame gives the same drop traversed
 * forward or backward.
 */
import { CROUCH_DROP } from './body3d'

/** Fade time (seconds) of the drop when crouching or a slide starts. */
export const DUREE_ENTREE_OEIL = 0.2
/** Time (seconds) for the eye to return to standing height once the last span ends. */
export const DUREE_SORTIE_OEIL = 0.25

/** A merged drop span: [t0, fin) in frames, the end exclusive. */
export interface IntervalleOeil {
  t0: number
  fin: number
}

/** No span: the shared empty list (no allocation per `dropOeil` call). */
export const SANS_INTERVALLE: readonly IntervalleOeil[] = []

/**
 * fusionnerIntervallees sorts and merges the half-open spans [t0, fin): ones that touch or
 * overlap become one, without changing the union's bounds.
 */
export function fusionnerIntervallees(liste: readonly IntervalleOeil[]): IntervalleOeil[] {
  const sorted = [...liste].sort((a, b) => a.t0 - b.t0)
  const merged: IntervalleOeil[] = []
  for (const it of sorted) {
    const last = merged[merged.length - 1]
    if (last && it.t0 <= last.fin) {
      if (it.fin > last.fin) last.fin = it.fin
    } else merged.push({ ...it })
  }
  return merged
}

/** The smoothstep clamped to [0, 1]: 0 at 0, 1/2 at the midpoint, 1 at 1. */
function smoothstep(u: number): number {
  const x = u < 0 ? 0 : u > 1 ? 1 : u
  return x * x * (3 - 2 * x)
}

/**
 * dropOeil: the eye's drop in world units at fractional frame `f` — 0 standing, CROUCH_DROP fully
 * crouched or in a slide. Fades over `entree` frames on entry, `sortie` on exit; for a span
 * shorter than the fade, the drop is the entry fade capped by the exit fade (never a jump, never
 * past what the entry reached). `intervallees`: the slot's merged, sorted spans
 * (`fusionnerIntervallees`).
 */
export function dropOeil(intervallees: readonly IntervalleOeil[], f: number, entree: number, sortie: number): number {
  if (intervallees.length === 0) return 0
  // The last span started (t0 <= f); after it, nothing has entered yet.
  let lo = 0, hi = intervallees.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (intervallees[m].t0 <= f) lo = m + 1
    else hi = m
  }
  const high = lo - 1
  if (high < 0) return 0
  // The first span whose exit tail still covers f; before it, the fades are done.
  lo = 0; hi = high + 1
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (intervallees[m].fin > f - sortie) hi = m
    else lo = m + 1
  }
  let max = 0
  for (let i = lo; i <= high; i++) {
    const it = intervallees[i]
    const fadeIn = smoothstep((f - it.t0) / entree)
    const fadeOut = 1 - smoothstep((f - it.fin) / sortie)
    const v = fadeIn < fadeOut ? fadeIn : fadeOut
    if (v > max) max = v
  }
  return max * CROUCH_DROP
}
