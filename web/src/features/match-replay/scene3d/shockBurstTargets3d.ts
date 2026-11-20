// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shockBurstTargets3d.ts — WHERE A PULL'S ROUNDS LAND ON A PLAYER, for the game look of the shock
 * shot (`Shots3dLayer.drawBurstGame`): the film's records grouped into pulls and paired with the
 * shooter's damages (`shockBurst3d`), and, for each round that hit, a point on its victim.
 *
 * THE POINT: the victim's head when the pull is the one that killed them by a headshot (the feed's
 * kill of that victim by that shooter, `headshot` true, the victim's life ending at the pull's last
 * hit): the Shock Rifle kills by headshot only when every round of the pull hits the head (Jordan,
 * 2026-11-20, of the game's rule). Any other hit lands on the body. The film says neither where a
 * round struck nor which part it struck.
 *
 * FILLS, not read: the head's center at the eye height and the body's at its capsule center
 * (`body3d`), the point on their surface toward the shooter's eye (a head radius HEAD_RADIUS, the
 * body capsule's radius), its normal toward the shooter; the victim's pose at the damage's frame (the
 * last frame they were alive when the damage is past it), the point held there afterward.
 */
import * as THREE from 'three'

import { frameToMs, msToFrames } from '@/lib/replay/replayLogic'

import type { ShotFxEntry } from '../model/shotFx'
import type { ActionContext } from './actionScene3d'
import { BODY_CENTER, BODY_RADIUS, EYE_HEIGHT } from './body3d'
import { feetOf } from './shieldImpacts3d'
import { burstHits, groupBursts, type Burst, type BurstDamage, type BurstSpec, type RoundHit } from './shockBurst3d'

/** A Spartan head's radius (u, ~13 cm): FILL, the head's shape is not read. */
export const HEAD_RADIUS = 0.045
/** A headshot kill pairs with a pull whose victim's life ends this many frames from its last hit. */
const KILL_PULL_FRAMES = 2
/** And with the feed's kill this long after (s), as the deaths' feed lag (`deaths3d`). */
const KILL_FEED_SECONDS = 1

/** A pull, its rounds' hits and where each lands (null: the round hit no player). */
export interface BurstShots {
  burst: Burst
  hits: (RoundHit | null)[]
  /** The pull killed its victim by a headshot: its hits land on the head. */
  head: boolean
  targets: ({ point: THREE.Vector3; normal: THREE.Vector3 } | null)[]
  /** A missing round's muzzle per view and rank (`fp:1`), set on first draw (its hit is traced once per start). */
  froms: Map<string, THREE.Vector3>
}

/** The kills the feed gives, as `Action3dInputs.kills` (the killer's and victim's xuids, the instant). */
interface FeedKill {
  xuid?: string | null
  victimXuid?: string | null
  headshot?: boolean | null
  replayMs: number
}

/** xuidAt: the player of slot `slot` at frame `frame` (the life covering it), null without one. */
function xuidAt(ctx: Pick<ActionContext, 'doc'>, slot: number, frame: number): string | null {
  const t = ctx.doc.tracks.find((x) => x.slot === slot && (x.startFrame ?? 0) <= frame + KILL_PULL_FRAMES && (x.endFrame ?? Infinity) >= frame - KILL_PULL_FRAMES)
  return t?.xuid ?? null
}

/** lifeEnd: the last frame of the life of slot `slot` around `frame`, null without one. */
function lifeEnd(ctx: Pick<ActionContext, 'doc'>, slot: number, frame: number): number | null {
  const t = ctx.doc.tracks.find((x) => x.slot === slot && (x.startFrame ?? 0) <= frame && x.endFrame !== undefined && x.endFrame >= frame - KILL_PULL_FRAMES)
  return t?.endFrame ?? null
}

/**
 * headshotPull: pull `b` (its `hits`) killed its victim by a headshot: a hit victim whose life ends
 * within KILL_PULL_FRAMES of the pull's last hit, and the feed's headshot kill of them by the shooter
 * within KILL_FEED_SECONDS.
 */
export function headshotPull(ctx: Pick<ActionContext, 'doc'>, b: Burst, hits: readonly (RoundHit | null)[], kills: readonly FeedKill[]): boolean {
  const last = hits.reduce<RoundHit | null>((m, h) => (h && (!m || h.frame >= m.frame) ? h : m), null)
  if (!last) return false
  const end = lifeEnd(ctx, last.victim, last.frame)
  if (end === null || Math.abs(end - last.frame) > KILL_PULL_FRAMES) return false
  const killer = xuidAt(ctx, b.leader.slot, b.leader.frame)
  const victim = xuidAt(ctx, last.victim, end)
  if (!killer || !victim) return false
  const lag = msToFrames(KILL_FEED_SECONDS * 1000, ctx.doc)
  return kills.some((k) => k.headshot === true && k.xuid === killer && k.victimXuid === victim && Math.abs(msToFrames(k.replayMs, ctx.doc) - end) <= lag + KILL_PULL_FRAMES)
}

/** stateNear: slot `slot`'s pose at `frame`, else at the frames before (a damage past the life's end). */
function stateNear(ctx: Pick<ActionContext, 'slotState'>, slot: number, frame: number) {
  for (let f = frame; f >= frame - KILL_PULL_FRAMES; f--) {
    const s = ctx.slotState(slot, f)
    if (s) return s
  }
  return null
}

/** hitPoint: where a hit on slot `victim` at `frame` lands, seen from the shooter (FILLS, header). */
export function hitPoint(ctx: Pick<ActionContext, 'slotState' | 'originAboveFloor'>, shooter: number, victim: number, frame: number, head: boolean): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
  const v = stateNear(ctx, victim, frame)
  const s = stateNear(ctx, shooter, frame)
  if (!v || !s) return null
  const center = feetOf(v, ctx.originAboveFloor, new THREE.Vector3())
  center.y += head ? EYE_HEIGHT - v.dropOeil : BODY_CENTER
  const eye = feetOf(s, ctx.originAboveFloor, new THREE.Vector3())
  eye.y += EYE_HEIGHT - s.dropOeil
  const normal = eye.sub(center)
  if (normal.lengthSq() < 1e-12) return null
  normal.normalize()
  return { point: center.addScaledVector(normal, head ? HEAD_RADIUS : BODY_RADIUS), normal }
}

/**
 * buildBursts groups the burst weapons' shot records (`sorted` by time; `specOf` the pull their
 * weapon fires, null for any other shot) into pulls per shooter and weapon, pairs each pull's rounds
 * with the shooter's damages, and places their hits. Every record of a pull maps to the same entry.
 */
export function buildBursts(
  ctx: Pick<ActionContext, 'doc' | 'slotState' | 'originAboveFloor' | 'inputs'>,
  sorted: readonly ShotFxEntry[],
  specOf: (e: ShotFxEntry) => BurstSpec | null,
): Map<ShotFxEntry, BurstShots> {
  const msPerFrame = frameToMs(1, ctx.doc)
  const groups = new Map<string, { spec: BurstSpec; list: ShotFxEntry[] }>()
  for (const e of sorted) {
    if (e.vehicleShot) continue
    const spec = specOf(e)
    if (!spec) continue
    const key = `${e.slot}:${spec.shots}:${spec.roundsPerSecond}`
    const g = groups.get(key) ?? { spec, list: [] }
    g.list.push(e)
    groups.set(key, g)
  }
  const damages = new Map<number, BurstDamage[]>()
  for (const d of ctx.doc.damages) {
    if (d.by == null) continue
    const list = damages.get(d.by) ?? []
    list.push(d)
    damages.set(d.by, list)
  }
  for (const list of damages.values()) list.sort((p, q) => p.t - q.t)
  const used = new Map<number, Set<BurstDamage>>()
  const kills = ctx.inputs().kills
  const out = new Map<ShotFxEntry, BurstShots>()
  for (const { spec, list } of groups.values()) {
    for (const burst of groupBursts(list, spec, msPerFrame)) {
      const shooter = burst.leader.slot
      const u = used.get(shooter) ?? new Set<BurstDamage>()
      used.set(shooter, u)
      const hits = burstHits(burst, damages.get(shooter) ?? [], u)
      const head = headshotPull(ctx, burst, hits, kills)
      const targets = hits.map((h) => (h ? hitPoint(ctx, shooter, h.victim, h.frame, head) : null))
      const entry: BurstShots = { burst, hits, head, targets, froms: new Map() }
      for (const r of burst.rounds) if (r.e) out.set(r.e, entry)
    }
  }
  return out
}
