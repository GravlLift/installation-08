// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { clipDuRig, type ClipPremierePersonne, type RigPremierePersonne } from './premierePersonne3d'
import { useAt, type UseShot } from './equipmentUse3d_logic'
import type { IntervalleSprint } from './evenementsPremierePersonne3d'
import { firstAbove } from './recoilShots3d'
import { phaseRechargement, type ClipsRechargement, type ClipsVent, type EpisodeRechargement } from './rechargementPremierePersonne3d'

/**
 * ChangementArme : le changement de l'arme en main de l'emplacement à la frame, avec la clé de
 * modèle de l'arme qui part (`avant`) et de celle qui arrive (`apres`) ; null du côté absent.
 */
export interface ChangementArme {
  frame: number
  avant: string | null
  apres: string | null
}

export interface EvenementsPremierePersonne {
  /** The life's reload episodes (`episodesRechargement`), sorted by their start. */
  rechargements: readonly EpisodeRechargement[]
  coups: ArrayLike<number>
  tirs: ArrayLike<number>
  grenades: ArrayLike<number>
  changements: ArrayLike<ChangementArme>
  sprints: readonly IntervalleSprint[]
  slides: readonly IntervalleSprint[]
  accroupis: readonly IntervalleSprint[]
  sauts: readonly IntervalleSprint[]
  escalades: readonly IntervalleSprint[]
  /** Les usages qui jouent un clip du jeu (équipement porté, grappin, propulseur), triés par image. */
  usages: readonly UseShot[]
  frame: number
  fps: number
  rechargementValide: (debut: number, frame: number) => boolean
}
export interface PosePremierePersonne {
  base: ClipPremierePersonne | null
  tempsBase: number
  poidsBase: number
  tir: ClipPremierePersonne | null
  tempsTir: number
  poidsTir: number
}

export function nouvellePosePremierePersonne(): PosePremierePersonne {
  return { base: null, tempsBase: 0, poidsBase: 0, tir: null, tempsTir: 0, poidsTir: 0 }
}

function dernier(liste: ArrayLike<number>, frame: number): number {
  const i = firstAbove(liste, frame, true) - 1
  return i < 0 ? -Infinity : liste[i]
}

interface ClipsRig {
  recharge: ClipsRechargement
  coup: ClipPremierePersonne | null
  tir: ClipPremierePersonne | null
  grenade: ClipPremierePersonne | null
  changement: ClipPremierePersonne | null
  mise: ClipPremierePersonne | null
  sprintEntree: ClipPremierePersonne | null
  sprintSortie: ClipPremierePersonne | null
  sprint: ClipPremierePersonne | null
  sprintAir: ClipPremierePersonne | null
  accroupi: ClipPremierePersonne | null
  saut: ClipPremierePersonne | null
  receptionDouce: ClipPremierePersonne | null
  receptionForte: ClipPremierePersonne | null
  escalade: ClipPremierePersonne | null
  slideEntree: ClipPremierePersonne | null
  slideBoucle: ClipPremierePersonne | null
  slideSortie: ClipPremierePersonne | null
}

const clipsParRig = new WeakMap<RigPremierePersonne, ClipsRig>()

/** clipsVentDuRig: the rig's vent clips (`ClipsVent`), null when it lacks the enter or the loop. */
function clipsVentDuRig(rig: RigPremierePersonne): ClipsVent | null {
  const entree = clipDuRig(rig, 'vent_enter')
  const boucle = clipDuRig(rig, 'vent_loop')
  return entree && boucle ? { entree, boucle, sortie: clipDuRig(rig, 'vent_exit') } : null
}

function clipsDuRig(rig: RigPremierePersonne) {
  let clips = clipsParRig.get(rig)
  if (!clips) {
    clips = { recharge: { plein: clipDuRig(rig, 'reload_full'), vide: clipDuRig(rig, 'reload_empty'), entree: clipDuRig(rig, 'reload_enter'),
      boucle: clipDuRig(rig, 'reload_continue_full'), boucleVide: clipDuRig(rig, 'reload_continue_empty'),
      sortie: clipDuRig(rig, 'reload_exit') ?? clipDuRig(rig, 'chamber_1'), vent: clipsVentDuRig(rig) },
      coup: clipDuRig(rig, 'melee_strike_1'), tir: clipDuRig(rig, 'fire_1'),
      grenade: clipDuRig(rig, 'throw_grenade'), changement: clipDuRig(rig, 'ready'),
      mise: clipDuRig(rig, 'put_away'), sprint: clipDuRig(rig, 'sprint_loop'),
      sprintEntree: clipDuRig(rig, 'sprint_enter'), sprintSortie: clipDuRig(rig, 'sprint_exit'),
      sprintAir: clipDuRig(rig, 'sprint_loop_airborne'), accroupi: clipDuRig(rig, 'crouch'),
      saut: clipDuRig(rig, 'jump'), receptionDouce: clipDuRig(rig, 'land_soft'),
      receptionForte: clipDuRig(rig, 'land_hard'), escalade: clipDuRig(rig, 'clamber'),
      slideEntree: clipDuRig(rig, 'slide_enter'), slideBoucle: clipDuRig(rig, 'slide_loop'), slideSortie: clipDuRig(rig, 'slide_exit') }
    clipsParRig.set(rig, clips)
  }
  return clips
}

/** L'indice du premier changement de frame au-delà de `v` (la liste est triée par frame). */
function premierChangementAuDela(changements: ArrayLike<ChangementArme>, v: number): number {
  let lo = 0
  let hi = changements.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (changements[mid].frame <= v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Le film annonce l'arme tenue à la frame où le modèle en main change : le rangement de l'arme qui
 * part se joue donc avant cette frame, le tirage de celle qui arrive à partir d'elle. Positif : la
 * séquence entière se décale plus tard.
 */
export const DECALEMENT_CHANGEMENT_ARME = 0
/** Le fondu des deux phases du changement d'arme en main, en secondes. */
const FONDU_CHANGEMENT_ARME = 0.1

/**
 * PhaseChangementArme : la phase du changement de l'arme en main à l'image, pour le rig posé (celui
 * de l'arme tenue à l'image : celui qui part avant le changement, celui qui arrive après). `temps`
 * court de 0 à la durée du clip ; `poids` : fondu au début de la mise, fondu à la fin du tirage.
 */
export interface PhaseChangementArme {
  phase: 'mise' | 'pret'
  temps: number
  poids: number
}

/** Le tirage de l'arme qui part n'est pas fini : le changement précédent le tire trop récemment. */
function tirageRecent(
  changement: ChangementArme,
  index: number,
  changements: ArrayLike<ChangementArme>,
  fps: number,
  dureePret: number,
): boolean {
  if (dureePret <= 0) return false
  for (let j = index - 1; j >= 0; j--) {
    const antecedent = changements[j]
    if (antecedent.apres !== changement.avant) continue
    return (changement.frame - antecedent.frame) / fps < dureePret
  }
  return false
}

/**
 * phaseChangementArme : la phase du changement d'arme en main à l'image, pour le rig posé : la mise
 * de l'arme qui part (son clip `put_away`, dont la durée se termine à la frame du changement) puis,
 * de cette frame, le tirage de celle qui arrive (son clip `ready`). Pas de mise sans clip `put_away`,
 * sans arme qui part, ou quand le tirage de l'arme qui part n'a pas fini (changement précédent trop
 * récent) ; rien hors des deux fenêtres.
 */
export function phaseChangementArme(
  rig: RigPremierePersonne,
  changements: ArrayLike<ChangementArme>,
  frame: number,
  fps: number,
  decalage: number = DECALEMENT_CHANGEMENT_ARME,
): PhaseChangementArme | null {
  if (fps <= 0) return null
  const i = premierChangementAuDela(changements, frame - decalage * fps) - 1
  const suivant = i + 1 < changements.length ? changements[i + 1] : null
  if (suivant && suivant.avant !== null) {
    const clips = clipsDuRig(rig)
    const mise = clips.mise
    const debut = (frame - suivant.frame) / fps - decalage + (mise?.durationSeconds ?? 0)
    if (mise && mise.durationSeconds > 0 && debut >= 0 && debut < mise.durationSeconds) {
      if (!tirageRecent(suivant, i + 1, changements, fps, clips.changement?.durationSeconds ?? 0)) {
        // Le rangement du jeu est très court : son fondu d'entrée n'en prend jamais plus du quart.
        return { phase: 'mise', temps: debut, poids: Math.min(1, debut / Math.min(FONDU_CHANGEMENT_ARME, mise.durationSeconds / 4)) }
      }
    }
  }
  if (i >= 0) {
    const changement = changements[i]
    const temps = (frame - changement.frame) / fps - decalage
    const pret = clipsDuRig(rig).changement
    if (pret && pret.durationSeconds > 0 && temps >= 0 && temps < pret.durationSeconds) {
      // Le tirage part de l'arme hors champ : plein poids dès sa première image, fondu à sa fin seulement.
      return { phase: 'pret', temps, poids: Math.min(1, (pret.durationSeconds - temps) / FONDU_CHANGEMENT_ARME) }
    }
  }
  return null
}

/** Glissade : entree (si clip) au debut de l'intervalle, boucle jusqu'a la fin de l'intervalle,
 *  sortie (si clip) apres l'intervalle, pour sa propre duree. Poids 1 aux jonctions de phases ;
 *  fondu de 0.15 s uniquement au tout debut sans entree, et au tout bout sans sortie. */
function phaseGlisse(clips: ClipsRig, slide: IntervalleSprint | undefined, frame: number, fps: number): { clip: ClipPremierePersonne; temps: number; poids: number } | null {
  const boucle = clips.slideBoucle
  if (!slide || !boucle || boucle.durationSeconds <= 0 || frame < slide.t0) return null
  const tDebut = (frame - slide.t0) / fps
  const entree = clips.slideEntree
  if (entree && tDebut < entree.durationSeconds) return { clip: entree, temps: tDebut, poids: 1 }
  if (frame <= slide.t1) {
    const sortie = clips.slideSortie
    const poids = Math.min(entree ? 1 : tDebut / 0.15, entree || sortie ? 1 : (slide.t1 - frame) / fps / 0.15)
    return { clip: boucle, temps: (tDebut - (entree?.durationSeconds ?? 0)) % boucle.durationSeconds, poids }
  }
  const sortie = clips.slideSortie
  const tSortie = (frame - slide.t1) / fps
  if (sortie && tSortie < sortie.durationSeconds) return { clip: sortie, temps: tSortie, poids: Math.min(1, (sortie.durationSeconds - tSortie) / 0.15) }
  return null
}

type Mouvement = { clip: ClipPremierePersonne; temps: number; poids: number }

/** Une chute de plus d'une seconde utilise la réception forte. */
const DUREE_CHUTE_FORTE = 1

function boucle(clip: ClipPremierePersonne | null, intervalle: IntervalleSprint | undefined, e: EvenementsPremierePersonne): Mouvement | null {
  if (!clip || !intervalle || e.frame > intervalle.t1 || clip.durationSeconds <= 0) return null
  const temps = (e.frame - intervalle.t0) / e.fps
  return { clip, temps: clip.frameCount <= 2 ? 0 : temps % clip.durationSeconds,
    poids: Math.min(1, temps / 0.15, (intervalle.t1 - e.frame) / e.fps / 0.15) }
}

function uneFois(clip: ClipPremierePersonne | null, temps: number): Mouvement | null {
  if (!clip || temps < 0 || temps >= clip.durationSeconds) return null
  return { clip, temps, poids: Math.min(1, temps / 0.1, (clip.durationSeconds - temps) / 0.1) }
}

/** Les phases dépendent uniquement des bornes du sprint et de l'image courante. */
function phaseSprint(clips: ClipsRig, sprint: IntervalleSprint | undefined, e: EvenementsPremierePersonne, enAir: boolean): Mouvement | null {
  const loop = enAir ? clips.sprintAir ?? clips.sprint : clips.sprint
  if (!sprint || (!clips.sprintEntree && !clips.sprintSortie)) return boucle(loop, sprint, e)
  const debut = (e.frame - sprint.t0) / e.fps
  const fin = (sprint.t1 + 1 - sprint.t0) / e.fps
  const entree = clips.sprintEntree, sortie = clips.sprintSortie
  const court = !!entree && !!sortie && fin < entree.durationSeconds
  if (debut < fin && entree && debut < entree.durationSeconds) {
    return { clip: entree, temps: debut, poids: Math.min(1, debut / 0.15, court ? (fin - debut) / 0.15 : 1) }
  }
  const depuisFin = (e.frame - (sprint.t1 + 1)) / e.fps
  if (depuisFin >= 0 && sortie && depuisFin < sortie.durationSeconds) {
    const temps = depuisFin
    return { clip: sortie, temps, poids: Math.min(1, court ? temps / 0.15 : 1, (sortie.durationSeconds - temps) / 0.15) }
  }
  if (!loop || loop.durationSeconds <= 0 || debut >= fin) return null
  const temps = loop.frameCount <= 2 ? 0 : Math.max(0, debut - (entree?.durationSeconds ?? 0)) % loop.durationSeconds
  const poids = Math.min(1, entree ? 1 : debut / 0.15, sortie ? 1 : Math.max(0, (sprint.t1 - e.frame) / e.fps / 0.15))
  return { clip: loop, temps, poids }
}
function mouvement(clips: ClipsRig, e: EvenementsPremierePersonne): Mouvement | null {
  const slide = e.slides.findLast((s) => s.t0 <= e.frame)
  const saut = e.sauts.findLast((s) => s.t0 <= e.frame)
  const escalade = e.escalades.findLast((s) => s.t0 <= e.frame)
  const accroupi = e.accroupis.findLast((s) => s.t0 <= e.frame)
  const sprint = e.sprints.findLast((s) => s.t0 <= e.frame)
  let choix = slide && e.frame <= slide.t1 ? null : boucle(clips.accroupi, accroupi, e)
  const enAir = saut && e.frame <= saut.t1
  choix = phaseSprint(clips, sprint, e, !!enAir) ?? choix
  choix = phaseGlisse(clips, slide, e.frame, e.fps) ?? choix
  if (saut) {
    const depuisSaut = (e.frame - saut.t0) / e.fps
    const depuisReception = (e.frame - (saut.t1 + 1)) / e.fps
    const reception = (saut.t1 + 1 - saut.t0) / e.fps > DUREE_CHUTE_FORTE ? clips.receptionForte : clips.receptionDouce
    choix = uneFois(clips.saut, depuisSaut) ?? choix
    choix = uneFois(reception, depuisReception) ?? choix
  }
  if (escalade && e.frame <= escalade.t1) choix = uneFois(clips.escalade, (e.frame - escalade.t0) / e.fps) ?? choix
  return choix
}

export function posePremierePersonne(rig: RigPremierePersonne, e: EvenementsPremierePersonne, pose: PosePremierePersonne): PosePremierePersonne {
  pose.base = null
  pose.poidsBase = 0
  pose.tempsBase = 0
  pose.tir = null
  pose.tempsTir = 0
  pose.poidsTir = 0
  if (e.fps <= 0) return pose
  // Un tir ou un rechargement d'avant le dernier changement d'arme appartient à l'arme rangée :
  // il ne joue pas sur le rig de celle qui arrive.
  const rangChangement = premierChangementAuDela(e.changements, e.frame) - 1
  const depuis = rangChangement >= 0 ? e.changements[rangChangement].frame : -Infinity
  const dernierTir = dernier(e.tirs, e.frame)
  const coup = dernier(e.coups, e.frame)
  const tir = dernierTir < depuis ? -Infinity : dernierTir
  const clips = clipsDuRig(rig)
  const grenade = dernier(e.grenades, e.frame + 0.25 * e.fps)
  const tempsTir = (e.frame - tir) / e.fps
  const deplacement = tempsTir >= 0.3 ? mouvement(clips, e) : null
  if (deplacement) {
    pose.base = deplacement.clip
    pose.tempsBase = deplacement.temps
    pose.poidsBase = deplacement.poids
  }
  const phase = phaseChangementArme(rig, e.changements, e.frame, e.fps)
  if (phase) {
    const clip = phase.phase === 'pret' ? clips.changement : clips.mise
    if (clip && phase.temps < clip.durationSeconds) {
      pose.base = clip
      pose.tempsBase = phase.temps
      pose.poidsBase = phase.poids
    }
  }
  const tempsGrenade = (e.frame - grenade) / e.fps + 0.25
  if (clips.grenade && tempsGrenade < clips.grenade.durationSeconds) {
    pose.base = clips.grenade
    pose.tempsBase = tempsGrenade
  }
  const clipCoup = clips.coup
  const tempsCoup = (e.frame - coup) / e.fps
  // A staged reload weighs its own phases (full weight where one stage hands over to the next).
  let poidsRecharge: number | null = null
  const recharge = phaseRechargement(clips.recharge, e.rechargements, e.frame, e.fps, tir, depuis)
  if (recharge && e.rechargementValide(recharge.depuis, e.frame)) {
    pose.base = recharge.clip
    pose.tempsBase = recharge.temps
    poidsRecharge = recharge.poids
  }
  // L'usage d'un équipement, le tir du grappin ou le propulseur coupent le rechargement ; un coup les coupe.
  const usage = useAt(e.usages, e.frame)
  const clipUsage = usage ? clipDuRig(rig, usage.action) : null
  const tempsUsage = usage ? (e.frame - usage.frame) / e.fps : Infinity
  if (clipUsage && tempsUsage < clipUsage.durationSeconds) {
    pose.base = clipUsage
    pose.tempsBase = tempsUsage
    poidsRecharge = null
  }
  if (clipCoup && tempsCoup < clipCoup.durationSeconds) {
    pose.base = clipCoup
    pose.tempsBase = tempsCoup
    poidsRecharge = null
  }
  // Le poids du changement d'arme est calculé par la phase (fondu de la mise, fondus du tirage).
  if (poidsRecharge !== null) {
    pose.poidsBase = poidsRecharge
  } else if (pose.base && pose.base !== clips.changement && pose.base !== clips.mise && pose.base !== deplacement?.clip) {
    // Le coup part à plein poids : sa frappe tient dans le premier dixième de seconde du clip,
    // qu'un fondu d'entrée effacerait.
    const entree = pose.base === clipCoup ? 1 : pose.tempsBase / 0.1
    pose.poidsBase = Math.min(1, entree, (pose.base.durationSeconds - pose.tempsBase) / 0.1)
  }
  const clipTir = clips.tir
  // Un coup donné après le dernier tir en coupe l'animation : elle masquerait la frappe.
  const tirCoupe = pose.base === clipCoup && clipCoup !== null && coup >= tir
  if (clipTir && tempsTir < clipTir.durationSeconds && !tirCoupe) {
    pose.tir = clipTir
    pose.tempsTir = tempsTir
    pose.poidsTir = 1
  }
  return pose
}
