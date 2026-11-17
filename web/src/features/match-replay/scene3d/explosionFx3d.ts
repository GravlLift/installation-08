// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * explosionFx3d.ts — UNE EXPLOSION À UN ÂGE : ce que la vue 3D en dessine, fonction pure de l'âge
 * (secondes depuis la détonation publiée) et d'un germe.
 *
 * Le rejeu se parcourt en avant comme en arrière : aucune particule n'est simulée d'image en image.
 * Chaque éclat a ses tirages (direction, vitesse, retard, durée) fixés par le germe de l'explosion et
 * son rang, et sa place se calcule en forme close depuis l'âge : la même image rend la même explosion.
 *
 * La mise en scène suit le jeu (frag de Halo Infinite) : tout se joue en moins d'une seconde. Un éclair
 * blanc d'une à deux images, une boule de feu FAITE DE PLUSIEURS BOUFFÉES qui se chevauchent (orange,
 * points chauds jaune-blanc, trous sombres entre elles) et s'écartent un peu en montant, une gerbe
 * d'étincelles blanches qui filent et retombent, puis un voile de fumée qui a disparu avant 0,8 s.
 * Le plasma : éclair et gerbe d'énergie à la teinte de l'arme, sans fumée. Le cristal (Spike) : aiguilles
 * droites et rapides. La boule de feu reste sous le rayon de dégâts (`BLAST_RADIUS` de `flights3d`).
 *
 * Unités monde Halo (1 u = 3,048 m), axes three (Y en haut). Couleurs linéaires, pré-multipliées :
 * `r, g, b` est la lumière émise, `a` ce que l'éclat cache derrière lui (0 : pure lueur).
 */
import type { FxTint } from '../layers/fxInk'

/** Les trois mises en scène d'une détonation. */
export type BlastStyle = 'fire' | 'plasma' | 'shard'

/** blastStyleOf : la mise en scène d'une détonation selon la nature de sa décharge (`fxInk`). */
export function blastStyleOf(tint: FxTint): BlastStyle {
  if (tint === 'needle') return 'shard'
  if (tint === 'plasma_cool' || tint === 'plasma_green' || tint === 'plasma_hot' || tint === 'electric' || tint === 'forerunner') return 'plasma'
  return 'fire'
}

/** Une couleur linéaire (une `THREE.Color` convient). */
export interface Rgb {
  r: number
  g: number
  b: number
}

/** Les encres d'une explosion : le cœur incandescent commun et la teinte de la décharge. */
export interface BlastInk {
  core: Rgb
  tint: Rgb
}

/** Ce qui reçoit les éclats d'une image (les tampons du rendu, ou une liste dans les tests). */
export interface BlastSink {
  /** Un éclat rond : décalage depuis le centre (u), rayon (u), lumière émise, opacité. */
  sprite(x: number, y: number, z: number, radius: number, r: number, g: number, b: number, a: number): void
  /** Une étincelle : de (x0, y0, z0) à (x1, y1, z1), décalages depuis le centre (u), lumière émise. */
  streak(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, g: number, b: number): void
}

/** La fin de toute explosion (s) : au-delà, rien n'est dessiné. */
export const BLAST_END_SECONDS = 0.8
/** La pesanteur des étincelles (u/s²) : 9,8 m/s². */
const GRAVITY = 3.2
/** La durée de l'éclair blanc (s) : une à deux images à l'écran. */
export const BLAST_FLASH_SECONDS = 0.06
/** Le temps que dure le filé d'une étincelle (s) : la longueur de son trait. */
const STREAK_SECONDS = 0.03

interface StyleSpec {
  flashRadius: number
  flashGain: number
  billows: number
  /** Rayon d'une bouffée (u) et sa dispersion. */
  billowRadius: [number, number]
  /** Écart de la bouffée au centre à la fin de sa vie (u). */
  billowReach: [number, number]
  billowLife: [number, number]
  /** Opacité au plus d'une bouffée : une boule de feu cache ce qui est derrière, le plasma non. */
  billowCover: number
  billowGain: number
  sparks: number
  sparkSpeed: [number, number]
  sparkLife: [number, number]
  sparkGravity: number
  /** Filé d'une étincelle, en multiple de `STREAK_SECONDS`. */
  sparkTrail: number
  smoke: number
  light: number
  lightSeconds: number
}

const SPECS: Record<BlastStyle, StyleSpec> = {
  fire: {
    flashRadius: 0.9, flashGain: 4, billows: 12, billowRadius: [0.36, 0.5], billowReach: [0.15, 0.3],
    billowLife: [0.42, 0.66], billowCover: 0.95, billowGain: 1.1, sparks: 30, sparkSpeed: [5, 12],
    sparkLife: [0.25, 0.6], sparkGravity: 1, sparkTrail: 1, smoke: 4, light: 24, lightSeconds: 0.3,
  },
  plasma: {
    flashRadius: 0.8, flashGain: 4, billows: 7, billowRadius: [0.2, 0.32], billowReach: [0.15, 0.32],
    billowLife: [0.22, 0.38], billowCover: 0.12, billowGain: 2.6, sparks: 22, sparkSpeed: [6, 14],
    sparkLife: [0.15, 0.35], sparkGravity: 0.25, sparkTrail: 1.5, smoke: 0, light: 18, lightSeconds: 0.25,
  },
  shard: {
    flashRadius: 0.5, flashGain: 3, billows: 3, billowRadius: [0.15, 0.22], billowReach: [0.1, 0.2],
    billowLife: [0.2, 0.3], billowCover: 0.1, billowGain: 1.6, sparks: 26, sparkSpeed: [10, 16],
    sparkLife: [0.2, 0.35], sparkGravity: 0, sparkTrail: 3, smoke: 0, light: 10, lightSeconds: 0.2,
  },
}

/** blastLight : la force de la lumière de la détonation à `age` (pleine au départ, éteinte vite). */
export function blastLight(style: BlastStyle, age: number): number {
  const s = SPECS[style]
  if (age < 0 || age >= s.lightSeconds) return 0
  const u = 1 - age / s.lightSeconds
  return s.light * u * u
}

/**
 * rand : un tirage dans [0, 1) propre au germe `seed`, à l'éclat `i` et au tirage `k` (hachage
 * entier) : la même explosion tire toujours les mêmes nombres, sans état.
 */
export function rand(seed: number, i: number, k: number): number {
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35) ^ Math.imul(k + 1, 0x27d4eb2f)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

function between(range: [number, number], t: number): number {
  return range[0] + (range[1] - range[0]) * t
}

/** Une direction tirée, plutôt vers le haut (`up` : part minimale de la verticale), unitaire. */
function direction(seed: number, i: number, k: number, up: number): [number, number, number] {
  const a = rand(seed, i, k) * Math.PI * 2
  const y = up + (1 - up) * rand(seed, i, k + 1)
  const h = Math.sqrt(Math.max(0, 1 - y * y))
  return [h * Math.cos(a), y, h * Math.sin(a)]
}

/**
 * blastAt pose dans `sink` les éclats d'une explosion de style `style`, `age` secondes après la
 * détonation, germe `seed`, encres `ink`. Rien avant la détonation ni après `BLAST_END_SECONDS`.
 */
export function blastAt(style: BlastStyle, age: number, seed: number, ink: BlastInk, sink: BlastSink): void {
  if (age < 0 || age >= BLAST_END_SECONDS) return
  const s = SPECS[style]
  if (age < BLAST_FLASH_SECONDS) {
    const k = 1 - age / BLAST_FLASH_SECONDS
    const g = s.flashGain * k * k
    sink.sprite(0, 0.1, 0, s.flashRadius * (0.7 + 0.3 * (1 - k)), ink.core.r * g, ink.core.g * g, ink.core.b * g, 0)
  }
  billows(s, age, seed, ink, sink)
  sparks(s, age, seed, ink, sink)
  smoke(s, age, seed, ink, sink)
}

/**
 * billows : les bouffées de la boule de feu. Chacune naît près du centre, s'écarte en montant
 * (détente rapide puis lente), grossit, passe du blanc chaud à la teinte puis au rouge sombre et
 * s'efface ; leurs écarts tirés font une boule bosselée, jamais une sphère.
 */
function billows(s: StyleSpec, age: number, seed: number, ink: BlastInk, sink: BlastSink): void {
  for (let i = 0; i < s.billows; i++) {
    const delay = 0.025 * rand(seed, i, 0)
    const life = between(s.billowLife, rand(seed, i, 1))
    const u = (age - delay) / life
    if (u < 0 || u >= 1) continue
    const [dx, dy, dz] = direction(seed, i, 2, 0.15)
    // Détente : la boule atteint presque sa taille au premier tiers de sa vie.
    const ease = 1 - (1 - Math.min(1, u * 3)) ** 3
    const reach = 0.06 + between(s.billowReach, rand(seed, i, 4)) * ease
    const radius = between(s.billowRadius, rand(seed, i, 5)) * (0.7 + 0.45 * ease)
    // Chaleur : blanc chaud au départ, la teinte au milieu, rouge sombre (vert retiré) à la fin ;
    // certaines bouffées restent plus chaudes (les points jaune-blanc de la boule), d'autres plus
    // sombres (les trous de la boule).
    const heat = Math.min(1, Math.max(0, 1 - u * 6 + 1.2 * (rand(seed, i, 7) - 0.5)))
    // Les bouffées se recouvrent : leur couleur converge vers lumière / opacité, d'où un gain modeste
    // (une boule orange qui a du corps, pas un blanc saturé).
    // La lumière s'éteint plus vite que le corps : la fin d'une bouffée est sombre, jamais un disque
    // rouge saturé.
    const fade = (1 - u) ** 2.2 * s.billowGain * (0.75 + 0.5 * rand(seed, i, 6))
    const cool = 1 - 0.4 * Math.min(1, u * 1.6)
    const r = (ink.tint.r + (ink.core.r - ink.tint.r) * heat) * fade
    const g = (ink.tint.g * cool * cool + (ink.core.g - ink.tint.g) * heat) * fade
    const b = (ink.tint.b * cool + (ink.core.b - ink.tint.b) * heat) * fade
    sink.sprite(dx * reach, dy * reach + 0.15 * u * life, dz * reach, radius, r, g, b, s.billowCover * (1 - u) ** 1.6)
  }
}

/** sparks : la gerbe d'étincelles, chacune en vol balistique depuis le centre, filé compris. */
function sparks(s: StyleSpec, age: number, seed: number, ink: BlastInk, sink: BlastSink): void {
  for (let i = 0; i < s.sparks; i++) {
    const t = age - 0.02 * rand(seed, 100 + i, 0)
    const life = between(s.sparkLife, rand(seed, 100 + i, 1))
    if (t < 0 || t >= life) continue
    const [dx, dy, dz] = direction(seed, 100 + i, 2, -0.25)
    const v = between(s.sparkSpeed, rand(seed, 100 + i, 4))
    const g = GRAVITY * s.sparkGravity
    const t0 = Math.max(0, t - STREAK_SECONDS * s.sparkTrail)
    const at = (tt: number) => [dx * v * tt, dy * v * tt - 0.5 * g * tt * tt, dz * v * tt] as const
    const [x0, y0, z0] = at(t0)
    const [x1, y1, z1] = at(t)
    const k = 1 - t / life
    const glow = 2.5 * k
    const hot = k * k
    sink.streak(
      x0, y0, z0, x1, y1, z1,
      (ink.tint.r + (ink.core.r - ink.tint.r) * hot) * glow,
      (ink.tint.g + (ink.core.g - ink.tint.g) * hot) * glow,
      (ink.tint.b + (ink.core.b - ink.tint.b) * hot) * glow,
    )
  }
}

/** smoke : un voile de fumée grise qui monte, s'élargit et a disparu avant `BLAST_END_SECONDS`. */
function smoke(s: StyleSpec, age: number, seed: number, ink: BlastInk, sink: BlastSink): void {
  for (let i = 0; i < s.smoke; i++) {
    const start = 0.1 + 0.06 * rand(seed, 200 + i, 0)
    const life = 0.5 + 0.1 * rand(seed, 200 + i, 1)
    const u = (age - start) / life
    if (u < 0 || u >= 1) continue
    const [dx, dy, dz] = direction(seed, 200 + i, 2, 0.3)
    const spread = 0.25 + 0.2 * u
    const shade = 0.06
    const cover = 0.28 * Math.sin(Math.PI * u)
    sink.sprite(
      dx * spread, dy * spread + 0.4 * u, dz * spread, 0.35 + 0.35 * u,
      ink.core.r * shade * cover, ink.core.g * shade * cover, ink.core.b * shade * cover, cover,
    )
  }
}
