// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { clipDuRig, type ClipPremierePersonne, type RigPremierePersonne } from './premierePersonne3d'
import { useAt, type UseShot } from './equipmentUse3d_logic'
import type { IntervalleSprint } from './evenementsPremierePersonne3d'
import { firstAbove } from './recoilShots3d'
import { phaseRechargement, type ClipsRechargement, type ClipsVent, type EpisodeRechargement } from './rechargementPremierePersonne3d'

/**
 * ChangementArme: the swap of the held weapon at a frame, with the model key of the weapon that
 * leaves (`avant`) and the one that arrives (`apres`); null on the absent side.
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
  /** Uses that play a game clip (carried equipment, grapple, thruster), sorted by frame. */
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

/** lastAtOrBefore: the last entry of `list` at or before `frame`, or -Infinity if none. */
function lastAtOrBefore(list: ArrayLike<number>, frame: number): number {
  const i = firstAbove(list, frame, true) - 1
  return i < 0 ? -Infinity : list[i]
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

const clipsByRig = new WeakMap<RigPremierePersonne, ClipsRig>()

/** ventClipsForRig: the rig's vent clips (`ClipsVent`), null when it lacks the enter or the loop. */
function ventClipsForRig(rig: RigPremierePersonne): ClipsVent | null {
  const entree = clipDuRig(rig, 'vent_enter')
  const boucle = clipDuRig(rig, 'vent_loop')
  return entree && boucle ? { entree, boucle, sortie: clipDuRig(rig, 'vent_exit') } : null
}

function clipsForRig(rig: RigPremierePersonne) {
  let clips = clipsByRig.get(rig)
  if (!clips) {
    clips = { recharge: { plein: clipDuRig(rig, 'reload_full'), vide: clipDuRig(rig, 'reload_empty'), entree: clipDuRig(rig, 'reload_enter'),
      boucle: clipDuRig(rig, 'reload_continue_full'), boucleVide: clipDuRig(rig, 'reload_continue_empty'),
      sortie: clipDuRig(rig, 'reload_exit') ?? clipDuRig(rig, 'chamber_1'), vent: ventClipsForRig(rig) },
      coup: clipDuRig(rig, 'melee_strike_1'), tir: clipDuRig(rig, 'fire_1'),
      grenade: clipDuRig(rig, 'throw_grenade'), changement: clipDuRig(rig, 'ready'),
      mise: clipDuRig(rig, 'put_away'), sprint: clipDuRig(rig, 'sprint_loop'),
      sprintEntree: clipDuRig(rig, 'sprint_enter'), sprintSortie: clipDuRig(rig, 'sprint_exit'),
      sprintAir: clipDuRig(rig, 'sprint_loop_airborne'), accroupi: clipDuRig(rig, 'crouch'),
      saut: clipDuRig(rig, 'jump'), receptionDouce: clipDuRig(rig, 'land_soft'),
      receptionForte: clipDuRig(rig, 'land_hard'), escalade: clipDuRig(rig, 'clamber'),
      slideEntree: clipDuRig(rig, 'slide_enter'), slideBoucle: clipDuRig(rig, 'slide_loop'), slideSortie: clipDuRig(rig, 'slide_exit') }
    clipsByRig.set(rig, clips)
  }
  return clips
}

/** The index of the first weapon change past `v` (the list is sorted by frame). */
function firstChangeAfter(changements: ArrayLike<ChangementArme>, v: number): number {
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
 * The film reports the held weapon at the frame where the model in hand changes: so the outgoing
 * weapon's holster plays before this frame, and the incoming one's draw starts from it. Positive:
 * the whole sequence shifts later.
 */
export const DECALEMENT_CHANGEMENT_ARME = 0
/** The fade between the two phases of the held weapon change, in seconds. */
const WEAPON_CHANGE_FADE = 0.1

/**
 * PhaseChangementArme: the phase of the held weapon change at this frame, for the posed rig (the
 * one for the weapon held at this frame: the one that leaves before the change, or the one that
 * arrives after). `temps` runs from 0 to the clip's duration; `poids`: fades in at the start of
 * the holster, fades out at the end of the draw.
 */
export interface PhaseChangementArme {
  phase: 'mise' | 'pret'
  temps: number
  poids: number
}

/** The outgoing weapon's draw isn't finished: the previous change drew it too recently. */
function drawTooRecent(
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
 * phaseChangementArme: the phase of the held weapon change at this frame, for the posed rig: the
 * outgoing weapon's holster (its `put_away` clip, whose duration ends at the change's frame),
 * then from that frame, the incoming one's draw (its `ready` clip). No holster without a
 * `put_away` clip, without an outgoing weapon, or when the outgoing weapon's draw hasn't finished
 * (previous change too recent); nothing outside the two windows.
 */
export function phaseChangementArme(
  rig: RigPremierePersonne,
  changements: ArrayLike<ChangementArme>,
  frame: number,
  fps: number,
  decalage: number = DECALEMENT_CHANGEMENT_ARME,
): PhaseChangementArme | null {
  if (fps <= 0) return null
  const i = firstChangeAfter(changements, frame - decalage * fps) - 1
  const suivant = i + 1 < changements.length ? changements[i + 1] : null
  if (suivant && suivant.avant !== null) {
    const clips = clipsForRig(rig)
    const mise = clips.mise
    const debut = (frame - suivant.frame) / fps - decalage + (mise?.durationSeconds ?? 0)
    if (mise && mise.durationSeconds > 0 && debut >= 0 && debut < mise.durationSeconds) {
      if (!drawTooRecent(suivant, i + 1, changements, fps, clips.changement?.durationSeconds ?? 0)) {
        // The game's holster is very short: its fade-in never takes more than a quarter of it.
        return { phase: 'mise', temps: debut, poids: Math.min(1, debut / Math.min(WEAPON_CHANGE_FADE, mise.durationSeconds / 4)) }
      }
    }
  }
  if (i >= 0) {
    const changement = changements[i]
    const temps = (frame - changement.frame) / fps - decalage
    const pret = clipsForRig(rig).changement
    if (pret && pret.durationSeconds > 0 && temps >= 0 && temps < pret.durationSeconds) {
      // The draw starts from the weapon offscreen: full weight from its first frame, fading out only at the end.
      return { phase: 'pret', temps, poids: Math.min(1, (pret.durationSeconds - temps) / WEAPON_CHANGE_FADE) }
    }
  }
  return null
}

/** Slide: entry (if there is a clip) at the start of the interval, loop until the end of the
 *  interval, exit (if there is a clip) after the interval, for its own duration. Weight 1 at
 *  phase boundaries; a 0.15 s fade only right at the start with no entry, and right at the end
 *  with no exit. */
function slidePhase(clips: ClipsRig, slide: IntervalleSprint | undefined, frame: number, fps: number): { clip: ClipPremierePersonne; temps: number; poids: number } | null {
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

type Movement = { clip: ClipPremierePersonne; temps: number; poids: number }

/** A fall longer than one second uses the hard landing. */
const HARD_LANDING_FALL_DURATION = 1

function loopMotion(clip: ClipPremierePersonne | null, intervalle: IntervalleSprint | undefined, e: EvenementsPremierePersonne): Movement | null {
  if (!clip || !intervalle || e.frame > intervalle.t1 || clip.durationSeconds <= 0) return null
  const temps = (e.frame - intervalle.t0) / e.fps
  return { clip, temps: clip.frameCount <= 2 ? 0 : temps % clip.durationSeconds,
    poids: Math.min(1, temps / 0.15, (intervalle.t1 - e.frame) / e.fps / 0.15) }
}

function once(clip: ClipPremierePersonne | null, temps: number): Movement | null {
  if (!clip || temps < 0 || temps >= clip.durationSeconds) return null
  return { clip, temps, poids: Math.min(1, temps / 0.1, (clip.durationSeconds - temps) / 0.1) }
}

/** The phases depend only on the sprint's bounds and the current frame. */
function sprintPhase(clips: ClipsRig, sprint: IntervalleSprint | undefined, e: EvenementsPremierePersonne, enAir: boolean): Movement | null {
  const loop = enAir ? clips.sprintAir ?? clips.sprint : clips.sprint
  if (!sprint || (!clips.sprintEntree && !clips.sprintSortie)) return loopMotion(loop, sprint, e)
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
function movement(clips: ClipsRig, e: EvenementsPremierePersonne): Movement | null {
  const slide = e.slides.findLast((s) => s.t0 <= e.frame)
  const saut = e.sauts.findLast((s) => s.t0 <= e.frame)
  const escalade = e.escalades.findLast((s) => s.t0 <= e.frame)
  const accroupi = e.accroupis.findLast((s) => s.t0 <= e.frame)
  const sprint = e.sprints.findLast((s) => s.t0 <= e.frame)
  let choix = slide && e.frame <= slide.t1 ? null : loopMotion(clips.accroupi, accroupi, e)
  const enAir = saut && e.frame <= saut.t1
  choix = sprintPhase(clips, sprint, e, !!enAir) ?? choix
  choix = slidePhase(clips, slide, e.frame, e.fps) ?? choix
  if (saut) {
    const depuisSaut = (e.frame - saut.t0) / e.fps
    const depuisReception = (e.frame - (saut.t1 + 1)) / e.fps
    const reception = (saut.t1 + 1 - saut.t0) / e.fps > HARD_LANDING_FALL_DURATION ? clips.receptionForte : clips.receptionDouce
    choix = once(clips.saut, depuisSaut) ?? choix
    choix = once(reception, depuisReception) ?? choix
  }
  if (escalade && e.frame <= escalade.t1) choix = once(clips.escalade, (e.frame - escalade.t0) / e.fps) ?? choix
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
  // A shot or reload from before the last weapon change belongs to the holstered weapon:
  // it doesn't play on the rig of the one that's arriving.
  const rangChangement = firstChangeAfter(e.changements, e.frame) - 1
  const depuis = rangChangement >= 0 ? e.changements[rangChangement].frame : -Infinity
  const dernierTir = lastAtOrBefore(e.tirs, e.frame)
  const coup = lastAtOrBefore(e.coups, e.frame)
  const tir = dernierTir < depuis ? -Infinity : dernierTir
  const clips = clipsForRig(rig)
  const grenade = lastAtOrBefore(e.grenades, e.frame + 0.25 * e.fps)
  const tempsTir = (e.frame - tir) / e.fps
  const deplacement = tempsTir >= 0.3 ? movement(clips, e) : null
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
  // Using a piece of equipment, firing the grapple, or the thruster all cut the reload; a melee strike cuts them too.
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
  // The weight of a weapon change is computed by the phase (holster's fade-in, draw's fades).
  if (poidsRecharge !== null) {
    pose.poidsBase = poidsRecharge
  } else if (pose.base && pose.base !== clips.changement && pose.base !== clips.mise && pose.base !== deplacement?.clip) {
    // A melee strike starts at full weight: its hit lands in the clip's first tenth of a second,
    // which a fade-in would erase.
    const entree = pose.base === clipCoup ? 1 : pose.tempsBase / 0.1
    pose.poidsBase = Math.min(1, entree, (pose.base.durationSeconds - pose.tempsBase) / 0.1)
  }
  const clipTir = clips.tir
  // A melee strike given after the last shot cuts its animation: it would hide the strike.
  const tirCoupe = pose.base === clipCoup && clipCoup !== null && coup >= tir
  if (clipTir && tempsTir < clipTir.durationSeconds && !tirCoupe) {
    pose.tir = clipTir
    pose.tempsTir = tempsTir
    pose.poidsTir = 1
  }
  return pose
}
