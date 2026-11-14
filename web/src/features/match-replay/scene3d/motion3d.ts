/**
 * motion3d.ts — LE MOUVEMENT DU SPARTAN D'UN JOUEUR À UNE IMAGE : ce que le film dit de lui, rangé
 * pour `clipSelect3d`, puis le mélange de clips du jeu qui le joue.
 *
 * Tout se lit dans le document, rangé une fois : postures par emplacement et par sorte, grenades
 * par emplacement, coups de mêlée mortels par tueur (kills du fil dont la source est la mêlée,
 * `fall3d.fallKindOf`), changements de l'arme en main par emplacement (cherchés aux seules images où
 * la lecture de l'arme peut changer : relevés d'armes, inventaires, prises et lâchers). La classe de
 * l'arme vient du libellé de l'arme tenue (`weaponClass3d`) ; le porteur du crâne ou d'un drapeau
 * tient la classe de l'objet. La PHASE de locomotion d'une vie s'intègre point par point (distance au sol / foulée du
 * mélange à ce point) et se garde par vie : elle ne dépend que du document.
 *
 */
import { msToFrames } from '@/lib/replay/replayLogic'

import { familyOf } from '../layers/shotEffects'
import { carriedObjectAt } from '../model/armeEnMain'
import type { ReplayKill } from '../model/killFeedLogic'
import { covers } from '../model/replaySpans'
import type { ActionContext } from './actionScene3d'
import { actionsParSlot, sautDepuisAction } from './actionsFilm3d'
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
import { bracketAt, gaitAt, lerpAt, type Bracket, type Gait } from './gait3d'
import { heldWeaponAt, type HeldWeapon3d } from './heldWeapon3d'
import { postureFilm } from './posturesFilm3d'
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
  private readonly rechargements: Map<number, number[]>
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

  /** `held` : l'arme en main d'un emplacement à une image (celle que la scène montre). */
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
      ;(byKind[kind] as Span[]).push(postureFilm(s, ctx.doc))
    }
    this.rechargements = actionsParSlot(ctx.doc, 'reload')
    this.coups = actionsParSlot(ctx.doc, 'melee')
    for (const [slot, debuts] of actionsParSlot(ctx.doc, 'jump')) {
      let postures = this.stances.get(slot)
      if (!postures) {
        postures = { crouch: [], sprint: [], slide: [], clamber: [], jump: [] }
        this.stances.set(slot, postures)
      }
      for (const debut of debuts) {
        if (postures.jump.some((j) => covers({ t0: j.t0, t1: j.t1 + 1 }, debut))) continue
        ;(postures.jump as Span[]).push(sautDepuisAction(ctx.doc, ctx.tracks, slot, debut))
      }
    }
    for (const byKind of this.stances.values()) for (const list of Object.values(byKind)) (list as Span[]).sort((a, b) => a.t0 - b.t0)
    for (const g of ctx.doc.grenades) this.grenades.set(g.slot, [...(this.grenades.get(g.slot) ?? []), g.t])
    for (const list of this.grenades.values()) list.sort((a, b) => a - b)
  }

  /**
   * at écrit dans `out` le mélange de clips du joueur `xuid` à l'image `frame` (`aboard` : à bord
   * d'un véhicule, attente seule) ; null hors vie ou tant que le Spartan animé n'est pas chargé.
   */
  at(xuid: string, frame: number, aboard: boolean, out: ClipMix): ClipMix | null {
    const source = this.ctx.spartanModel()
    const clips = source ? spartanClipsOf(source) : null
    const life = this.ctx.tracks.life(xuid, frame)
    if (!clips || !life) return null
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
    this.events.reload = this.rechargement(xuid, life, frame)
    this.events.dodges = this.usesAt(q.fps).dodges.get(life.slot) ?? NO_DODGES
    q.reloadClip = this.clipRechargement(clips, life.slot, frame, q.weapon)
    return selectClips(q, clips, out)
  }

  /** Les mêmes postures alimentent les animations à la première personne. */
  postures(slot: number): MotionStances {
    return this.stances.get(slot) ?? NO_STANCES
  }

  /** Les usages qui jouent un clip à la première personne (`equipmentUse3d_logic`), par emplacement. */
  firstPersonUses(slot: number, fps: number): readonly UseShot[] {
    return this.usesAt(Math.max(1, fps)).fp.get(slot) ?? NO_USES
  }

  /** usesAt : les esquives et les usages du document, lus une fois par cadence. */
  private usesAt(fps: number) {
    if (this.uses?.fps !== fps) {
      const heading = (slot: number, frame: number) => this.ctx.slotState(slot, frame)?.h ?? null
      const dodges = dodgeShots(thrusterBursts(this.ctx.doc, 1000 / fps), heading)
      this.uses = { fps, dodges, fp: firstPersonUses(this.ctx.doc, dodges) }
    }
    return this.uses
  }

  /** weaponClass : la classe de l'arme tenue ; un objet d'objectif porté donne la sienne (`CARRIED_OBJECT_CLASS`). */
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
    m.rel = g.speed > 0 ? g.heading - (life.pts[br.lo].h + angleStep(life.pts[br.lo].h, life.pts[br.hi].h) * br.u) : 0
    m.phase = lerpAt(this.phaseOf(life, fps, clips), br)
    return m
  }

  /**
   * phaseOf : la phase de locomotion (cycles) à chaque point de la vie : la distance de chaque pas
   * divisée par la foulée du mélange de ce point (classe du fusil : les foulées ne changent pas
   * d'une classe à l'autre). Calculée une fois par vie.
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

  /** meleeOf : les coups non mortels, sans doublon avec les kills de mêlée. */
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
    const cle = xuid + ':' + slot
    const connue = this.meleeFusion.get(cle)
    if (connue) return connue
    const mortels = this.melee.get(xuid) ?? NO_FRAMES
    const coups = (this.coups.get(slot) ?? NO_FRAMES).filter((t) =>
      this.ctx.tracks.life(xuid, t)?.slot === slot && !mortels.some((m) => Math.abs(m - t) <= 3))
    const fusion = coups
    this.meleeFusion.set(cle, fusion)
    return fusion
  }

  /** Un rechargement ne traverse ni une mort ni un changement d'arme. */
  private rechargement(xuid: string, vie: LifeView, frame: number): readonly number[] {
    const list = this.rechargements.get(vie.slot) ?? NO_FRAMES
    const t = list.findLast((f) => f <= frame)
    return t !== undefined && this.rechargementValide(xuid, t, frame) ? [t] : NO_FRAMES
  }

  rechargementValide(xuid: string, t: number, frame: number): boolean {
    const vie = this.ctx.tracks.life(xuid, frame)
    if (!vie || this.ctx.tracks.life(xuid, t) !== vie) return false
    const swaps = this.swapsOf(vie.slot)
    for (let i = 0; i < swaps.length; i++) if (swaps[i].t > t && swaps[i].t <= frame) return false
    const avant = this.held(vie.slot, t)
    return !!avant && avant.id === this.held(vie.slot, frame)?.id
  }

  private clipRechargement(clips: SpartanClips, slot: number, frame: number, classe: WeaponClass) {
    const arme = this.held(slot, frame)
    if (!arme || classe === 'sword' || classe === 'hammer' || classe === 'ball') return null
    const cle = this.ctx.doc.weaponLabels?.[arme.id]?.key
    if (cle === 'hinf_plasma_pistol' || cle === 'hinf_pulse_carbine' || cle === 'hinf_stalker_rifle') return null
    const table = clips.weaponClips
    if (!table) return clips.get(`combat:${classe}:reload_1`) ?? clips.get('combat:rifle:reload_1') ?? null
    const entree = table.weapons.find((w) => w.weapon === weaponModelKey(arme.id))
    if (entree && !entree.reload) return null
    const nom = entree?.reload
    const classeNom = table.classes.find((c) => c.class === classe)?.reload
    return (nom && clips.get(nom)) || (classeNom && clips.get(classeNom)) || clips.get('combat:rifle:reload_1') || null
  }

  /** swapsOf : les changements de l'arme en main de l'emplacement, cherchés une fois. */
  private swapsOf(slot: number): readonly WeaponSwap[] {
    let list = this.swaps.get(slot)
    if (!list) {
      list = findSwaps(this.ctx, slot)
      this.swaps.set(slot, list)
    }
    return list
  }
}

/** angleStep : le plus court chemin d'un cap `a` à un cap `b` (degrés). */
function angleStep(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180
}

/**
 * findSwaps : les images où l'arme en main de l'emplacement change d'une arme à une autre. La
 * lecture de l'arme ne change qu'aux relevés du document (armes, inventaire, prises et lâchers) :
 * seules ces images sont comparées à l'image d'avant.
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
