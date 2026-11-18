// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * tracks3d.ts — THE REPLAY'S TRACKS READ FOR THE 3D VIEW.
 *
 * Frame: Halo world units (1 u = 3.048 m, Z up). `toThree` converts to three.js / glTF axes
 * (Y up): Halo (x, y, z) -> (x, z, -y), the same conversion as the map's GLB.
 *
 * A track (`tracks[]`) is ONE life; a player is reassembled by their xuid. A point carries `t`
 * (frame index), x/y/z, and, when aim is replicated, `h` (heading, degrees, 0 = +X, 90 = +Y) and
 * `p` (pitch, degrees, positive upward, absent = level). `g` > 0 marks a replication gap BEFORE
 * the point: the position holds, it is not interpolated across.
 */
import { framesPerSecond } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import { covers } from '../model/replaySpans'
import { fineLifePoints } from './fineTracks3d'
import { bracketAt, gaitAt, lifeDistances, type Gait } from './gait3d'
import { EYE_IN_DURATION, EYE_OUT_DURATION, eyeDrop, mergeIntervals, NO_INTERVALS, type EyeInterval } from './eye3d'
import { postureFilm } from './posturesFilm3d'
import { NO_SHIELD_FX, shieldFxAt, shieldSamplesOf, type ShieldFx, type ShieldSamples } from './shields3d'

export type Vec3 = [number, number, number]

/** Meters per world unit of the replay and the map. */
export const M_PER_U = 3.048

/** metersToU — a length declared in METERS (a 2D screen choice calibrated on the game), in world units. */
export function metersToU(m: number): number {
  return m / M_PER_U
}

export function toThree(x: number, y: number, z: number): Vec3 {
  return [x, z, -y]
}

export function aimDirThree(hDeg: number, pDeg: number): Vec3 {
  const h = (hDeg * Math.PI) / 180
  const p = (pDeg * Math.PI) / 180
  return toThree(Math.cos(p) * Math.cos(h), Math.cos(p) * Math.sin(h), Math.sin(p))
}

export interface LifePoint {
  t: number
  x: number
  y: number
  z: number
  g: number
  h: number
  p: number
  aim: boolean
}

/** A life as the view reads it: its slot, its points (aim completed), and their distances. */
export interface LifeView {
  t1: number
  slot: number
  pts: readonly LifePoint[]
  dist: readonly number[]
}

interface Life extends LifeView {
  slot: number
  t0: number
  t1: number
  pts: LifePoint[]
  /** The cumulative ground distance at each point (`gait3d.lifeDistances`). */
  dist: number[]
  /** The life's shield measurements (`shields3d`). */
  shield: ShieldSamples
}

/** A player's state at a (fractional) frame. */
export interface PlayerState3d {
  x: number
  y: number
  z: number
  h: number
  p: number
  crouch: boolean
  /** The eye's drop in world units at this frame (crouch AND slide, faded, `eye3d`). */
  dropOeil: number
  /** This life's biped slot. */
  slot: number
}

export interface Player3d {
  xuid: string
  name: string
  team: number
}

export interface Tracks3d {
  players: Player3d[]
  /** The player's state at frame `f`, or null if not alive. */
  sample(xuid: string, f: number): PlayerState3d | null
  /** The state of the biped at slot `slot` at frame `f` (a slot serves one life at a time). */
  sampleSlot(slot: number, f: number): PlayerState3d | null
  /** The player's gait at frame `f` (speed, direction, distance of their life), null if not alive. */
  gait(xuid: string, f: number): Gait | null
  /** The player's life covering frame `f` (the same object on every call), null outside a life. */
  life(xuid: string, f: number): LifeView | null
  /** What the body shows of the shield at frame `f` (`shields3d`), nothing outside a life; written into `out`. */
  shield(xuid: string, f: number, out: ShieldFx): ShieldFx
  /** The state at the end of the last life finished before `f` (the death position). */
  lastLifeBefore(xuid: string, f: number): PlayerState3d | null
  /** The end frame of the last life finished before `f`, null if there is none. */
  lifeEndBefore(xuid: string, f: number): number | null
  /** The state at the start of the first life beginning after `f` (first spawn). */
  firstLifeAfter(xuid: string, f: number): PlayerState3d | null
  /** All of a player's published points. */
  allPoints(xuid: string): LifePoint[]
}

export function buildTracks3d(doc: ReplayDocumentReady): Tracks3d {
  const roster = new Map(doc.roster.map((r) => [r.xuid, r]))
  const fps = framesPerSecond(doc)
  const lives = new Map<string, Life[]>()
  // Per slot, every published life, bots included (they have no xuid but they shoot).
  const bySlot = new Map<number, Life[]>()
  for (const tr of doc.tracks) {
    if (tr.points.length === 0) continue
    const life = prepareLife(tr)
    bySlot.set(tr.slot, [...(bySlot.get(tr.slot) ?? []), life])
    if (!tr.xuid) continue
    const list = lives.get(tr.xuid) ?? []
    list.push(life)
    lives.set(tr.xuid, list)
  }
  for (const ls of lives.values()) ls.sort((a, b) => a.t0 - b.t0)

  const crouchBySlot = new Map<number, ReturnType<typeof postureFilm>[]>()
  for (const s of doc.stances) {
    if (s.kind !== 'crouch') continue
    const list = crouchBySlot.get(s.slot) ?? []
    list.push(postureFilm(s, doc))
    crouchBySlot.set(s.slot, list)
  }
  const crouching = (life: Life, f: number) =>
    (crouchBySlot.get(life.slot) ?? []).some((s) => covers(s.intervalle, f) && f !== s.fin)
  // The eye drops crouched as in a slide: the union of the slot's two postures, merged once per
  // document, then read by binary search (`eye3d`).
  const eyeBySlot = new Map<number, EyeInterval[]>()
  for (const s of doc.stances) {
    if (s.kind !== 'crouch' && s.kind !== 'slide') continue
    const film = postureFilm(s, doc)
    const list = eyeBySlot.get(s.slot) ?? []
    // The millisecond end is exclusive; without milliseconds, the end frame is inclusive.
    list.push({ t0: film.t0, end: film.fin ?? film.t1 + 1 })
    eyeBySlot.set(s.slot, list)
  }
  for (const [slot, list] of eyeBySlot) eyeBySlot.set(slot, mergeIntervals(list))
  const eyeEntry = EYE_IN_DURATION * fps
  const eyeExit = EYE_OUT_DURATION * fps
  const eyeDropFor = (slot: number, f: number) =>
    eyeDrop(eyeBySlot.get(slot) ?? NO_INTERVALS, f, eyeEntry, eyeExit)

  const players = [...lives.keys()].map((xuid) => {
    const r = roster.get(xuid)
    return { xuid, name: r?.name || xuid, team: r?.team ?? -1 }
  })
  players.sort((a, b) => a.team - b.team || a.name.localeCompare(b.name))

  return {
    players,
    sample(xuid, f) {
      for (const life of lives.get(xuid) ?? []) {
        if (covers(life, f)) return sampleLife(life, f, crouching(life, f), eyeDropFor(life.slot, f))
      }
      return null
    },
    sampleSlot(slot, f) {
      for (const life of bySlot.get(slot) ?? []) {
        if (covers(life, f)) return sampleLife(life, f, crouching(life, f), eyeDropFor(life.slot, f))
      }
      return null
    },
    gait(xuid, f) {
      const life = (lives.get(xuid) ?? []).find((l) => covers(l, f))
      return life ? gaitAt(life.pts, life.dist, f, fps) : null
    },
    life(xuid, f) {
      return (lives.get(xuid) ?? []).find((l) => covers(l, f)) ?? null
    },
    shield(xuid, f, out) {
      const life = (lives.get(xuid) ?? []).find((l) => covers(l, f))
      return life ? shieldFxAt(life.shield, f, fps, out) : Object.assign(out, NO_SHIELD_FX)
    },
    lastLifeBefore(xuid, f) {
      let best: Life | null = null
      for (const life of lives.get(xuid) ?? []) if (life.t1 < f) best = life
      return best ? sampleLife(best, best.t1, false, 0) : null
    },
    lifeEndBefore(xuid, f) {
      let end: number | null = null
      for (const life of lives.get(xuid) ?? []) if (life.t1 < f) end = life.t1
      return end
    },
    firstLifeAfter(xuid, f) {
      const next = (lives.get(xuid) ?? []).find((life) => life.t0 > f)
      return next ? sampleLife(next, next.t0, false, 0) : null
    },
    allPoints(xuid) {
      return (lives.get(xuid) ?? []).flatMap((l) => l.pts)
    },
  }
}

/**
 * prepareLife completes aim point by point: a point without `h` reuses the last known aim (aim
 * is only published when replicated), the first points with no aim take the first known one.
 */
function prepareLife(tr: ReplayDocumentReady['tracks'][number]): Life {
  const raw = tr.points.map((p) => ({
    t: p.t, x: p.x, y: p.y, z: p.z ?? 0, g: p.g ?? 0,
    h: p.h, p: p.h !== undefined ? (p.p ?? 0) : undefined, aim: p.h !== undefined,
  }))
  const first = raw.find((q) => q.h !== undefined)
  let h = first?.h ?? 0
  let pp = first?.p ?? 0
  let pts: LifePoint[] = raw.map((q) => {
    if (q.h !== undefined) {
      h = q.h
      pp = q.p ?? 0
    }
    return { ...q, h, p: pp }
  })
  // At the film's own rate when the document carries it (schema 109, `fineTracks3d`), else the grid.
  if (tr.fullRate) pts = fineLifePoints(tr.fullRate)
  const t0 = tr.startFrame ?? pts[0].t
  const t1 = tr.endFrame ?? pts[pts.length - 1].t
  return { slot: tr.slot, t0, t1, pts, dist: lifeDistances(pts), shield: shieldSamplesOf(tr.points) }
}

function sampleLife(life: Life, f: number, crouch: boolean, dropOeil: number): PlayerState3d {
  const { lo, hi, u } = bracketAt(life.pts, f)
  return stateOf(life.pts[lo], life.pts[hi], u, { crouch, dropOeil }, life.slot)
}

function stateOf(a: LifePoint, b: LifePoint, u: number, pose: { crouch: boolean; dropOeil: number }, slot: number): PlayerState3d {
  const lerp = (x: number, y: number) => x + (y - x) * u
  const dh = ((b.h - a.h + 540) % 360) - 180
  return { x: lerp(a.x, b.x), y: lerp(a.y, b.y), z: lerp(a.z, b.z), h: a.h + dh * u, p: lerp(a.p, b.p), ...pose, slot }
}
