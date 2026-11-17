// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * clipSelect3d.ts — QUELS CLIPS DU JEU JOUER À UNE IMAGE, et à quel temps : une fonction pure de ce
 * que le film dit du joueur (allure, postures datées, classe de l'arme tenue, actions datées).
 *
 * Rien ne s'accumule : chaque poids et chaque temps se calcule depuis l'image (fondus mesurés depuis
 * le début ou la fin d'un intervalle de posture, depuis l'image d'une action), donc pause, ralenti,
 * recul et saut rendent la même image.
 *
 * BASE (poids de somme 1, par priorité : escalade, glissade, saut, réception, puis locomotion) :
 *   - locomotion : attente, marche, course choisies par la vitesse (bornes = vitesses propres des
 *     clips, tirées de leur foulée), sprint par sa posture ; la direction du déplacement relative au
 *     cap mêle les deux clips directionnels qui l'encadrent ; accroupi par sa posture. Le temps d'un
 *     clip qui se déplace vient de la PHASE de la vie (`MotionGait.phase`, cycles intégrés de la
 *     distance au sol divisée par la foulée du mélange) et de la phase d'accord du clip
 *     (`SpartanClip.sync`) : les pieds ne glissent pas et tous les clips mêlés posent le même pied ;
 *   - escalade : entrée puis sortie étirées sur l'intervalle ; glissade et saut : temps depuis le
 *     début de l'intervalle ; réception : temps depuis la fin du saut.
 * PAR-DESSUS (remplacent les os qu'ils animent) : propulseur (l'esquive du jeu dans la direction de
 * la poussée relative au cap, depuis l'image de la poussée), corps à corps (impact calé sur l'image du coup),
 * lancer de grenade (lâcher calé sur l'image du lancer), rechargement (depuis son image), rangement
 * (fini à l'image du changement d'arme, classe de l'ancienne) et dégainage (depuis cette image, classe
 * de la nouvelle).
 *
 * Un clip absent pour la classe tenue se prend dans celle du fusil (le jeu complet).
 */
import type { SpartanClip } from './clips3d'
import type { ClipLayer, ClipMix } from './clipSample3d'
import { lastStartedAt, type DodgeShot, type EvadeDir } from './equipmentUse3d_logic'
import { DEFAULT_WEAPON_CLASS, type WeaponClass } from './weaponClass3d'

/** Un intervalle de posture du film, fermé aux deux bouts (`replaySpans.covers`). */
export interface Span {
  t0: number
  t1: number
}

/** Les postures d'une vie, chaque liste triée par début. */
export interface MotionStances {
  crouch: readonly Span[]
  sprint: readonly Span[]
  slide: readonly Span[]
  clamber: readonly Span[]
  jump: readonly Span[]
}

/** Un changement de l'arme en main : son image, la classe quittée et la classe prise. */
export interface WeaponSwap {
  t: number
  from: WeaponClass
  to: WeaponClass
}

/** Les actions d'une vie, en images triées. */
export interface MotionEvents {
  /** L'image du coup (kill de mêlée, coup non mortel). */
  melee: readonly number[]
  meleeStart?: readonly number[]
  /** L'image du lancer. */
  grenade: readonly number[]
  /** L'image du début du rechargement. */
  reload: readonly number[]
  swaps: readonly WeaponSwap[]
  /** Les poussées du propulseur : leur image et leur direction relative au cap. */
  dodges?: readonly DodgeShot[]
}

/** L'allure : vitesse au sol (u/s), direction relative au cap (degrés, + = gauche), phase (cycles). */
export interface MotionGait {
  speed: number
  rel: number
  phase: number
}

export interface MotionInput {
  /** Image du film (fractionnaire). */
  frame: number
  /** Images du film par seconde. */
  fps: number
  reloadClip?: SpartanClip | null
  weapon: WeaponClass
  /** null : à bord d'un véhicule (attente seule). */
  gait: MotionGait | null
  stances: MotionStances
  events: MotionEvents
}

export interface ClipCatalog {
  get(name: string): SpartanClip | undefined
}

/** Sous cette vitesse (u/s), le joueur se tient (le tremblé des positions publiées reste dessous). */
export const IDLE_BELOW = 0.1
/** À partir de cette vitesse (u/s), plus rien de l'attente. */
export const MOVE_FULL = 0.5
/** Fondus des postures (s) : accroupi et sprint ; saut ; réception ; escalade et glissade. */
export const STANCE_FADE = 0.15
const JUMP_FADE_IN = 0.1
const JUMP_FADE_OUT = 0.08
/** La réception se joue sur cette durée après le saut (s), fondue à l'entrée et à la sortie. */
export const LAND_SECONDS = 0.45
const LAND_FADE_IN = 0.05
const LAND_FADE_OUT = 0.25
const MOVE_FADE = 0.1
/** Fondus d'une action par-dessus (s). */
export const ACTION_FADE_IN = 0.05
export const ACTION_FADE_OUT = 0.15
/** L'impact dans `melee_strike_1` (s) : pic de vitesse de la main à l'image 3 (mesuré sur le GLB). */
export const MELEE_IMPACT = 0.1
/** Le lâcher conserve la pose de l'image 15 du clip à 60 Hz. */
export const THROW_RELEASE = 0.25

/** Les huit directions des clips et leur angle (degrés, + = gauche), dans [-180, 180). */
const DIRECTIONS: readonly (readonly [string, number])[] = [
  ['back', -180], ['backright', -135], ['right', -90], ['frontright', -45],
  ['front', 0], ['frontleft', 45], ['left', 90], ['backleft', 135],
]
const CARDINALS = new Set(['front', 'left', 'back', 'right'])

interface DirSet {
  clips: SpartanClip[]
  angles: number[]
}

interface ClassClips {
  idle: SpartanClip | null
  walk: DirSet
  run: DirSet
  sprint: SpartanClip | null
  crouchIdle: SpartanClip | null
  crouchWalk: DirSet
  slide: SpartanClip | null
  airborne: SpartanClip | null
  land: SpartanClip | null
  clamberEnter: SpartanClip | null
  clamberExit: SpartanClip | null
  melee: SpartanClip | null
  grenade: SpartanClip | null
  reload: SpartanClip | null
  putAway: SpartanClip | null
  ready: SpartanClip | null
  dodge: Record<EvadeDir, SpartanClip | null>
}

const resolved = new WeakMap<ClipCatalog, Map<WeaponClass, ClassClips>>()

/** classClips : les clips d'une classe dans un catalogue, résolus une fois (repli fusil). */
function classClips(cat: ClipCatalog, cls: WeaponClass): ClassClips {
  let byClass = resolved.get(cat)
  if (!byClass) {
    byClass = new Map()
    resolved.set(cat, byClass)
  }
  let c = byClass.get(cls)
  if (!c) {
    c = resolveClass(cat, cls)
    byClass.set(cls, c)
  }
  return c
}

function resolveClass(cat: ClipCatalog, cls: WeaponClass): ClassClips {
  const one = (posture: string, action: string) =>
    cat.get(`${posture}:${cls}:${action}`) ?? cat.get(`${posture}:${DEFAULT_WEAPON_CLASS}:${action}`) ?? null
  return {
    idle: one('combat', 'idle'),
    walk: dirSet(cat, cls, (k, d) => `combat:${k}:locomote_walk_${d}`),
    run: dirSet(cat, cls, (k, d) => `combat:${k}:locomote_run_${d}`),
    sprint: cat.get(`sprint:${cls}:locomote`) ?? cat.get(`sprint:${DEFAULT_WEAPON_CLASS}:locomote`) ?? null,
    crouchIdle: one('crouch', 'idle'),
    crouchWalk: dirSet(cat, cls, (k, d) => `crouch:${k}:locomote_walk_${d}`),
    slide: one('crouch', 'slide'),
    airborne: one('combat', 'airborne_arc'),
    land: one('combat', 'land_hard'),
    clamberEnter: one('combat', 'clamber_enter'),
    clamberExit: one('combat', 'clamber_exit'),
    melee: one('combat', 'melee_strike_1'),
    grenade: one('combat', 'throw_grenade'),
    reload: one('combat', 'reload_1'),
    putAway: one('combat', 'put_away'),
    ready: one('combat', 'ready'),
    dodge: { front: one('combat', 'dodge_front'), back: one('combat', 'dodge_back'), left: one('combat', 'dodge_left'), right: one('combat', 'dodge_right') },
  }
}

/**
 * dirSet : les clips directionnels d'une classe. Une classe qui a les quatre directions cardinales
 * garde son propre jeu ; sinon le jeu du fusil, où chaque direction que la classe possède prend la
 * sienne (une arme lourde qui n'avance que de face garde ses bras en marchant droit devant).
 */
function dirSet(cat: ClipCatalog, cls: WeaponClass, name: (cls: string, dir: string) => string): DirSet {
  const own = DIRECTIONS.map(([d]) => cat.get(name(cls, d)))
  const full = DIRECTIONS.every(([d], i) => !CARDINALS.has(d) || own[i])
  const out: DirSet = { clips: [], angles: [] }
  DIRECTIONS.forEach(([d, angle], i) => {
    const clip = own[i] ?? (full ? undefined : cat.get(name(DEFAULT_WEAPON_CLASS, d)))
    if (!clip) return
    out.clips.push(clip)
    out.angles.push(angle)
  })
  return out
}

/** Deux clips directionnels voisins et leurs poids (somme 1). */
export interface DirPair {
  a: SpartanClip | null
  wa: number
  b: SpartanClip | null
  wb: number
}

/** wrap180 : un angle (degrés) ramené dans [-180, 180). */
export function wrap180(a: number): number {
  return a - 360 * Math.floor((a + 180) / 360)
}

/**
 * dirPairOf : les deux clips du jeu `set` qui encadrent la direction `rel` (degrés), poids
 * linéaires en angle (continus d'un secteur à l'autre, somme 1) ; écrit dans `out`.
 */
function dirPairOf(set: DirSet, rel: number, out: DirPair): DirPair {
  const n = set.angles.length
  out.a = n > 0 ? set.clips[0] : null
  out.wa = 1
  out.b = null
  out.wb = 0
  if (n < 2) return out
  const x = wrap180(rel)
  let i = n - 1
  for (let k = 0; k < n; k++) if (set.angles[k] <= x) i = k
  const j = (i + 1) % n
  const span = set.angles[j] - set.angles[i] + (j <= i ? 360 : 0)
  const into = x - set.angles[i] + (x < set.angles[i] ? 360 : 0)
  const u = into / span
  out.a = set.clips[i]
  out.wa = 1 - u
  out.b = set.clips[j]
  out.wb = u
  return out
}

/** dirWeights : les poids des clips directionnels de la classe pour l'allure `kind` (tests, réglages). */
export function dirWeights(cat: ClipCatalog, cls: WeaponClass, kind: 'walk' | 'run' | 'crouchWalk', rel: number): DirPair {
  return dirPairOf(classClips(cat, cls)[kind], rel, { a: null, wa: 0, b: null, wb: 0 })
}

function clipSpeed(c: SpartanClip | null): number {
  return c ? c.stride / c.cycle : 0
}

function pairSpeed(p: DirPair): number {
  return p.wa * clipSpeed(p.a) + p.wb * clipSpeed(p.b)
}

/** phaseTime : le temps (s) d'un clip qui se déplace à la phase de vie `phase` (cycles). */
export function phaseTime(clip: SpartanClip, phase: number): number {
  const u = phase + clip.sync
  return (u - Math.floor(u)) * clip.cycle
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/** smoothstep : 0 sous `lo`, 1 au-dessus de `hi`, en douceur entre. */
export function smoothstep(x: number, lo: number, hi: number): number {
  const u = clamp01((x - lo) / (hi - lo))
  return u * u * (3 - 2 * u)
}

/** lastStarted : l'indice du dernier intervalle commencé à l'image `f` (liste triée par début), -1 sinon. */
function lastStarted(spans: readonly Span[], f: number): number {
  let lo = 0
  let hi = spans.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (spans[mid].t0 <= f) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

/** fadeOf : le poids d'un intervalle à l'image `f` : monte sur `fadeIn` (s) dès `t0`, descend sur `fadeOut` après sa dernière image. */
function fadeOf(s: Span, f: number, fps: number, fadeIn: number, fadeOut: number): number {
  const since = (f - s.t0) / fps
  const after = (f - (s.t1 + 1)) / fps
  if (since < 0) return 0
  return clamp01(Math.min(since / fadeIn, after <= 0 ? 1 : 1 - after / fadeOut))
}

/**
 * spanWeight : le poids d'une posture à l'image `f` : le plus fort des deux derniers intervalles
 * commencés (un intervalle qui suit de près le précédent ne creuse pas le poids).
 */
export function spanWeight(spans: readonly Span[], f: number, fps: number, fadeIn: number, fadeOut: number): number {
  const i = lastStarted(spans, f)
  if (i < 0) return 0
  const w = fadeOf(spans[i], f, fps, fadeIn, fadeOut)
  return i > 0 ? Math.max(w, fadeOf(spans[i - 1], f, fps, fadeIn, fadeOut)) : w
}

function push(list: ClipLayer[], count: number, clip: SpartanClip | null, time: number, weight: number, loop: boolean): number {
  if (!clip || weight <= 0 || count >= list.length) return count
  const l = list[count]
  l.clip = clip
  l.time = time
  l.weight = weight
  l.loop = loop
  return count + 1
}

function pushBase(out: ClipMix, clip: SpartanClip | null, time: number, weight: number, loop: boolean): void {
  out.baseCount = push(out.base, out.baseCount, clip, time, weight, loop)
}

function pushOver(out: ClipMix, clip: SpartanClip | null, time: number, weight: number): void {
  out.overCount = push(out.over, out.overCount, clip, time, weight, false)
}

const pairA: DirPair = { a: null, wa: 0, b: null, wb: 0 }
const pairB: DirPair = { a: null, wa: 0, b: null, wb: 0 }

function pushPair(out: ClipMix, p: DirPair, weight: number, phase: number): void {
  if (p.a) pushBase(out, p.a, phaseTime(p.a, phase), weight * p.wa, true)
  if (p.b) pushBase(out, p.b, phaseTime(p.b, phase), weight * p.wb, true)
}

/**
 * selectClips écrit dans `out` le mélange de l'image (cf. l'en-tête) et le rend. Les poids de base
 * font 1 dès que le catalogue porte les clips du fusil.
 */
export function selectClips(q: MotionInput, cat: ClipCatalog, out: ClipMix): ClipMix {
  out.baseCount = 0
  out.overCount = 0
  const c = classClips(cat, q.weapon)
  if (!q.gait) pushBase(out, c.idle, q.frame / q.fps, 1, true)
  else {
    const rest = specialStates(q, c, out)
    if (rest > 0) locomotion(q, q.gait, c, rest, out)
  }
  actions(q, cat, c, out)
  return out
}

/** specialStates pose escalade, glissade, saut et réception par priorité ; rend le poids qui reste. */
function specialStates(q: MotionInput, c: ClassClips, out: ClipMix): number {
  const { frame: f, fps, stances } = q
  let rest = 1
  rest = clamber(q, c, rest, out)
  const slide = spanWeight(stances.slide, f, fps, MOVE_FADE, MOVE_FADE) * rest
  const s = stances.slide[lastStarted(stances.slide, f)]
  if (s) pushBase(out, c.slide, (f - s.t0) / fps, slide, false)
  rest -= slide
  const jumpI = lastStarted(stances.jump, f)
  if (jumpI < 0) return rest
  const j = stances.jump[jumpI]
  const air = spanWeight(stances.jump, f, fps, JUMP_FADE_IN, JUMP_FADE_OUT) * rest
  pushBase(out, c.airborne, (f - j.t0) / fps, air, false)
  rest -= air
  const since = (f - (j.t1 + 1)) / fps
  if (since < 0 || since > LAND_SECONDS) return rest
  const land = clamp01(Math.min(since / LAND_FADE_IN, (LAND_SECONDS - since) / LAND_FADE_OUT)) * rest
  pushBase(out, c.land, since, land, false)
  return rest - land
}

/** clamber : l'escalade, entrée puis sortie étirées sur l'intervalle ; rend le poids qui reste. */
function clamber(q: MotionInput, c: ClassClips, rest: number, out: ClipMix): number {
  const spans = q.stances.clamber
  const s = spans[lastStarted(spans, q.frame)]
  const w = s ? fadeOf(s, q.frame, q.fps, MOVE_FADE, MOVE_FADE) * rest : 0
  if (w <= 0) return rest
  const enter = c.clamberEnter
  const exit = c.clamberExit
  const u = clamp01((q.frame - s.t0) / (s.t1 + 1 - s.t0))
  const split = enter && exit ? enter.cycle / (enter.cycle + exit.cycle) : enter ? 1 : 0
  if (enter && u < split) pushBase(out, enter, (u / split) * enter.once, w, false)
  else if (exit) pushBase(out, exit, ((u - split) / (1 - split)) * exit.once, w, false)
  return rest - w
}

/** locomotion : attente, marche, course, sprint et accroupi au poids `weight`. */
function locomotion(q: MotionInput, g: MotionGait, c: ClassClips, weight: number, out: ClipMix): void {
  const { frame: f, fps, stances } = q
  const crouch = spanWeight(stances.crouch, f, fps, STANCE_FADE, STANCE_FADE)
  const sprint = spanWeight(stances.sprint, f, fps, STANCE_FADE, STANCE_FADE)
  const move = smoothstep(g.speed, IDLE_BELOW, MOVE_FULL)
  const idleTime = f / fps
  const stand = weight * (1 - crouch)
  if (stand > 0) {
    pushBase(out, c.idle, idleTime, stand * (1 - move), true)
    const moving = stand * move
    if (moving > 0) {
      if (c.sprint) pushBase(out, c.sprint, phaseTime(c.sprint, g.phase), moving * sprint, true)
      const walk = dirPairOf(c.walk, g.rel, pairA)
      const run = dirPairOf(c.run, g.rel, pairB)
      const vw = pairSpeed(walk)
      const vr = pairSpeed(run)
      const r = vr > vw ? clamp01((g.speed - vw) / (vr - vw)) : 1
      pushPair(out, walk, moving * (1 - sprint) * (1 - r), g.phase)
      pushPair(out, run, moving * (1 - sprint) * r, g.phase)
    }
  }
  const low = weight * crouch
  if (low > 0) {
    pushBase(out, c.crouchIdle, idleTime, low * (1 - move), true)
    pushPair(out, dirPairOf(c.crouchWalk, g.rel, pairA), low * move, g.phase)
  }
}

/** actionWeight : le poids d'une action jouée une fois au temps `time` de son clip (durée `once`). */
export function actionWeight(time: number, once: number): number {
  if (time < 0 || time > once) return 0
  return clamp01(Math.min(time / ACTION_FADE_IN, (once - time) / ACTION_FADE_OUT))
}

/** lastBefore : l'indice de la dernière image de `frames` (triée) au plus `f`, -1 sinon. */
function lastBefore(frames: readonly number[], f: number): number {
  let lo = 0
  let hi = frames.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (frames[mid] <= f) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

/** oneAction : l'action la plus récente de `frames` dont le point `at` (s dans le clip) tombe à son image. */
function oneAction(out: ClipMix, clip: SpartanClip | null, frames: readonly number[], q: MotionInput, at: number): void {
  if (!clip) return
  const i = lastBefore(frames, q.frame + at * q.fps)
  if (i < 0) return
  const time = (q.frame - frames[i]) / q.fps + at
  pushOver(out, clip, time, actionWeight(time, clip.once))
}

/** actions pose les actions par-dessus (cf. l'en-tête). */
function actions(q: MotionInput, cat: ClipCatalog, c: ClassClips, out: ClipMix): void {
  const ev = q.events
  const d = ev.dodges ? lastStartedAt(ev.dodges, q.frame, (s) => s.t) : -1
  if (d >= 0) {
    const shot = (ev.dodges as readonly DodgeShot[])[d]
    const clip = c.dodge[shot.dir]
    const time = (q.frame - shot.t) / q.fps
    if (clip) pushOver(out, clip, time, actionWeight(time, clip.once))
  }
  oneAction(out, c.melee, ev.melee, q, MELEE_IMPACT)
  oneAction(out, c.melee, ev.meleeStart ?? [], q, 0)
  oneAction(out, c.grenade, ev.grenade, q, THROW_RELEASE)
  oneAction(out, q.reloadClip === undefined ? c.reload : q.reloadClip, ev.reload, q, 0)
  const swaps = ev.swaps
  let lo = 0
  let hi = swaps.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (swaps[mid].t <= q.frame + q.fps) lo = mid + 1
    else hi = mid
  }
  for (let i = Math.max(0, lo - 2); i < lo; i++) {
    const s = swaps[i]
    const since = (q.frame - s.t) / q.fps
    const away = classClips(cat, s.from).putAway
    if (away) pushOver(out, away, since + away.once, actionWeight(since + away.once, away.once))
    const ready = classClips(cat, s.to).ready
    if (ready) pushOver(out, ready, since, actionWeight(since, ready.once))
  }
}

/** mixStride : la foulée (u par cycle) des couches de base qui se déplacent, moyenne à leur poids ; 0 sans elles. */
export function mixStride(mix: ClipMix): number {
  let w = 0
  let s = 0
  for (let i = 0; i < mix.baseCount; i++) {
    const l = mix.base[i]
    if (!l.clip || l.clip.stride <= 0) continue
    w += l.weight
    s += l.weight * l.clip.stride
  }
  return w > 0 ? s / w : 0
}
