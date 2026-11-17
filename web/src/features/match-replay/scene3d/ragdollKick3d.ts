// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ragdollKick3d.ts — CE QUI POUSSE LE CORPS À LA MORT : la vitesse de départ de chaque particule du
 * corps inerte, tirée de la source du kill (`fall3d.fallKindOf`) et de ce que le film dit autour.
 *
 * - balle : poussée modeste le long du tir (du tueur vers la poitrine), portée par le buste ;
 * - tir à la tête : la même, plus vive, portée par la tête ;
 * - mêlée : forte bourrade horizontale depuis le tueur, un peu levée ;
 * - explosion : poussée radiale depuis le point de détonation, levée vers le haut, décroissante avec
 *   la distance (chaque particule la sienne : le corps tourne) ;
 * - écrasement : la vitesse du véhicule, levée, plus forte aux jambes ;
 * - sans tueur (chute, suicide) : rien que la vitesse héritée.
 * La victime garde en plus sa vitesse de course (bornée). Une petite torsion tirée d'un germe stable
 * (la mort) casse la symétrie : même mort, même torsion.
 *
 * Les intensités sont réglées à l'œil vers la sensation de Halo (corps flottants, projetés par les
 * explosions) ; vitesses en u/s (1 u = 3,048 m).
 */
import type { FallKind } from './fall3d'
import { P, PARTICLES } from './ragdollBody3d'

export type KickKind = FallKind | 'none'
export type Vec3 = readonly [number, number, number]

export const SHOT_PUSH = 0.9
export const HEADSHOT_PUSH = 1.6
export const MELEE_PUSH = 2.6
export const MELEE_LIFT = 0.7
/** Explosion : vitesse au plus près, part gardée au loin, distances (u), levée ajoutée à la direction. */
export const BLAST_PUSH = 4.2
export const BLAST_FAR_SHARE = 0.3
export const BLAST_NEAR = 0.4
export const BLAST_FAR = 3
export const BLAST_UP = 0.7
/** Écrasement : part de la vitesse du véhicule, levée (u/s), vitesse prise sans véhicule relu. */
export const SPLATTER_SHARE = 1
export const SPLATTER_LIFT = 1.2
export const SPLATTER_FALLBACK = 3.5
/** La vitesse héritée de la victime au plus (u/s). */
export const INHERIT_MAX = 3
/**
 * La part montante de la vitesse héritée au plus (u/s) : un joueur qui escalade un rebord ou monte
 * une marche est porté par son animation, pas lancé ; sans cette borne le corps s'envole.
 */
export const INHERIT_UP_MAX = 1.2
/** La torsion de départ (u/s) : opposée entre une épaule et la hanche d'en face. */
export const SPIN = 0.25

export interface KickInput {
  kind: KickKind
  /** La vitesse de la victime à sa mort (axes three, u/s). */
  velocity: Vec3
  /** L'œil du tueur (axes three), null quand il n'est pas relu. */
  from: Vec3 | null
  /** La direction horizontale unitaire de l'impulsion (du tueur vers la victime, sinon vers son dos). */
  dir: Vec3
  /** Le point de détonation (axes three), null sans explosion relue près de la mort. */
  blast: Vec3 | null
  /** La vitesse du véhicule de l'écrasement (axes three, u/s), null sans véhicule relu. */
  vehicle: Vec3 | null
  /** Le germe de la torsion. */
  seed: number
}

/** Les parts d'une poussée par particule, par nom (les autres : `rest`). */
type Shares = Partial<Record<string, number>> & { rest: number }
const SHOT_SHARES: Shares = { chest: 1, sternum: 1, neck: 0.7, pelvis: 0.4, belly: 0.4, rest: 0.2 }
const HEAD_SHARES: Shares = { head: 1, face: 1, neck: 0.6, chest: 0.25, sternum: 0.25, rest: 0.1 }
const MELEE_SHARES: Shares = { pelvis: 1, chest: 1, belly: 1, sternum: 1, neck: 0.9, head: 0.9, face: 0.9, rest: 0.75 }
const SPLATTER_SHARES: Shares = { lKnee: 1.15, rKnee: 1.15, lAnkle: 1.15, rAnkle: 1.15, lToe: 1.15, rToe: 1.15, head: 0.85, face: 0.85, rest: 1 }
const SHARE = (s: Shares) => Float64Array.from(PARTICLES, (p) => s[p.name] ?? s.rest)

/**
 * kickVelocities : la vitesse de départ (u/s, 3 par particule) des particules aux places `x` (axes
 * three, celles de la pose de mort).
 */
export function kickVelocities(k: KickInput, x: Float64Array): Float64Array {
  const n = PARTICLES.length
  const v = new Float64Array(3 * n)
  const inherit = clampLength([k.velocity[0], Math.min(k.velocity[1], INHERIT_UP_MAX), k.velocity[2]], INHERIT_MAX)
  for (let i = 0; i < n; i++) v.set(inherit, 3 * i)
  switch (k.kind) {
    case 'shot':
      addAlong(v, SHARE(SHOT_SHARES), aimed(k, x, P('chest')), SHOT_PUSH)
      break
    case 'headshot':
      addAlong(v, SHARE(HEAD_SHARES), aimed(k, x, P('head')), HEADSHOT_PUSH)
      break
    case 'melee': {
      const d = horizontal(k.from ? sub(at(x, P('chest')), k.from) : k.dir, k.dir)
      addAlong(v, SHARE(MELEE_SHARES), unit([d[0] * MELEE_PUSH, MELEE_LIFT, d[2] * MELEE_PUSH]), Math.hypot(MELEE_PUSH, MELEE_LIFT))
      break
    }
    case 'blast':
      addBlast(v, x, k.blast ?? blastFallback(k, x))
      break
    case 'splatter': {
      const car = k.vehicle && Math.hypot(...k.vehicle) > 0.3 ? k.vehicle : scale(k.dir, SPLATTER_FALLBACK)
      const push: Vec3 = [car[0] * SPLATTER_SHARE, car[1] * SPLATTER_SHARE + SPLATTER_LIFT, car[2] * SPLATTER_SHARE]
      addAlong(v, SHARE(SPLATTER_SHARES), unit(push), Math.hypot(...push))
      break
    }
    case 'none':
      return v
  }
  addSpin(v, k)
  return v
}

/** aimed : la direction du tir, de l'œil du tueur vers la particule visée, sinon l'impulsion horizontale. */
function aimed(k: KickInput, x: Float64Array, target: number): Vec3 {
  if (!k.from) return k.dir
  const d = sub(at(x, target), k.from)
  return Math.hypot(...d) > 1e-6 ? unit(d) : k.dir
}

function addAlong(v: Float64Array, shares: Float64Array, dir: Vec3, speed: number): void {
  for (let i = 0; i < shares.length; i++) {
    for (let d = 0; d < 3; d++) v[3 * i + d] += dir[d] * speed * shares[i]
  }
}

/** blastFallback : sans détonation relue, le souffle part d'un peu derrière et sous la victime. */
function blastFallback(k: KickInput, x: Float64Array): Vec3 {
  const p = at(x, P('pelvis'))
  return [p[0] - k.dir[0] * 0.8, p[1] - 0.3, p[2] - k.dir[2] * 0.8]
}

/** blastSpeed : la vitesse donnée par l'explosion à la distance `d` (u). */
export function blastSpeed(d: number): number {
  const u = Math.min(1, Math.max(0, (d - BLAST_NEAR) / (BLAST_FAR - BLAST_NEAR)))
  return BLAST_PUSH * (1 - u * (1 - BLAST_FAR_SHARE))
}

function addBlast(v: Float64Array, x: Float64Array, origin: Vec3): void {
  for (let i = 0; i < PARTICLES.length; i++) {
    const r = sub(at(x, i), origin)
    const d = Math.hypot(...r)
    const out = d > 1e-6 ? scale(r, 1 / d) : ([0, 1, 0] as Vec3)
    const dir = unit([out[0], out[1] + BLAST_UP, out[2]])
    const sp = blastSpeed(d)
    for (let c = 0; c < 3; c++) v[3 * i + c] += dir[c] * sp
  }
}

/** addSpin : une épaule et la hanche d'en face poussées en sens contraires, sens et force tirés du germe. */
function addSpin(v: Float64Array, k: KickInput): void {
  const r = mulberry32(k.seed)
  const sign = r() < 0.5 ? -1 : 1
  const amount = SPIN * (0.5 + r())
  const side: Vec3 = [-k.dir[2], 0, k.dir[0]]
  const [a, b] = r() < 0.5 ? [P('lShoulder'), P('rHip')] : [P('rShoulder'), P('lHip')]
  for (let c = 0; c < 3; c++) {
    v[3 * a + c] += side[c] * amount * sign
    v[3 * b + c] -= side[c] * amount * sign
  }
}

/** mulberry32 : un tirage pseudo-aléatoire reproductible de germe `seed` (dans [0, 1)). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function at(x: Float64Array, i: number): Vec3 {
  return [x[3 * i], x[3 * i + 1], x[3 * i + 2]]
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s]
}

function unit(a: Vec3): Vec3 {
  const l = Math.hypot(...a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

function clampLength(a: Vec3, max: number): Vec3 {
  const l = Math.hypot(...a)
  return l > max ? scale(a, max / l) : a
}

/** horizontal : `a` à plat, unitaire ; `fallback` s'il est vertical. */
function horizontal(a: Vec3, fallback: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[2])
  return l > 1e-6 ? [a[0] / l, 0, a[2] / l] : fallback
}
