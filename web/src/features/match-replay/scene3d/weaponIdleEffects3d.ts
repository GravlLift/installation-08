// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * weaponIdleEffects3d.ts — THE PARTICLE EFFECTS HELD WEAPONS CARRY, drawn from the weapon library
 * (`idle_effects`, `weaponIdleEffects3dModel` for the data and the simulation): the Shock Rifle's
 * electricity around its barrel housing, and any other weapon whose tags give one.
 *
 * WHERE: third person on the weapon each holder is drawn holding (`drawnWeapon`), at the effect's
 * markers of the weapon model; first person on the first-person rig's weapon, at the same markers on
 * the rig's weapon bone (`firstPersonEffectAnchor`; the followed player's own avatar is not drawn
 * then). A system draws only in the view its camera mode names, and not while scoped when it is
 * turned off in aimed-down-sight.
 *
 * WHEN: the effect's A scale is its weapon functions' (`effectScales`): on while the weapon is ready
 * (held, its ready animation over: the rig's `ready` clip length after a weapon change) and not
 * reloading (a reload of the film, from its start to the rig's reload clip length, cut by a shot).
 * The "Shots" switch hides them with the other shot effects.
 *
 * HOW: the game's particle shaders and the library's effect files (`particleDraw3d`, shared with the
 * shots' game effects).
 *
 * INFERRED, not read: the `ready` function following the first-person ready animation's length.
 */
import * as THREE from 'three'

import { frameToMs } from '@/lib/replay/replayLogic'

import { weaponInHand } from '../model/weaponInHand'
import { reloadEpisodesBySlot } from './filmActions3d'
import type { ActionContext, ActionLayer3d } from './actionScene3d'
import { heldWeaponAt } from './heldWeapon3d'
import { IndexField, type FetchJson } from './indexField3d'
import { expectedDuration, naturalEnd, type ReloadEpisode } from './firstPersonReload3d'
import { EffectFiles, ParticlePools } from './particleDraw3d'
import {
  effectScales,
  magazineFraction,
  parseIdleEffects,
  reloadingAt,
  simulateSystem,
  systemShown,
  type IdleEffect,
  type IdleEffectTable,
  type LiveParticle,
  type MagazineEvent,
  type ReloadSpan,
} from './weaponIdleEffects3dModel'
import { weaponModelKey } from './weaponModels3d'

export { particleMesh, smoothNormals } from './particleDraw3d'

/**
 * Systems not drawn, as weapon key:effect:system, until their model particle's stretch is decoded
 * (docs/KNOWN-ISSUES.md, the model particles' scale x and scale y). The Heatwave's ready glow (its
 * scale x is 5) drawn at its size alone shows as a round disc beside the gun in first person.
 */
const UNDECODED_SYSTEMS: ReadonlySet<string> = new Set(['2ac9c2ff:67537d26:0'])

/** The weapon library's idle effects and their files, read on first use. */
export class IdleEffectAssets extends EffectFiles {
  private readonly table: IndexField<IdleEffectTable>

  constructor(base: string, fetchJson?: FetchJson) {
    super(base)
    this.table = new IndexField(base, parseIdleEffects, fetchJson)
  }

  effects(key: string): readonly IdleEffect[] | null {
    return this.table.get()?.[key] ?? null
  }

  override dispose(): void {
    this.table.dispose()
    super.dispose()
  }
}
/** A holder's weapon timeline: its reloads, shots and the frames its weapon changed. */
interface SlotTimeline {
  reloads: ReloadSpan[]
  shots: number[]
  changes: number[]
  /** The film's magazine readings and the holder's shots, by weapon slot, sorted by ms. */
  magazines: Map<number, MagazineEvent[]>
  /** The reload episodes, with the weapon slot in hand at their start. */
  episodes: { ep: ReloadEpisode; w: number | null }[]
}

const ANCHOR = new THREE.Matrix4()
const ROOT_INV = new THREE.Matrix4()
const MARKER = new THREE.Matrix4()
const MARKER_Q = new THREE.Quaternion()
const AT = new THREE.Vector3()

/**
 * One drawn system instance, as the debug hook `window.__it3dIdleEffects` lists it: the weapon, effect,
 * system and marker instance, the view, how many particles it drew, and its marker's world position.
 * `window.__it3dIdleEffectsHide` (a list of `weapon:effect:system` keys) leaves those systems out, so a
 * shape on screen can be traced to the system that draws it.
 */
export interface IdleEffectDebugRow {
  key: string
  /** The holder: its film slot and player. */
  slot: number
  xuid: string
  location: string
  instance: number
  firstPerson: boolean
  particles: number
  marker: [number, number, number]
  /** A first-person system whose rig anchor failed (particles -1): why. */
  miss?: string
}

declare global {
  interface Window {
    __it3dIdleEffects?: readonly IdleEffectDebugRow[]
    __it3dIdleEffectsHide?: readonly string[]
  }
}

const DEBUG_HOOK = '__it3dIdleEffects'

/** WeaponIdleEffects3dLayer — the idle effects of every held weapon that has one (header). */
export class WeaponIdleEffects3dLayer implements ActionLayer3d {
  private readonly ctx: ActionContext
  private assets: IdleEffectAssets | null = null
  private readonly pools: ParticlePools
  private readonly particles: LiveParticle[] = []
  private timelines: Map<number, SlotTimeline> | null = null
  private slotSeed: Map<number, number> | null = null
  private readonly fetchJson?: FetchJson
  private readonly debugRows: IdleEffectDebugRow[] = []

  constructor(ctx: ActionContext, fetchJson?: FetchJson) {
    this.ctx = ctx
    this.fetchJson = fetchJson
    this.pools = new ParticlePools(ctx.root, 'weapon-idle-effect')
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, DEBUG_HOOK, { configurable: true, enumerable: false, get: () => this.debugRows.slice() })
    }
  }

  update(frame: number): void {
    this.pools.begin()
    this.debugRows.length = 0
    const inputs = this.ctx.inputs()
    if (inputs.show.shots) this.draw(frame, inputs.framesPerSecond, inputs.locale)
    this.pools.end()
  }

  private draw(frame: number, framesPerSecond: number, locale: Parameters<typeof heldWeaponAt>[3]): void {
    const base = this.ctx.weaponLibrary?.() ?? null
    if (!base) return
    if (!this.assets) this.assets = new IdleEffectAssets(base, this.fetchJson)
    const fps = Math.max(1, framesPerSecond)
    const t = frame / fps
    const f = Math.floor(frame)
    const tracks = this.ctx.doc.tracks
    if (!this.slotSeed) this.slotSeed = new Map(tracks.map((tr, i) => [tr.slot, i]))
    const timelines = this.timelinesOf()
    const fpSlot = this.ctx.firstPersonSlot(frame)
    const scoped = this.ctx.scopeMounted?.() ?? false
    this.ctx.root.updateWorldMatrix(true, false)
    ROOT_INV.copy(this.ctx.root.matrixWorld).invert()
    for (const track of tracks) {
      if (!track.xuid) continue
      const held = heldWeaponAt(this.ctx.doc, track.slot, f, locale)
      const key = held ? weaponModelKey(held.id) : null
      const effects = key ? this.assets.effects(key) : null
      if (!key || !effects) continue
      const firstPerson = fpSlot === track.slot
      const drawn = firstPerson ? null : this.ctx.drawnWeapon(track.xuid)
      if (!firstPerson && !drawn) continue
      const line = timelines.get(track.slot)
      const readyS = this.ctx.weaponClipSeconds?.(key, 'ready') ?? 0
      const lastChange = line ? lastAtOrBefore(line.changes, f) : -Infinity
      const ready = f - lastChange >= readyS * fps
      const clipS = (action: string) => this.ctx.weaponClipSeconds?.(key, action) ?? null
      const reloading = !!line && reloadingAt(line.reloads, f, fps, clipS('reload_full'), line.shots)
      const seed = this.slotSeed.get(track.slot) ?? 0
      // The magazine of the weapon in hand: full at spawn, then the film's readings, shots and reloads.
      const hand = weaponInHand(this.ctx.doc, track.slot, f)
      const atMs = frameToMs(f, this.ctx.doc)
      const magazine = hand && line ? this.magazineEvents(line, hand.weaponSlot, clipS, atMs, fps) : []
      if (drawn) drawn.model.updateWorldMatrix(true, false)
      effects.forEach((e, ei) => {
        const scales = effectScales(e, { ready, reloading, ammo: magazineFraction(magazine, atMs, e.magazine) })
        if (scales.scaleA <= 0) return
        e.systems.forEach((s, si) => {
          if (!systemShown(s, firstPerson, scoped)) return
          const debugKey = `${key}:${e.effect}:${si}`
          if (UNDECODED_SYSTEMS.has(debugKey)) return
          if (typeof window !== 'undefined' && window.__it3dIdleEffectsHide?.includes(debugKey)) return
          const pool = this.pools.poolOf(`${key}:${ei}:${si}`, s, this.assets)
          if (!pool) return
          // Every instance of the marker (the Heatwave's vent marker is on both fins), in both views.
          const anchors = e.markers[s.location]?.length ?? 0
          for (let m = 0; m < anchors; m++) {
            if (firstPerson) {
              if (!this.ctx.firstPersonEffectAnchor?.(key, s.location, ANCHOR, m)) {
                // Listed, with no particles: the rig shown is not this weapon's, or lacks the marker or its bone.
                this.debugRows.push({ key: debugKey, slot: track.slot, xuid: track.xuid ?? '', location: s.location, instance: m, firstPerson, particles: -1, marker: [0, 0, 0], miss: this.ctx.firstPersonAnchorMiss?.() ?? 'unknown' })
                return
              }
            } else {
              // The marker's frame on the model: its position, then its rotation (the Heatwave's fins turn
              // their marker a quarter about up, so the vent points out of them).
              const at = e.markers[s.location][m]
              const q = e.markerRotations?.[s.location]?.[m]
              MARKER.makeRotationFromQuaternion(q ? MARKER_Q.set(q[0], q[1], q[2], q[3]) : MARKER_Q.identity()).setPosition(at[0], at[1], at[2])
              ANCHOR.copy(drawn!.model.matrixWorld).multiply(MARKER)
            }
            simulateSystem(s, t, seed * 64 + m, ei * 32 + si, { ...scales, cameraDistance: 0 }, this.particles)
            for (const p of this.particles) this.pools.write(pool, p, ANCHOR, ROOT_INV)
            AT.setFromMatrixPosition(ANCHOR)
            this.debugRows.push({ key: debugKey, slot: track.slot, xuid: track.xuid ?? '', location: s.location, instance: m, firstPerson, particles: this.particles.length, marker: [AT.x, AT.y, AT.z] })
          }
        })
      })
    }
  }

  /**
   * magazineEvents: what changed weapon slot `w`'s magazine up to `atMs`: the film's readings and the
   * holder's shots, and its reloads as the first-person rig plays them (`clipS`: the clip lengths of the
   * weapon in hand). A staged reload (`reload_enter` and a round clip, no `reload_full`: the Heatwave,
   * Cindershot) puts one round in each time a round clip completes: at the next stage, the last one only
   * when the episode's closing message ends it naturally (`naturalEnd`, the rig's own test), or at the
   * round's expected end when no message follows; a shot or a swap stops it. A one-clip reload fills the
   * magazine at the end of its clip (the empty one when the magazine was empty), if nothing stopped it.
   */
  private magazineEvents(line: SlotTimeline, w: number, clipS: (action: string) => number | null, atMs: number, fps: number): MagazineEvent[] {
    const doc = this.ctx.doc
    const out = (line.magazines.get(w) ?? []).filter((e) => e.ms <= atMs)
    for (const { ep, w: held } of line.episodes) {
      const stages = ep.stages
      const start = stages[0].t
      if (held !== w || frameToMs(start, doc) > atMs) continue
      const stops = Math.min(firstAfter(line.shots, start), firstAfter(line.changes, start))
      const roundS = ep.empty
        ? clipS('reload_continue_empty') ?? clipS('reload_continue_full')
        : clipS('reload_continue_full') ?? clipS('reload_continue_empty')
      if (clipS('reload_full') === null && clipS('reload_enter') !== null && roundS !== null && roundS > 0) {
        const round = { durationSeconds: roundS }
        const last = stages.length - 1
        const closes = stages[last].cut
        const rounds = closes ? last - 1 : last
        for (let i = 1; i <= rounds; i++) {
          const done = i < last
            ? i + 1 === last && closes && !naturalEnd(stages, round, fps) ? null : stages[i + 1].t
            : stages[i].t + expectedDuration(stages, i, round, fps) * fps
          if (done !== null && done < stops) out.push({ ms: frameToMs(done, doc), kind: 'round' })
        }
        continue
      }
      const s = ep.empty ? clipS('reload_empty') ?? clipS('reload_full') : clipS('reload_full') ?? clipS('reload_empty')
      if (s !== null && s > 0 && start + s * fps < stops) out.push({ ms: frameToMs(start, doc) + s * 1000, kind: 'full' })
    }
    return out.sort((a, b) => a.ms - b.ms)
  }
  private timelinesOf(): Map<number, SlotTimeline> {
    if (this.timelines) return this.timelines
    const doc = this.ctx.doc
    const out = new Map<number, SlotTimeline>()
    const line = (slot: number) => {
      let l = out.get(slot)
      if (!l) out.set(slot, (l = { reloads: [], shots: [], changes: [], magazines: new Map(), episodes: [] }))
      return l
    }
    for (const [slot, eps] of reloadEpisodesBySlot(doc)) {
      line(slot).reloads = eps.map((e) => ({ start: e.stages[0].t, lastStage: e.stages[e.stages.length - 1].t }))
      line(slot).episodes = eps.map((ep) => ({ ep, w: weaponInHand(doc, slot, ep.stages[0].t)?.weaponSlot ?? null }))
    }
    const magazine = (slot: number, w: number) => {
      const m = line(slot).magazines
      if (!m.has(w)) m.set(w, [])
      return m.get(w)!
    }
    for (const s of doc.shots) {
      line(s.slot).shots.push(s.t)
      const w = weaponInHand(doc, s.slot, s.t)?.weaponSlot
      if (w != null) magazine(s.slot, w).push({ ms: frameToMs(s.t, doc) + (s.o ?? 0), kind: 'shot' })
    }
    for (const r of doc.ammoReads) if (r.mag != null) magazine(r.slot, r.w).push({ ms: r.ms, kind: 'read', rounds: r.mag })
    const locale = this.ctx.inputs().locale
    for (const list of [doc.loadouts, doc.inventory, doc.weaponChanges]) {
      for (const r of list) {
        const before = heldWeaponAt(doc, r.slot, r.t - 1, locale)
        const after = heldWeaponAt(doc, r.slot, r.t, locale)
        if (before && after && before.id !== after.id) line(r.slot).changes.push(r.t)
      }
    }
    for (const l of out.values()) {
      l.shots.sort((a, b) => a - b)
      l.changes.sort((a, b) => a - b)
      for (const events of l.magazines.values()) events.sort((a, b) => a.ms - b.ms)
    }
    this.timelines = out
    return out
  }

  dispose(): void {
    this.pools.dispose()
    this.assets?.dispose()
    if (typeof window !== 'undefined') delete (window as unknown as Record<string, unknown>)[DEBUG_HOOK]
  }
}

function lastAtOrBefore(sorted: readonly number[], v: number): number {
  let out = -Infinity
  for (const x of sorted) {
    if (x > v) break
    out = x
  }
  return out
}

/** firstAfter: the first frame of a sorted list strictly after `frame`, or Infinity. */
function firstAfter(sorted: readonly number[], frame: number): number {
  for (const t of sorted) if (t > frame) return t
  return Infinity
}
