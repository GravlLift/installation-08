/**
 * padPresenceRefine.ts — THE UNCERTAIN STATE OF A PAD, BROUGHT BACK TO WHAT A PLAYER COULD HAVE DONE.
 *
 * THE DECISION IS THE USER'S (2nd pass of 2026-08-27): « I saw a replay where a pad
 * was uncertain while all the players were at the other end of the map. Not logical. »
 * No one picks up a weapon without passing over it: as long as NO player passed near the
 * pad, there is no reason to display a doubt — the pad stays FULL.
 *
 * WHAT THIS FILE DOES, AND NOTHING ELSE: it RAISES `tLow`, the bound from which
 * the screen stops asserting the presence, up to the first APPROACH of a player in the window
 * of uncertainty. `t0`, `tHigh`, `spawns` and `cycle` are TOUCHED NOT AT ALL — the proof of absence, the
 * « empty » flip and the countdown remain exactly those of the measurement.
 *
 * WHY MEASUREMENT A-2 DID NOT REFUTE THIS RULE, even though it contradicted it at 31 %.
 * The oracle was CIRCULAR. A-2 compared the rule to the proof of absence of the ARTIFACT, but
 * this proof is the CENSUS of the keyframes — and the census is itself probab-
 * ly bounded by the proximity of the players. In a window with no approach at all, what
 * disappears is probably the object OF THE CENSUS, not the object of the terrain. The distribution
 * says so: the two films that carry ~75 % of the contradictions are the two BTB with 24-25 players,
 * with median minimal distances of 18 to 25 m; the arenas are between 0 and 10 %. The
 * negative of A-2 stays true as written — the artifact does not confirm the rule there —
 * but it does not refute it.
 *
 * THE COST IS ACCEPTED, and it must be written: a TRUE disappearance without approach (mechanism
 * unknown — object removed by the engine, weapon picked up by a player whose track is missing) will
 * from now on be displayed FULL up to `tHigh`, where « uncertain » asserted nothing. We exchange an
 * honest but unreadable doubt for a useful assertion and rarely false. It is a
 * product decision, not a measurement result.
 *
 * RESUMPTION CONDITION: the inquiry into the population of pads of the BTB artifacts (the two films
 * in question, pads never approached the whole film long) is open. If it shows that these pads are
 * measurement artifacts, this file will have nothing left to correct; if it shows the opposite, it is
 * the radius or the rule that will have to move.
 *
 * Pure: no React dependency, no canvas. The memoization is on the caller side.
 */
import type { ReplayTrackReady, ReplayWeaponPadReady } from '../../../lib/replay/replayNormalize'

/**
 * THE APPROACH RADIUS, in world meters, and where it comes from.
 *
 * MEASURED (instrument A-2, `pads_proximity_research_test.go`), and ALL THE NUMBERS THAT FOLLOW
 * COME FROM THE SAME DENOMINATOR — the 1 064 completed occupations the artifact publishes
 * (`padPickups`, 30 artifacts). Mixing them with those of the control base reconstructed
 * from `Presence` (992 occupations, narrower) is the error the measurement review
 * has already had corrected once: at 2 m, **69.1 %** of the completed occupations carry at least one
 * approach (100 − 30.92), and the closest pass has a median distance of **0.36 m**.
 *
 * THE DISTRIBUTION IS BIMODAL, and that is what makes the choice LITTLE SENSITIVE: either a player
 * passes at less than a meter, or there is no one tens of meters away. Opening the radius from
 * 1 m to 10 m gains only a DOZEN points (contradiction 33.18 % → 23.21 %): there is
 * no « well tuned » radius to find, the whole reasonable interval gives the same result.
 * 2 m is wide enough to cover a pickup while running (a player travels ~0.6 m between
 * two frames) without ever reaching the second mode.
 */
export const PAD_APPROACH_RADIUS_M = 2

/**
 * THE SLIVER « NO ONE PASSED »: by how much the bound settles BEFORE `tHigh`, in frames.
 *
 * WHY NOT `tLow = tHigh` PLAIN AND SIMPLE, which would be the obvious writing: `padStateAt` already reads
 * `tHigh <= tLow` as the SENTINEL « no absence has ever been proven », and renders then
 * FULL forever — including AFTER `tHigh`. The pad would never flip to empty again and
 * its countdown would disappear, while the proof of absence, it, has not moved. So
 * `tLow` must stay STRICTLY under `tHigh`, hence this sliver.
 *
 * IT IS VISIBLE, AND IT MUST BE WRITTEN (adversarial review of 2026-08-27). We first thought
 * that a sliver of a half-frame cost nothing because « the frames are whole »: that is
 * FALSE on the draw. `useReplayPlayback` advances the frame by `dt × fps` WITHOUT rounding, and the overlay
 * as well as the hover read this FRACTIONAL value. The interval `[tHigh - sliver ; tHigh)` is
 * therefore reachable: at a half-frame it lasted 50 ms of film (100 ms of watch at 0.5x), i.e.
 * about three frames painted with an « uncertain » halo just before each flip — and the state
 * FROZE there if the reader paused inside it.
 *
 * `1/64` OF A FRAME BRINGS THE SLIVER BACK TO ~1.6 ms of film (a frame of 100 ms): at worst ONE
 * painted isolated frame from time to time, and a pause that would fall exactly inside it becomes on the order of
 * 0.008 % of the axis. The sliver does NOT DISAPPEAR — it cannot, `tHigh > tLow` is the
 * condition that keeps the sentinel free — it becomes invisible in practice. Power of two
 * chosen on purpose: exact in binary, so no rounding drift when comparing to a frame
 * fractional.
 *
 * EXPORTED because it is a CLAUSE of this module, not a detail: a test that would recopy it
 * as a literal would not see its change.
 */
export const PAD_BETWEEN_FRAMES = 1 / 64

/** The pad and the uncertainty window of one of its occupations: what is queried. */
interface PadWindow {
  cx: number
  cy: number
  lo: number
  hi: number
}

/**
 * refinePadPresence — the same pads, with their uncertainty brought back to the instants when someone
 * COULD have taken the weapon.
 *
 * REFERENCE PRESERVED WHEN NOTHING CHANGES: a pad of which no occupation moves is returned
 * AS IS, and the array itself is recreated only if at least one pad has changed. The callers
 * memoize on the identity of the array; recreating one on each call would repaint the scene
 * for nothing.
 */
export function refinePadPresence(
  pads: readonly ReplayWeaponPadReady[],
  tracks: readonly ReplayTrackReady[],
): readonly ReplayWeaponPadReady[] {
  if (pads.length === 0 || tracks.length === 0) return pads
  let touche = false
  const out = pads.map((pad) => {
    const presence = refineOccupancies(pad, tracks)
    if (presence === pad.presence) return pad
    touche = true
    return { ...pad, presence }
  })
  return touche ? out : pads
}

/**
 * refineOccupancies renders the occupations of ONE pad, or the original array if none moves.
 *
 * A WINDOW NEVER CLOSED STAYS TOUCHED NOT AT ALL (`tHigh <= tLow`): there is nothing to refine where
 * no absence has been proven — the pad is already full to the end, and touching it
 * would rewrite the sentinel that `padStateAt` reads.
 */
function refineOccupancies(
  pad: ReplayWeaponPadReady,
  tracks: readonly ReplayTrackReady[],
): ReplayWeaponPadReady['presence'] {
  let touche = false
  const out = pad.presence.map((occ) => {
    if (occ.tHigh <= occ.tLow) return occ
    const win = { cx: pad.x, cy: pad.y, lo: occ.tLow, hi: occ.tHigh }
    const tLow = refinedLow(win, tracks)
    if (tLow === occ.tLow) return occ
    touche = true
    return { ...occ, tLow }
  })
  return touche ? out : pad.presence
}

/**
 * refinedLow — the new bound of proven presence for an open window.
 *
 * NO APPROACH: the bound settles just before `tHigh` (cf. PAD_BETWEEN_FRAMES) — the pad
 * stays full up to the proof of absence, which keeps all its rights.
 *
 * AN APPROACH AT `t`: the bound becomes the LAST FRAME BEFORE `t`. It never DESCENDS —
 * refining can only add certainty, never remove any.
 */
function refinedLow(win: PadWindow, tracks: readonly ReplayTrackReady[]): number {
  const t = firstApproach(win, tracks)
  if (t === null) return win.hi - PAD_BETWEEN_FRAMES
  // `Math.ceil(t) - 1` is the greatest integer STRICTLY less than `t`: at this frame, the
  // player is not yet at the pad. It is a frame of caution (the approach happens AFTER
  // it), and it goes in the right direction: one never asserts a presence at a frame where the
  // pickup could have started.
  //
  // NO CEILING TO WRITE, and that is one less that would lie (adversarial review of
  // 2026-08-27): `t` comes from a segment CUT to the window, so `t <= hi`; the bounds being
  // integers by contract, `ceil(t) - 1 <= hi - 1`. A `Math.min(..., win.hi)` was therefore
  // unreachable — and worse, it would have silently returned `hi` (the sentinel « never emptied »)
  // the day the clip would disappear, instead of letting the regression be seen. The test case
  // « a segment that touches only AFTER the window » is the net that keeps the clip in place.
  return Math.max(win.lo, Math.ceil(t) - 1)
}

/**
 * firstApproach — the instant (in frames, interpolated) at which a player enters first within the radius
 * of the pad during the window, or null if no one enters it.
 *
 * THE POINTS OF A TRACK ARE SAMPLED, and that is the whole trap: testing the distance
 * AT THE POINTS ONLY lets through the player who crosses the pad between two samples. One tests
 * then the SEGMENT between two consecutive points — the trajectory as the replay draws it.
 *
 * THE REPLICATION HOLE FALLS UNDER THE SAME ARGUMENT (adversarial review of 2026-08-27). When
 * a life survives a long hole (up to ~5 s without replicated position), the segment traces a
 * STRAIGHT CHORD that the player did not necessarily travel — and this chord can graze a pad
 * without a real pass. One does not correct, and the reason is the coherence of the screen: the replay
 * DRAWS this same chord, the player's marker travels it under the reader's eyes. Saying
 * « uncertain » where the screen shows someone passing is coherent; the opposite would be an
 * invisible doubt. Frequency not measured — recorded in Findings.
 *
 * THE SEARCH IS BOUNDED BY THE WINDOW: the points of a track are sorted, a dichotomy
 * gives the first of the window, and one goes back ONE point to catch the segment that ENTERS it.
 * That is what makes the pass tractable — a window lasts a few seconds, a track a whole
 * match.
 */
function firstApproach(win: PadWindow, tracks: readonly ReplayTrackReady[]): number | null {
  let best: number | null = null
  for (const track of tracks) {
    const pts = track.points
    if (pts.length === 0) continue
    if (pts.length === 1) {
      const only = pts[0]
      if (only.t >= win.lo && only.t <= win.hi && withinRadius(only.x - win.cx, only.y - win.cy)) {
        best = best === null ? only.t : Math.min(best, only.t)
      }
      continue
    }
    let i = lowerBound(pts, win.lo)
    if (i > 0) i -= 1 // the segment that ENTERS the window starts from the previous point
    for (; i + 1 < pts.length && pts[i].t <= win.hi; i++) {
      const t = segmentTouch(pts[i], pts[i + 1], win)
      if (t !== null && (best === null || t < best)) best = t
    }
  }
  return best
}

/** lowerBound — the rank of the first point whose instant reaches `t` (dichotomy). */
function lowerBound(pts: ReplayTrackReady['points'], t: number): number {
  let lo = 0
  let hi = pts.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (pts[mid].t < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** withinRadius — is the point within the approach radius (2D distance, world)? */
function withinRadius(dx: number, dy: number): boolean {
  return dx * dx + dy * dy <= PAD_APPROACH_RADIUS_M * PAD_APPROACH_RADIUS_M
}

/**
 * segmentTouch — the first instant at which the segment [a, b], CUT to the window, enters the
 * radius of the pad, or null.
 *
 * THE SEGMENT IS CUT BEFORE BEING TESTED: a player who grazes the pad one second AFTER the
 * proof of absence says nothing about the disappearance, and counting it would advance the bound wrongly.
 */
function segmentTouch(
  a: ReplayTrackReady['points'][number],
  b: ReplayTrackReady['points'][number],
  win: PadWindow,
): number | null {
  const [p, q] = a.t <= b.t ? [a, b] : [b, a]
  const d0 = Math.max(p.t, win.lo)
  const d1 = Math.min(q.t, win.hi)
  if (d1 < d0) return null
  const [ax, ay] = pointAt(p, q, d0)
  const [bx, by] = pointAt(p, q, d1)
  const u = firstWithin(ax - win.cx, ay - win.cy, bx - ax, by - ay)
  return u === null ? null : d0 + u * (d1 - d0)
}

/** pointAt — the position on the segment [p, q] at the instant `t`. Zero duration: the start. */
function pointAt(
  p: ReplayTrackReady['points'][number],
  q: ReplayTrackReady['points'][number],
  t: number,
): [number, number] {
  if (q.t <= p.t) return [p.x, p.y]
  const u = (t - p.t) / (q.t - p.t)
  return [p.x + u * (q.x - p.x), p.y + u * (q.y - p.y)]
}

/**
 * firstWithin — the smallest `u` of [0, 1] for which `p + u·d` is within the radius, or null.
 *
 * IT IS A SECOND DEGREE EQUATION, and it is its FIRST root that is needed, not the minimal distance:
 * what is dated is the ENTRY into the radius, not the closest point of the pass.
 */
function firstWithin(px: number, py: number, dx: number, dy: number): number | null {
  const a = dx * dx + dy * dy
  const c = px * px + py * py - PAD_APPROACH_RADIUS_M * PAD_APPROACH_RADIUS_M
  if (a === 0) return c <= 0 ? 0 : null
  const b = 2 * (px * dx + py * dy)
  const disc = b * b - 4 * a * c
  if (disc < 0) return null
  const root = Math.sqrt(disc)
  const u0 = (-b - root) / (2 * a)
  const u1 = (-b + root) / (2 * a)
  if (u1 < 0 || u0 > 1) return null
  return Math.max(u0, 0)
}
