/**
 * fall3d.ts — LA CHUTE DU CORPS À LA MORT : les clips de mort du jeu, fonction du temps écoulé depuis
 * la mort, dans une allure que la source du kill du fil choisit.
 *
 * Le jeu n'a pas de chute debout (ses morts sont une chute EN L'AIR, `airborne_dead`, et l'arrivée
 * au sol, `landing_dead`, chacune de face et de dos) : le corps passe de la pose debout (attente au
 * fusil) ou, projeté, de la chute en l'air, à l'arrivée au sol par un fondu sur la durée de la chute,
 * puis l'arrivée se joue (rebond, corps qui se pose). De face ou de dos selon l'impulsion (du tueur
 * vers la victime quand les deux positions sont relues, vers l'arrière de la victime sinon) relative
 * à la face de la victime ; le corps tourne pendant la chute pour tomber le long de l'impulsion, la
 * racine glisse le long d'elle et s'envole pour les projections.
 *
 * Le style (`FallKind`) vient du kill : l'écrasement (vignette `killfeed-60`,
 * `libs/film/killicon/splatter.go`) et l'explosion (grenades `killfeed-46..49`, bobines
 * `killfeed-42..45`, familles `explosive` / `bomb`) projettent le corps, la mêlée (vignette
 * `killfeed-65`, famille `melee`) le pousse, le tir à la tête le fait s'effondrer sur place ; une
 * balle le fait tomber.
 *
 * Aucune mémoire : la chute ne dépend que du temps et du style.
 */
import * as THREE from 'three'

import type { ShotFamily } from '../layers/shotEffects'
import type { ReplayKill } from '../model/killFeedLogic'
import { KILL_SPRITE_SOUND_STEMS, killSourceSpriteStem } from '../sound/replaySound'
import type { SpartanClip } from './clips3d'
import type { ClipMix } from './clipSample3d'
import { smoothstep, type ClipCatalog } from './clipSelect3d'

export type FallKind = 'shot' | 'headshot' | 'melee' | 'blast' | 'splatter'

/** La vignette d'écrasement du fil (`libs/film/killicon/splatter.go`). */
const SPLATTER_SPRITE = 'killfeed-60'
const BLAST_FAMILIES: ReadonlySet<ShotFamily> = new Set(['explosive', 'bomb'])

interface FallStyle {
  /** Durée de la chute jusqu'au sol (s). */
  seconds: number
  /** Le glissement du corps le long de l'impulsion (u). */
  slide: number
  /** L'envol au milieu de la chute (u). */
  hop: number
  /** Projeté : la chute part de la chute en l'air du jeu, pas de la pose debout. */
  thrown: boolean
}

const STYLES: Readonly<Record<FallKind, FallStyle>> = {
  shot: { seconds: 0.6, slide: 0.08, hop: 0, thrown: false },
  headshot: { seconds: 0.45, slide: 0, hop: 0, thrown: false },
  melee: { seconds: 0.5, slide: 0.35, hop: 0.04, thrown: false },
  blast: { seconds: 0.7, slide: 0.9, hop: 0.3, thrown: true },
  splatter: { seconds: 0.6, slide: 1.4, hop: 0.35, thrown: true },
}

/** Les clips de mort du jeu et la pose debout d'où part une chute qui n'est pas une projection. */
export const DEATH_CLIPS = {
  standing: 'combat:rifle:idle',
  airborne: 'combat:any:airborne_dead',
  airborneBack: 'combat:airborne_dead_back',
  landing: 'combat:any:landing_dead',
  landingBack: 'combat:landing_dead_back',
} as const

/** La chute à un instant : sa part faite (0 à 1), le glissement et l'envol de la racine (u). */
export interface FallPose {
  u: number
  slide: number
  lift: number
}

/** fallKindOf : le style de chute qu'un kill du fil appelle, `family` lue dans `doc.killEffects`. */
export function fallKindOf(k: Pick<ReplayKill, 'weaponImageUrl' | 'headshot'>, family: ShotFamily): FallKind {
  const stem = killSourceSpriteStem(k.weaponImageUrl)
  if (stem === SPLATTER_SPRITE) return 'splatter'
  const sound = KILL_SPRITE_SOUND_STEMS[stem]
  if (sound?.category === 'melee' || family === 'melee') return 'melee'
  if (sound?.category === 'grenade' || sound?.stem.startsWith('coil_') || BLAST_FAMILIES.has(family)) return 'blast'
  return k.headshot === true ? 'headshot' : 'shot'
}

/** fallSeconds : la durée de la chute d'un style (au-delà, le corps est au sol). */
export function fallSeconds(kind: FallKind): number {
  return STYLES[kind].seconds
}

/** fallPose : la chute `t` secondes après la mort ; debout avant, au sol après sa durée. */
export function fallPose(t: number, kind: FallKind, out: FallPose): FallPose {
  const s = STYLES[kind]
  const u = Math.min(1, Math.max(0, t / s.seconds))
  out.u = u
  out.slide = s.slide * (1 - (1 - u) * (1 - u))
  out.lift = s.hop * 4 * u * (1 - u)
  return out
}

/** fallPlacement : où poser la racine du corps (axes three) : aux pieds `at`, glissée le long de l'impulsion `dir` et levée. */
export function fallPlacement(at: THREE.Vector3, dir: THREE.Vector3, p: FallPose, pos: THREE.Vector3): void {
  pos.copy(at).addScaledVector(dir, p.slide)
  pos.y += p.lift
}

/** fallsBackward : l'impulsion `dir` (horizontale, axes three) va-t-elle vers le dos d'une victime au cap `facing` (axes three) ? */
export function fallsBackward(dir: THREE.Vector3, facing: THREE.Vector3): boolean {
  return dir.dot(facing) < 0
}

/**
 * fallHeading : le cap du corps (degrés) à la part `u` de la chute : celui de la victime `h` au
 * départ, tourné pendant la chute pour que le corps tombe le long de l'impulsion `dir` (axes three) :
 * face vers elle, ou dos vers elle s'il tombe de dos (le plus court des deux, un quart de tour au plus).
 */
export function fallHeading(h: number, dir: THREE.Vector3, backward: boolean, u: number): number {
  const s = backward ? -1 : 1
  const target = (Math.atan2(-dir.z * s, dir.x * s) * 180) / Math.PI
  const step = ((target - h + 540) % 360) - 180
  return h + step * smoothstep(u, 0, 1)
}

/**
 * deathMix écrit dans `out` les clips du corps `t` secondes après la mort : la pose de départ
 * (debout, ou chute en l'air pour une projection) fondue vers l'arrivée au sol pendant la chute,
 * puis l'arrivée jouée depuis la fin de la chute. Rend `out` (vide sans les clips de mort).
 */
export function deathMix(t: number, kind: FallKind, backward: boolean, cat: ClipCatalog, out: ClipMix): ClipMix {
  const s = STYLES[kind]
  out.baseCount = 0
  out.overCount = 0
  const start = cat.get(s.thrown ? (backward ? DEATH_CLIPS.airborneBack : DEATH_CLIPS.airborne) : DEATH_CLIPS.standing)
  const land = cat.get(backward ? DEATH_CLIPS.landingBack : DEATH_CLIPS.landing)
  if (!start || !land) return out
  const w = smoothstep(t / s.seconds, 0, 1)
  pushOnce(out, start, s.thrown ? Math.max(0, t) : 0, 1 - w)
  pushOnce(out, land, Math.max(0, t - s.seconds), w)
  return out
}

function pushOnce(out: ClipMix, clip: SpartanClip, time: number, weight: number): void {
  if (weight <= 0) return
  const l = out.base[out.baseCount++]
  l.clip = clip
  l.time = time
  l.weight = weight
  l.loop = false
}
