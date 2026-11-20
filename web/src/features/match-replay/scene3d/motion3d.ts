// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * motion3d.ts — A PLAYER'S SPARTAN MOTION AT ONE FRAME: what the film says about them, packed
 * for `clipSelect3d`, then the blend of game clips that plays it.
 *
 * Everything is read from the document, packed once: stances by slot and by kind, grenades by
 * slot, lethal melee strikes by killer (feed kills whose source is melee, `fall3d.fallKindOf`),
 * held-weapon changes by slot (looked up only at frames where the held weapon's reading can
 * change: weapon pickups, inventory, grabs and drops). The weapon class comes from the held
 * weapon's label (`weaponClass3d`); a skull or flag carrier takes the object's own class. A
 * life's locomotion PHASE is integrated point by point (ground distance / that point's blend's
 * stride) and kept per life: it depends only on the document.
 */
import { msToFrames } from '@/lib/replay/replayLogic'

import { familyOf } from '../layers/shotEffects'
import { carriedObjectAt } from '../model/weaponInHand'
import type { ReplayKill } from '../model/killFeedLogic'
import { covers } from '../model/replaySpans'
import type { ActionContext } from './actionScene3d'
import { actionsBySlot, reloadsBySlot, jumpFromAction } from './filmActions3d'
import { spartanClipsOf, type SpartanClips } from './clips3d'
import { newClipMix, type ClipMix } from './clipSample3d'
import {
  mixStride,
  selectClips,
  type MotionEvents,
  type MotionGait,
  type MotionInput,
  type MotionStances,
  type Span,
  type WeaponSwap,
} from './clipSelect3d'
import { dodgeShots, firstPersonUses, type DodgeShot, type UseShot } from './equipmentUse3d_logic'
import { fallKindOf } from './fall3d'
import { bracketAt, gaitAt, headingAt, smoothAt, type Bracket, type Gait } from './gait3d'
import { heldWeaponAt, type HeldWeapon3d } from './heldWeapon3d'
import { filmPosture } from './posturesFilm3d'
import { thrusterBursts } from './thruster3d_logic'
import type { LifeView } from './tracks3d'
import { CARRIED_OBJECT_CLASS, DEFAULT_WEAPON_CLASS, weaponClassOfKey, type WeaponClass } from './weaponClass3d'
import { weaponModelKey } from './weaponModels3d'

const STANCE_KINDS: Readonly<Record<string, keyof MotionStances>> = {
  crouch: 'crouch',
  sprint: 'sprint',
  slide: 'slide',
  clamber: 'clamber',
  jumpDerived: 'jump',
}
const NO_SPANS: readonly Span[] = []
const NO_FRAMES: readonly number[] = []
const NO_SWAPS: readonly WeaponSwap[] = []
const NO_DODGES: readonly DodgeShot[] = []
const NO_USES: readonly UseShot[] = []
const NO_STANCES: MotionStances = { crouch: NO_SPANS, sprint: NO_SPANS, slide: NO_SPANS, clamber: NO_SPANS, jump: NO_SPANS }

export class Motion3d {
  private readonly ctx: ActionContext
  private readonly held: (slot: number, frame: number) => HeldWeapon3d | null
  private readonly stances = new Map<number, MotionStances>()
  private readonly reloadStarts: Map<number, number[]>
  /** The instants where the hands leave the weapon (`reloadStarts`): a reload in progress stops there. */
  private readonly reloadCuts: Map<number, number[]>
  private readonly coups: Map<number, number[]>
  private readonly grenades = new Map<number, number[]>()
  private readonly swaps = new Map<number, readonly WeaponSwap[]>()
  private readonly phases = new WeakMap<LifeView, Float64Array>()
  private killSource: readonly ReplayKill[] | null = null
  private melee = new Map<string, number[]>()
  private readonly meleeFusion = new Map<string, readonly number[]>()
  private readonly gait: Gait = { speed: 0, heading: 0, distance: 0 }
  private readonly bracket: Bracket = { lo: 0, hi: 0, u: 0 }
  private readonly motion: MotionGait = { speed: 0, rel: 0, phase: 0 }
  private readonly events: MotionEvents = { melee: NO_FRAMES, grenade: NO_FRAMES, reload: NO_FRAMES, swaps: NO_SWAPS }
  private readonly input: MotionInput = {
    frame: 0, fps: 1, weapon: DEFAULT_WEAPON_CLASS, gait: null, stances: NO_STANCES, events: this.events,
  }
  private readonly scratch = newClipMix()
  private uses: { fps: number; dodges: Map<number, DodgeShot[]>; fp: Map<number, UseShot[]> } | null = null

  /** `held`: the weapon held by a slot at a frame (the one the scene shows). */
  constructor(ctx: ActionContext, held: (slot: number, frame: number) => HeldWeapon3d | null) {
    this.ctx = ctx
    this.held = held
    for (const s of ctx.doc.stances) {
      const kind = STANCE_KINDS[s.kind]
      if (!kind) continue
      let byKind = this.stances.get(s.slot)
      if (!byKind) {
        byKind = { crouch: [], sprint: [], slide: [], clamber: [], jump: [] }
        this.stances.set(s.slot, byKind)
      }
      ;(byKind[kind] as Span[]).push(filmPosture(s, ctx.doc))
    }
    const reloads = reloadsBySlot(ctx.doc)
    this.reloadStarts = reloads.starts
    this.reloadCuts = reloads.cuts
    this.coups = actionsBySlot(ctx.doc, 'melee')
    for (const [slot, starts] of actionsBySlot(ctx.doc, 'jump')) {
      let postures = this.stances.get(slot)
      if (!postures) {
        postures = { crouch: [], sprint: [], slide: [], clamber: [], jump: [] }
        this.stances.set(slot, postures)
      }
      for (const start of starts) {
        if (postures.jump.some((j) => covers({ t0: j.t0, t1: j.t1 + 1 }, start))) continue
        ;(postures.jump as Span[]).push(jumpFromAction(ctx.doc, ctx.tracks, slot, start))
      }
    }
    for (const byKind of this.stances.values()) for (const list of Object.values(byKind)) (list as Span[]).sort((a, b) => a.t0 - b.t0)
    for (const g of ctx.doc.grenades) this.grenades.set(g.slot, [...(this.grenades.get(g.slot) ?? []), g.t])
    for (const list of this.grenades.values()) list.sort((a, b) => a - b)
  }

  /**
   * at writes into `out` player `xuid`'s clip blend at frame `frame` (`aboard`: riding a
   * vehicle, idle only); null outside their life or while the animated Spartan isn't loaded.
   */
  at(xuid: string, frame: number, aboard: boolean, out: ClipMix, seatClip?: string | null): ClipMix | null {
    const source = this.ctx.spartanModel()
    const clips = source ? spartanClipsOf(source) : null
    const life = this.ctx.tracks.life(xuid, frame)
    if (!clips || !life) return null
    const seated = aboard && seatClip ? clips.get(seatClip) : undefined
    if (seated) {
      Object.assign(out.base[0], { clip: seated, time: 0, weight: 1, loop: false })
      out.baseCount = 1
      out.overCount = 0
      return out
    }
    const q = this.input
    q.frame = frame
    q.fps = Math.max(1, this.ctx.inputs().framesPerSecond)
    q.weapon = this.weaponClass(xuid, life.slot, frame)
    q.stances = this.stances.get(life.slot) ?? NO_STANCES
    q.gait = aboard ? null : this.gaitOf(life, frame, q.fps, clips)
    this.events.meleeStart = this.meleeOf(xuid, life.slot)
    this.events.melee = this.melee.get(xuid) ?? NO_FRAMES
    this.events.grenade = this.grenades.get(life.slot) ?? NO_FRAMES
    this.events.swaps = this.swapsOf(life.slot)
    this.events.reload = this.reloadAt(xuid, life, frame)
    this.events.dodges = this.usesAt(q.fps).dodges.get(life.slot) ?? NO_DODGES
    q.reloadClip = this.reloadClip(clips, life.slot, frame, q.weapon)
    return selectClips(q, clips, out)
  }

  /** The same stances feed the first-person animations. */
  postures(slot: number): MotionStances {
    return this.stances.get(slot) ?? NO_STANCES
  }

  /** Uses that play a first-person clip (`equipmentUse3d_logic`), by slot. */
  firstPersonUses(slot: number, fps: number): readonly UseShot[] {
    return this.usesAt(Math.max(1, fps)).fp.get(slot) ?? NO_USES
  }

  /** usesAt: the document's dodges and uses, read once per frame rate. */
  private usesAt(fps: number) {
    if (this.uses?.fps !== fps) {
      const heading = (slot: number, frame: number) => this.ctx.slotState(slot, frame)?.h ?? null
      const dodges = dodgeShots(thrusterBursts(this.ctx.doc, 1000 / fps), heading)
      this.uses = { fps, dodges, fp: firstPersonUses(this.ctx.doc, dodges) }
    }
    return this.uses
  }

  /** weaponClass: the held weapon's class; a carried objective object gives its own (`CARRIED_OBJECT_CLASS`). */
  private weaponClass(xuid: string, slot: number, frame: number): WeaponClass {
    const carried = carriedObjectAt(this.ctx.doc, xuid, frame)
    if (carried) return CARRIED_OBJECT_CLASS[carried]
    const held = this.held(slot, frame)
    return held ? weaponClassOfKey(this.ctx.doc.weaponLabels?.[held.id]?.key) : DEFAULT_WEAPON_CLASS
  }

  private gaitOf(life: LifeView, frame: number, fps: number, clips: SpartanClips): MotionGait {
    const g = gaitAt(life.pts, life.dist, frame, fps, this.gait)
    const br = bracketAt(life.pts, frame, this.bracket)
    const m = this.motion
    m.speed = g.speed
    // The body's heading and the phase on the body's own C1 curve (`gait3d.cubicAt`), so the
    // feet keep pace with a body that no longer changes speed at each point.
    m.rel = g.speed > 0 ? g.heading - headingAt(life.pts, br) : 0
    m.phase = smoothAt(life.pts, this.phaseOf(life, fps, clips), br)
    return m
  }

  /**
   * phaseOf: the locomotion phase (cycles) at each point of the life: each step's distance
   * divided by that point's blend's stride (rifle class: strides don't change from one class to
   * another). Computed once per life.
   */
  private phaseOf(life: LifeView, fps: number, clips: SpartanClips): Float64Array {
    const known = this.phases.get(life)
    if (known) return known
    const out = new Float64Array(life.pts.length)
    const fallback = clips.get('combat:rifle:locomote_run_front')?.stride ?? 1
    const g: Gait = { speed: 0, heading: 0, distance: 0 }
    const q: MotionInput = { frame: 0, fps, weapon: DEFAULT_WEAPON_CLASS, gait: null, stances: this.stances.get(life.slot) ?? NO_STANCES, events: { melee: NO_FRAMES, grenade: NO_FRAMES, reload: NO_FRAMES, swaps: NO_SWAPS } }
    const motion: MotionGait = { speed: 0, rel: 0, phase: 0 }
    for (let k = 1; k < life.pts.length; k++) {
      const p = life.pts[k]
      gaitAt(life.pts, life.dist, p.t, fps, g)
      motion.speed = g.speed
      motion.rel = g.heading - p.h
      q.frame = p.t
      q.gait = motion
      const stride = mixStride(selectClips(q, clips, this.scratch)) || fallback
      out[k] = out[k - 1] + (life.dist[k] - life.dist[k - 1]) / stride
    }
    this.phases.set(life, out)
    return out
  }

  /** meleeOf: non-lethal melee strikes, deduplicated against melee kills. */
  private meleeOf(xuid: string, slot: number): readonly number[] {
    const kills = this.ctx.inputs().kills
    if (kills !== this.killSource) {
      this.killSource = kills
      this.melee = new Map()
      this.meleeFusion.clear()
      for (const k of kills) {
        const family = familyOf(k.weaponKey ? this.ctx.doc.killEffects?.[k.weaponKey] : undefined)
        if (fallKindOf(k, family) !== 'melee') continue
        const frame = Math.round(msToFrames(k.replayMs, this.ctx.doc))
        this.melee.set(k.xuid, [...(this.melee.get(k.xuid) ?? []), frame])
      }
      for (const list of this.melee.values()) list.sort((a, b) => a - b)
    }
    const key = xuid + ':' + slot
    const known = this.meleeFusion.get(key)
    if (known) return known
    const lethal = this.melee.get(xuid) ?? NO_FRAMES
    const coups = (this.coups.get(slot) ?? NO_FRAMES).filter((t) =>
      this.ctx.tracks.life(xuid, t)?.slot === slot && !lethal.some((m) => Math.abs(m - t) <= 3))
    const fusion = coups
    this.meleeFusion.set(key, fusion)
    return fusion
  }

  /** A reload crosses neither a death, nor a weapon change, nor an instant where the hands leave the weapon. */
  private reloadAt(xuid: string, life: LifeView, frame: number): readonly number[] {
    const list = this.reloadStarts.get(life.slot) ?? NO_FRAMES
    const t = list.findLast((f) => f <= frame)
    return t !== undefined && this.isReloadValid(xuid, t, frame) ? [t] : NO_FRAMES
  }

  isReloadValid(xuid: string, t: number, frame: number): boolean {
    const life = this.ctx.tracks.life(xuid, frame)
    if (!life || this.ctx.tracks.life(xuid, t) !== life) return false
    const swaps = this.swapsOf(life.slot)
    for (let i = 0; i < swaps.length; i++) if (swaps[i].t > t && swaps[i].t <= frame) return false
    if ((this.reloadCuts.get(life.slot) ?? NO_FRAMES).some((c) => c > t && c <= frame)) return false
    const before = this.held(life.slot, t)
    return !!before && before.id === this.held(life.slot, frame)?.id
  }

  private reloadClip(clips: SpartanClips, slot: number, frame: number, weaponClass: WeaponClass) {
    const weapon = this.held(slot, frame)
    if (!weapon || weaponClass === 'sword' || weaponClass === 'hammer' || weaponClass === 'ball') return null
    const key = this.ctx.doc.weaponLabels?.[weapon.id]?.key
    if (key === 'hinf_plasma_pistol' || key === 'hinf_pulse_carbine' || key === 'hinf_stalker_rifle') return null
    const table = clips.weaponClips
    if (!table) return clips.get(`combat:${weaponClass}:reload_1`) ?? clips.get('combat:rifle:reload_1') ?? null
    const entry = table.weapons.find((w) => w.weapon === weaponModelKey(weapon.id))
    if (entry && !entry.reload) return null
    const name = entry?.reload
    const classReloadName = table.classes.find((c) => c.class === weaponClass)?.reload
    return (name && clips.get(name)) || (classReloadName && clips.get(classReloadName)) || clips.get('combat:rifle:reload_1') || null
  }

  /** swapsOf: the slot's held-weapon changes, looked up once. */
  private swapsOf(slot: number): readonly WeaponSwap[] {
    let list = this.swaps.get(slot)
    if (!list) {
      list = findSwaps(this.ctx, slot)
      this.swaps.set(slot, list)
    }
    return list
  }
}

/**
 * findSwaps: the frames where the slot's held weapon changes from one weapon to another. The
 * held weapon's reading only changes at the document's own markers (weapons, inventory, grabs
 * and drops): only those frames are compared to the one before.
 */
function findSwaps(ctx: ActionContext, slot: number): WeaponSwap[] {
  const { doc } = ctx
  const locale = ctx.inputs().locale
  const at = new Set<number>()
  for (const list of [doc.loadouts, doc.inventory, doc.weaponChanges]) for (const r of list) if (r.slot === slot) at.add(r.t)
  const out: WeaponSwap[] = []
  const classOf = (id: string) => weaponClassOfKey(doc.weaponLabels?.[id]?.key)
  for (const t of [...at].sort((a, b) => a - b)) {
    const before = heldWeaponAt(doc, slot, t - 1, locale)
    const after = heldWeaponAt(doc, slot, t, locale)
    if (before && after && before.id !== after.id) out.push({ t, from: classOf(before.id), to: classOf(after.id) })
  }
  return out
}
