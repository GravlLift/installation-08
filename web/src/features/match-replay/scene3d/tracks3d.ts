/**
 * tracks3d.ts — LES PISTES DU REJEU LUES POUR LA VUE 3D.
 *
 * Repère : unités monde Halo (1 u = 3,048 m, Z vers le haut). `toThree` convertit en axes
 * three.js / glTF (Y vers le haut) : (x, y, z) Halo -> (x, z, -y), la même conversion que le GLB
 * de carte.
 *
 * Une piste (`tracks[]`) est UNE vie ; un joueur se reconstitue par son xuid. Un point porte `t`
 * (indice d'image), x/y/z, et quand la visée est répliquée `h` (cap, degrés, 0 = +X, 90 = +Y) et
 * `p` (tangage, degrés, positif vers le haut, absent = à plat). `g` > 0 marque un trou de
 * réplication AVANT le point : on tient la position, on n'interpole pas à travers.
 */
import { framesPerSecond } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import { covers } from '../model/replaySpans'
import { fineLifePoints } from './fineTracks3d'
import { bracketAt, gaitAt, lifeDistances, type Gait } from './gait3d'
import { DUREE_ENTREE_OEIL, DUREE_SORTIE_OEIL, dropOeil, fusionnerIntervallees, SANS_INTERVALLE, type IntervalleOeil } from './oeil3d'
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

/** Une vie telle que la vue la lit : son emplacement, ses points (visée complétée) et leurs distances. */
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
  /** La distance au sol cumulée à chaque point (`gait3d.lifeDistances`). */
  dist: number[]
  /** Les mesures de bouclier de la vie (`shields3d`). */
  shield: ShieldSamples
}

/** L'état d'un joueur à une image (fractionnaire). */
export interface PlayerState3d {
  x: number
  y: number
  z: number
  h: number
  p: number
  crouch: boolean
  /** La descente de l'œil en unités monde à cette image (accroupi ET glissade, en fondu, `oeil3d`). */
  dropOeil: number
  /** L'emplacement du bipède de cette vie. */
  slot: number
}

export interface Player3d {
  xuid: string
  name: string
  team: number
}

export interface Tracks3d {
  players: Player3d[]
  /** L'état du joueur à l'image `f`, ou null s'il n'est pas en vie. */
  sample(xuid: string, f: number): PlayerState3d | null
  /** L'état du bipède de l'emplacement `slot` à l'image `f` (un emplacement sert une vie à la fois). */
  sampleSlot(slot: number, f: number): PlayerState3d | null
  /** L'allure du joueur à l'image `f` (vitesse, direction, distance de sa vie), null s'il n'est pas en vie. */
  gait(xuid: string, f: number): Gait | null
  /** La vie du joueur qui couvre l'image `f` (le même objet à chaque appel), null hors vie. */
  life(xuid: string, f: number): LifeView | null
  /** Ce que le corps montre du bouclier à l'image `f` (`shields3d`), rien hors vie ; écrit dans `out`. */
  shield(xuid: string, f: number, out: ShieldFx): ShieldFx
  /** L'état à la fin de la dernière vie terminée avant `f` (position de la mort). */
  lastLifeBefore(xuid: string, f: number): PlayerState3d | null
  /** L'image de fin de la dernière vie terminée avant `f`, null s'il n'y en a pas. */
  lifeEndBefore(xuid: string, f: number): number | null
  /** L'état au début de la première vie qui commence après `f` (première apparition). */
  firstLifeAfter(xuid: string, f: number): PlayerState3d | null
  /** Tous les points publiés d'un joueur. */
  allPoints(xuid: string): LifePoint[]
}

export function buildTracks3d(doc: ReplayDocumentReady): Tracks3d {
  const roster = new Map(doc.roster.map((r) => [r.xuid, r]))
  const fps = framesPerSecond(doc)
  const lives = new Map<string, Life[]>()
  // Par emplacement, toutes les vies publiées, bots compris (ils n'ont pas de xuid mais tirent).
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
  // L'œil descend accroupi comme en glissade : l'union des deux postures de l'emplacement,
  // fusionnée une fois par document, lue ensuite par recherche binaire (`oeil3d`).
  const oeilParSlot = new Map<number, IntervalleOeil[]>()
  for (const s of doc.stances) {
    if (s.kind !== 'crouch' && s.kind !== 'slide') continue
    const film = postureFilm(s, doc)
    const liste = oeilParSlot.get(s.slot) ?? []
    // La fin milliseconde est exclusive ; sans millisecondes, l'image de fin est inclusive.
    liste.push({ t0: film.t0, fin: film.fin ?? film.t1 + 1 })
    oeilParSlot.set(s.slot, liste)
  }
  for (const [slot, liste] of oeilParSlot) oeilParSlot.set(slot, fusionnerIntervallees(liste))
  const entreeOeil = DUREE_ENTREE_OEIL * fps
  const sortieOeil = DUREE_SORTIE_OEIL * fps
  const descenteOeil = (slot: number, f: number) =>
    dropOeil(oeilParSlot.get(slot) ?? SANS_INTERVALLE, f, entreeOeil, sortieOeil)

  const players = [...lives.keys()].map((xuid) => {
    const r = roster.get(xuid)
    return { xuid, name: r?.name || xuid, team: r?.team ?? -1 }
  })
  players.sort((a, b) => a.team - b.team || a.name.localeCompare(b.name))

  return {
    players,
    sample(xuid, f) {
      for (const life of lives.get(xuid) ?? []) {
        if (covers(life, f)) return sampleLife(life, f, crouching(life, f), descenteOeil(life.slot, f))
      }
      return null
    },
    sampleSlot(slot, f) {
      for (const life of bySlot.get(slot) ?? []) {
        if (covers(life, f)) return sampleLife(life, f, crouching(life, f), descenteOeil(life.slot, f))
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
 * prepareLife complète la visée point par point : un point sans `h` reprend la dernière visée
 * connue (la visée n'est publiée que quand elle est répliquée), les premiers points sans visée
 * prennent la première connue.
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
  // Au débit du film quand le document le porte (schéma 109, `fineTracks3d`), sinon la grille.
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
