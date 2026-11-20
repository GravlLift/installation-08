// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * deaths3d.ts — DEATHS IN THE 3D SCENE: a cross on the ground where the victim fell, the killer
 * and the kill's weapon above it, and, for the first moment, a line from the killer to their
 * victim.
 *
 * Kills are the feed's, resolved once per page; the cross lasts as long as the one in 2D.
 * Positions go through the same resolver as 2D (`buildCarrierPosAt`): a player killed while
 * mounted falls onto their vehicle. The line is only drawn when both positions are re-read (never
 * a made-up axis), only for the duration of a shot, and only when the drawer turns on shot lines
 * (`aids3d.shotLines`): the game itself does not show it.
 *
 * The label reads like the feed: "killer › victim · weapon". The weapon is the one the backend
 * gives the kill (`weaponLabel`), empty for melee and grenades. An unknown killer leaves the cross
 * alone. Cross and label are an analysis aid (`aids3d.deathMarkers`, off by default): the game does
 * not place them on the map. The 2D drawer's deaths toggle (`show.kills`) gates both.
 *
 * The victim's body (`corpses3d`) falls at the end of their life into a ragdoll pushed by whatever
 * killed them (baked on death, `ragdollBakery3d`; by the game's death clips, `fall3d`, until it is
 * ready), and stays where it settled for as long as the cross; it belongs to the world, not the
 * drawer: hiding deaths only clears the cross, the line and the label.
 *
 * How long a death lingers is the page's `deathHoldFrames`, unless a playing camera script sets
 * `deathHoldMs` (`deathHoldFramesOf`): a shot can keep two bodies on the floor together.
 */
import * as THREE from 'three'

import { msToFrames } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import { familyOf } from '../layers/shotEffects'
import { buildCarrierPosAt } from '../model/carrierPosition'
import type { ReplayKill } from '../model/killFeedLogic'
import { InstancePool, LabelPool, SegmentPool, firstFrom } from './actionKit'
import type { ActionContext, ActionLayer3d } from './actionScene3d'
import { BODY_CENTER, TAG_HEIGHT } from './body3d'
import { Corpses3d, type Corpse } from './corpses3d'
import { bodyPosition } from './deathCamera3d'
import { fallKindOf, type FallKind } from './fall3d'
import { FRAME_BUDGET_MS, RagdollBakery, type BakeryStats } from './ragdollBakery3d'
import { aimDirThree, toThree } from './tracks3d'

const CROSS_ARM = new THREE.Vector3(0.5, 0.03, 0.08)
const CROSS_LIFT = 0.03
const LINK_RADIUS = 0.01
const LABEL_LIFT = TAG_HEIGHT * 0.6
const TURN = [new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 4)]

export interface Death3d {
  frame: number
  killer: string
  victim: string
  /** Victim's feet (three axes). */
  at: THREE.Vector3
  /** Killer's feet, only when both positions are re-read. */
  from: THREE.Vector3 | null
  weapon: string
  /**
   * The body: the frame where the victim is no longer alive (start of the fall) and its fall; null
   * when the life that ends is not re-read near the kill (never a body next to a live player).
   */
  body: { start: number; fall: Corpse } | null
}

/** The maximum lag between the feed's kill and the end of its victim's life (s). */
const DEATH_LAG_SECONDS = 1
/** The step of the search for that end (frames). */
const DEATH_LAG_STEP = 0.25
/** Below this (u), killer and victim overlap: the push direction cannot be read between them. */
const MIN_PUSH = 0.05

export class Deaths3dLayer implements ActionLayer3d {
  readonly labels: LabelPool
  private readonly crosses: InstancePool
  private readonly links: SegmentPool
  private readonly corpses: Corpses3d
  private readonly bakery: RagdollBakery
  private source: readonly ReplayKill[] | null = null
  private deaths: Death3d[] = []
  private readonly a = new THREE.Vector3()
  private readonly b = new THREE.Vector3()
  private readonly ctx: ActionContext

  constructor(ctx: ActionContext) {
    this.ctx = ctx
    this.labels = new LabelPool(ctx.root)
    this.crosses = new InstancePool(ctx.root, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), 128)
    this.links = new SegmentPool(ctx.root, new THREE.MeshBasicMaterial({ toneMapped: false }), 64)
    this.corpses = new Corpses3d(ctx.root, ctx.probeAt, ctx.baked ?? null)
    this.bakery = new RagdollBakery(ctx)
  }

  update(frame: number): void {
    const inputs = this.ctx.inputs()
    this.labels.begin()
    this.crosses.begin()
    this.links.begin()
    this.corpses.begin(this.ctx.spartanModel())
    this.syncDeaths()
    const hold = this.holdFrames()
    const fps = Math.max(1, inputs.framesPerSecond)
    const [from, to] = lingeringRange(this.deaths, frame, hold)
    for (let i = from; i < to; i++) {
      const d = this.deaths[i]
      if (inputs.show.kills) this.draw(d, frame - d.frame, inputs.shotHoldFrames)
      if (d.body && d.body.start <= frame) this.drawBody(d, d.body, (frame - d.body.start) / fps)
    }
    this.labels.end()
    this.crosses.end()
    this.links.end()
    this.corpses.end()
    this.bakery.pump(frame, hold, performance.now() + FRAME_BUDGET_MS)
  }

  /** settle bakes, to completion, the bodies visible at `frame` (the video export, `ActionScene3d.settle`). */
  settle(frame: number): void {
    this.syncDeaths()
    this.bakery.bakeVisible(frame, this.holdFrames())
  }

  /** holdFrames: how long a death lingers now, the playing script's `deathHoldMs` first (`deathHoldFramesOf`). */
  private holdFrames(): number {
    return deathHoldFramesOf(this.ctx.inputs().deathHoldFrames, this.ctx.scriptDeathHoldMs?.() ?? null, this.ctx.doc)
  }

  /** syncDeaths rebuilds the deaths when the page's kill list changed. */
  private syncDeaths(): void {
    const kills = this.ctx.inputs().kills
    if (kills === this.source) return
    this.source = kills
    this.deaths = buildDeaths3d(this.ctx, kills)
    this.bakery.setDeaths(this.deaths)
  }

  /** Prepares a copy of every possible victim with the layer's tint. */
  prepareCorpses(): THREE.Object3D[] {
    this.corpses.begin(this.ctx.spartanModel())
    return this.ctx.tracks.players.flatMap((p) => {
      const { key, tint } = this.corpseStyle(p.xuid)
      const root = this.corpses.prepare(key, tint, this.ctx.dressOf(p.xuid))
      return root ? [root] : []
    })
  }

  private corpseStyle(xuid: string): { key: string; tint: THREE.Color } {
    const inputs = this.ctx.inputs()
    const css = inputs.colorOfXuid(xuid) ?? inputs.inks.shot
    return { key: `${css}|${xuid}`, tint: this.ctx.ink.of(css) }
  }

  /** ragdollStats: the measurements of the ragdoll bakes done (`ragdollBakery3d`). */
  ragdollStats(): BakeryStats {
    return this.bakery.stats()
  }

  /**
   * corpseFeet: the feet of victim `xuid`'s ragdoll body at frame `frame` (three axes), written
   * into `out`; null without a body at that frame. Serves the death camera (`deathCamera3d`).
   */
  corpseFeet(xuid: string, frame: number, out: THREE.Vector3): THREE.Vector3 | null {
    const d = this.currentBody(xuid, frame)
    if (!d || !d.body) return null
    bodyPosition(d.body.fall, (frame - d.body.start) / Math.max(1, this.ctx.inputs().framesPerSecond), this.bakery.get(d), out)
    return out
  }

  /**
   * currentBody: the death of `xuid` whose body is the most recent to start before `frame`, null
   * without a body. Between two deaths the player is alive, so the most recent body is the current one.
   */
  private currentBody(xuid: string, frame: number): Death3d | null {
    let best: Death3d | null = null
    let bestStart = -Infinity
    for (const d of this.deaths) {
      if (d.victim !== xuid || !d.body || d.body.start > frame) continue
      if (d.body.start > bestStart) { best = d; bestStart = d.body.start }
    }
    return best
  }

  dispose(): void {
    this.labels.dispose()
    this.crosses.dispose()
    this.links.dispose()
    this.corpses.dispose()
    this.bakery.dispose()
  }

  private drawBody(d: Death3d, body: NonNullable<Death3d['body']>, t: number): void {
    const { key, tint } = this.corpseStyle(d.victim)
    this.corpses.add(body.fall, t, tint, key, this.ctx.dressOf(d.victim), this.bakery.get(d))
  }

  private draw(d: Death3d, age: number, linkFrames: number): void {
    const inputs = this.ctx.inputs()
    const css = inputs.colorOfXuid(d.killer) ?? inputs.inks.shot
    const color = this.ctx.ink.of(css)
    if (inputs.aids.shotLines && d.from && age <= linkFrames) {
      this.links.add(this.b.copy(d.from).setY(d.from.y + BODY_CENTER), this.a.copy(d.at).setY(d.at.y + BODY_CENTER), LINK_RADIUS, color)
    }
    if (!inputs.aids.deathMarkers) return
    const ground = this.a.copy(d.at).setY(d.at.y + CROSS_LIFT)
    for (const q of TURN) this.crosses.add(ground, q, CROSS_ARM, color)
    const text = deathText(inputs.nameOfXuid(d.killer), inputs.nameOfXuid(d.victim), d.weapon)
    if (text) this.labels.add(this.a.copy(d.at).setY(d.at.y + LABEL_LIFT), text, css)
  }
}

/**
 * deathText: a death's label, read like a feed line — "killer › victim · weapon". Without a
 * named killer, nothing: the cross alone. Without a named victim, the killer and the weapon.
 */
export function deathText(killer: string | null, victim: string | null, weapon: string): string | null {
  if (!killer) return null
  const who = victim ? `${killer} › ${victim}` : killer
  return weapon ? `${who} · ${weapon}` : who
}

/**
 * deathHoldFramesOf: how long a death (cross, label, body) lingers, in frames: the playing camera
 * script's `deathHoldMs` (document ms) when it sets one, else the page's `defaultFrames`; at least
 * one frame. A body past its ragdoll bake's end keeps the last baked pose (`poseBake` clamps).
 */
export function deathHoldFramesOf(
  defaultFrames: number,
  scriptHoldMs: number | null,
  doc: Pick<ReplayDocumentReady, 'frameIntervalMs'>,
): number {
  return Math.max(1, scriptHoldMs === null ? defaultFrames : msToFrames(scriptHoldMs, doc))
}

/**
 * lingeringRange: the indexes [from, to) of the deaths (sorted by frame) that linger at `frame`:
 * dead at or before it, no more than `hold` frames ago. A pure function of the frame.
 */
export function lingeringRange(deaths: readonly Pick<Death3d, 'frame'>[], frame: number, hold: number): [number, number] {
  const from = firstFrom(deaths, (d) => d.frame, frame - hold)
  let to = from
  while (to < deaths.length && deaths[to].frame <= frame) to++
  return [from, to]
}

/** buildDeaths3d: the located deaths, sorted by frame, feet placed on the map. */
export function buildDeaths3d(ctx: ActionContext, kills: readonly ReplayKill[]): Death3d[] {
  const { doc } = ctx
  const posOf = buildCarrierPosAt(doc)
  const seated = ctx.inputs().seatedOfXuid
  const out: Death3d[] = []
  for (const k of kills) {
    if (!k.victimXuid) continue
    const frame = deathFrame(ctx, k.victimXuid, Math.round(msToFrames(k.replayMs, doc)))
    const at = feetAt(ctx, posOf(k.victimXuid, frame), k.victimXuid, frame)
    if (!at) continue
    const from = seated(k.xuid, frame) ? feetAt(ctx, posOf(k.xuid, frame), k.xuid, frame) : null
    const kind = fallKindOf(k, familyOf(k.weaponKey ? ctx.doc.killEffects?.[k.weaponKey] : undefined))
    const body = bodyOf(ctx, k.victimXuid, frame, at, from, kind)
    out.push({ frame, killer: k.xuid, victim: k.victimXuid, at, from, weapon: k.weaponLabel, body })
  }
  return out.sort((p, q) => p.frame - q.frame)
}

/**
 * deathFrame: the frame of a victim's death whose kill the feed reports at `killFrame`. The feed
 * trails the end of life by a little: the death lands on that end when it precedes the kill by
 * less than `DEATH_LAG_SECONDS`, so the live body gives way to the ragdoll with no empty frame.
 */
function deathFrame(ctx: ActionContext, victim: string, killFrame: number): number {
  if (ctx.tracks.sample(victim, killFrame)) return killFrame
  const end = ctx.tracks.lifeEndBefore(victim, killFrame)
  const lag = DEATH_LAG_SECONDS * Math.max(1, ctx.inputs().framesPerSecond)
  return end !== null && killFrame - end <= lag ? end : killFrame
}

/**
 * bodyOf: a kill victim's body at frame `frame`. The fall starts at the end of their life
 * (searched up to `DEATH_LAG_SECONDS` after the kill), in the direction from the killer toward
 * them when both positions are re-read, toward their back otherwise.
 */
function bodyOf(
  ctx: ActionContext,
  victim: string,
  frame: number,
  at: THREE.Vector3,
  from: THREE.Vector3 | null,
  kind: FallKind,
): Death3d['body'] {
  const lag = DEATH_LAG_SECONDS * Math.max(1, ctx.inputs().framesPerSecond)
  let start = frame
  while (ctx.tracks.sample(victim, start)) {
    start += DEATH_LAG_STEP
    if (start > frame + lag) return null
  }
  const last = ctx.tracks.lastLifeBefore(victim, start)
  if (!last) return null
  const dir = from ? new THREE.Vector3(at.x - from.x, 0, at.z - from.z) : new THREE.Vector3()
  if (dir.length() < MIN_PUSH) {
    const [x, , z] = aimDirThree(last.h, 0)
    dir.set(-x, 0, -z)
  }
  start = ctx.tracks.life(victim, start - DEATH_LAG_STEP)?.t1 ?? start
  return { start, fall: { at, dir: dir.normalize(), h: last.h, kind } }
}

/** feetAt: a replay point (x, y) placed at the player's feet height, or on the ground otherwise. */
function feetAt(ctx: ActionContext, xy: { x: number; y: number } | null, xuid: string, frame: number): THREE.Vector3 | null {
  if (!xy) return null
  const [x, , z] = toThree(xy.x, xy.y, 0)
  const alive = ctx.playerFeet(xuid, frame)
  const fallen = alive ? null : ctx.tracks.lastLifeBefore(xuid, frame + 1)
  const y = alive?.y ?? (fallen ? fallen.z - ctx.originAboveFloor : ctx.ground.floorY(xy.x, xy.y, null))
  return y === null ? null : new THREE.Vector3(x, y, z)
}
