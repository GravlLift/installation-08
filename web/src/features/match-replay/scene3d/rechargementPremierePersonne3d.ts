/**
 * rechargementPremierePersonne3d.ts: WHICH FIRST-PERSON RELOAD CLIP PLAYS AT A FRAME, from the film's own
 * reload messages.
 *
 * STAGED RELOADS (measured 2026-11-15 on match 05dfe4e9, the only stored match with these weapons). The
 * Heatwave, Cindershot and Hydra graphs carry no `reload_full`: they carry `reload_enter`, one
 * `reload_continue_*` clip (one round) and `chamber_1` (the only rigs that do: 4 of 4 staged graphs, the
 * Sentinel Beam included, against 0 of the 22 magazine graphs). The film writes such a reload as one
 * message, then one or two messages (about 16 ms apart) at each round put in, then a repeated message at the
 * instant the last round is in. Heatwave: 0, 684/700, 1051/1068, 1418/1435, ... 2519/2519 ms; the gaps are
 * the clips' own lengths (enter 0.70 s, one round 0.37 s), Cindershot the same (0.63 s, 0.53 s). So the
 * count of stages IS the count of rounds the player loaded, and a nearly empty weapon takes longer. The
 * Hydra's stages come every 0.42 s, half its 0.83 s round clip: a stage's clip is fitted to the time the
 * film gives it.
 *
 * Messages are grouped into an EPISODE: groups of messages less than ECART_ETAPES_S apart, starting at a
 * reload start (`reloadStarts`). A magazine weapon plays its one clip from the episode's start, so the
 * extra messages of an episode no longer restart it.
 */
import type { ClipPremierePersonne } from './premierePersonne3d'

/** One stage of a reload: its first message, and whether it holds only repeated messages (`cuts`). */
export interface EtapeRechargement {
  t: number
  coupe: boolean
}

/** A reload episode of one life: its stages, the first one the reload start, in frames. */
export interface EpisodeRechargement {
  etapes: readonly EtapeRechargement[]
  /** The magazine was empty when the reload started (`magazineAtReload`); null when the film does not say. */
  vide: boolean | null
}

/** Messages within this many seconds of a stage's first message belong to that stage (measured: 16 to 34 ms). */
const PAIRE_S = 0.1
/** A gap longer than this ends an episode (measured stages: 0.37 to 0.70 s apart). */
const ECART_ETAPES_S = 1

/**
 * episodesRechargement groups a life's reload starts and cuts (frames, sorted) into episodes. An episode
 * begins at a start; a cut more than ECART_ETAPES_S after the last stage belongs to no episode.
 */
export function episodesRechargement(
  debuts: readonly number[],
  coupures: readonly number[],
  fps: number,
  vide: (debut: number) => boolean | null = () => null,
): EpisodeRechargement[] {
  const messages = [...debuts.map((t) => ({ t, coupe: false })), ...coupures.map((t) => ({ t, coupe: true }))]
    .sort((a, b) => a.t - b.t)
  const out: EpisodeRechargement[] = []
  let etapes: EtapeRechargement[] | null = null
  for (const m of messages) {
    const derniere = etapes?.at(-1)
    if (etapes && derniere && m.t - derniere.t <= PAIRE_S * fps) {
      derniere.coupe &&= m.coupe
      continue
    }
    if (etapes && derniere && m.t - derniere.t <= ECART_ETAPES_S * fps) {
      etapes.push({ t: m.t, coupe: m.coupe })
      continue
    }
    etapes = null
    if (m.coupe) continue
    etapes = [{ t: m.t, coupe: false }]
    out.push({ etapes, vide: vide(m.t) })
  }
  return out
}

/** The rig's reload clips: one clip, or a staged sequence. */
export interface ClipsRechargement {
  plein: ClipPremierePersonne | null
  vide: ClipPremierePersonne | null
  entree: ClipPremierePersonne | null
  boucle: ClipPremierePersonne | null
  boucleVide: ClipPremierePersonne | null
  sortie: ClipPremierePersonne | null
  /** The rig's vent clips (`vent_enter`, `vent_loop`, `vent_exit`), for a heat weapon with no reload clip. */
  vent?: ClipsVent | null
}

/**
 * The vent of a heat weapon. The Ravager, Plasma Pistol, Pulse Carbine and Stalker Rifle rigs carry no
 * reload clip but `vent_enter`, `vent_loop` and `vent_exit` (read from the first-person library,
 * 2026-11-15): their reload input vents the heat, and the film writes that as the same `weapon_reload`
 * message (match 05dfe4e9, TasteThePainbow's Ravager: two messages at 7:56.8 and 7:57.4, no shot after).
 */
export interface ClipsVent {
  entree: ClipPremierePersonne
  boucle: ClipPremierePersonne
  sortie: ClipPremierePersonne | null
}

/** The reload clip at a frame: its time, its weight, and the frame from which the reload must still be valid. */
export interface PhaseRechargement {
  clip: ClipPremierePersonne
  temps: number
  /** null: the caller's usual fades apply (a one-clip reload). */
  poids: number | null
  depuis: number
}

/** The fade at the very start and the very end of a reload, in seconds. */
const FONDU_S = 0.1
/** A last stage cut before this share of the expected round time was interrupted: no closing clip. */
const PART_FIN_NATURELLE = 0.75

/** The time `t` held inside the clip (a stage longer than its clip holds the last pose). */
function dans(clip: ClipPremierePersonne, t: number): number {
  return Math.min(Math.max(0, t), clip.durationSeconds * 0.999)
}

/** The last episode that started at or before `frame`. */
function episodeA(episodes: readonly EpisodeRechargement[], frame: number): EpisodeRechargement | null {
  let lo = 0
  let hi = episodes.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (episodes[mid].etapes[0].t <= frame) lo = mid + 1
    else hi = mid
  }
  return lo > 0 ? episodes[lo - 1] : null
}

/**
 * phaseRechargement: the reload clip of `episodes` at `frame`, or null. `tir`: the last shot at or before
 * the frame (a shot after the reload starts ends it; after its last stage, ends the closing clip). `depuis`:
 * the last weapon change (a reload before it belongs to the weapon put away). The caller still checks that
 * the reload is valid from `PhaseRechargement.depuis` to the frame (no death, swap or cut in between).
 */
export function phaseRechargement(
  clips: ClipsRechargement,
  episodes: readonly EpisodeRechargement[],
  frame: number,
  fps: number,
  tir: number,
  depuis: number,
): PhaseRechargement | null {
  const ep = episodeA(episodes, frame)
  if (!ep || fps <= 0) return null
  const debut = ep.etapes[0].t
  if (debut < depuis) return null
  if (!clips.plein && !clips.vide && !clips.entree && clips.vent) return phaseVent(clips.vent, ep, frame, fps, tir)
  const boucle = ep.vide ? clips.boucleVide ?? clips.boucle : clips.boucle ?? clips.boucleVide
  if (!clips.entree || !boucle || boucle.durationSeconds <= 0) {
    const clip = (ep.vide ? clips.vide ?? clips.plein : clips.plein ?? clips.vide) ?? clips.entree
    const temps = (frame - debut) / fps
    if (!clip || tir > debut || temps >= clip.durationSeconds) return null
    return { clip, temps, poids: null, depuis: debut }
  }
  return phaseEtagee(clips.entree, boucle, clips.sortie, ep.etapes, frame, fps, tir)
}

/**
 * A vent: the enter clip from the episode's first message, the loop held until the later of the
 * episode's last message and one full loop (the game's own clip lengths, from its animation tags), then
 * the exit clip. A shot after the vent starts ends it.
 */
function phaseVent(vent: ClipsVent, ep: EpisodeRechargement, frame: number, fps: number, tir: number): PhaseRechargement | null {
  const debut = ep.etapes[0].t
  if (tir > debut) return null
  const t = (frame - debut) / fps
  const entree = vent.entree.durationSeconds
  if (t < entree) return { clip: vent.entree, temps: dans(vent.entree, t), poids: Math.min(1, t / FONDU_S), depuis: debut }
  const finBoucle = Math.max((ep.etapes[ep.etapes.length - 1].t - debut) / fps, entree + vent.boucle.durationSeconds)
  if (t < finBoucle) {
    const d = vent.boucle.durationSeconds
    return { clip: vent.boucle, temps: d > 0 ? dans(vent.boucle, (t - entree) % d) : 0, poids: 1, depuis: debut }
  }
  const sortie = vent.sortie
  const u = t - finBoucle
  if (!sortie || u >= sortie.durationSeconds) return null
  return { clip: sortie, temps: dans(sortie, u), poids: Math.min(1, (sortie.durationSeconds - u) / FONDU_S), depuis: debut }
}

/** A staged reload: the enter clip, one round clip per stage fitted to the stage, then the closing clip. */
function phaseEtagee(
  entree: ClipPremierePersonne,
  boucle: ClipPremierePersonne,
  sortie: ClipPremierePersonne | null,
  etapes: readonly EtapeRechargement[],
  frame: number,
  fps: number,
  tir: number,
): PhaseRechargement | null {
  const debut = etapes[0].t
  // A shot during the reload ends it; a shot after its last stage ends the closing clip.
  if (tir > debut) return null
  let i = 0
  while (i + 1 < etapes.length && etapes[i + 1].t <= frame) i++
  const derniere = etapes.length - 1
  const etape = etapes[i]
  const suivante = i < derniere ? etapes[i + 1].t : null
  const depuisEtape = (frame - etape.t) / fps
  if (i === 0) {
    if (suivante === null && depuisEtape >= entree.durationSeconds) return null
    const sortieDeFin = suivante === null ? (entree.durationSeconds - depuisEtape) / FONDU_S : 1
    return { clip: entree, temps: dans(entree, depuisEtape), poids: Math.min(1, depuisEtape / FONDU_S, sortieDeFin), depuis: debut }
  }
  if (i === derniere && etape.coupe) {
    if (!sortie || !finNaturelle(etapes, boucle, fps) || depuisEtape >= sortie.durationSeconds) return null
    return { clip: sortie, temps: depuisEtape, poids: Math.min(1, (sortie.durationSeconds - depuisEtape) / FONDU_S), depuis: etape.t }
  }
  // A round cut short by the episode's last message keeps the episode's pace: only a stage the film
  // completes is fitted to its time.
  const coupee = i + 1 === derniere && etapes[derniere].coupe && !finNaturelle(etapes, boucle, fps)
  const duree = suivante !== null && !coupee ? (suivante - etape.t) / fps : dureeAttendue(etapes, i, boucle, fps)
  const cadence = Math.max(1, boucle.durationSeconds / duree)
  const temps = depuisEtape * cadence
  if (suivante === null && temps >= boucle.durationSeconds) return null
  const sortieDeFin = suivante === null ? (boucle.durationSeconds - temps) / cadence / FONDU_S : 1
  return { clip: boucle, temps: dans(boucle, temps), poids: Math.min(1, sortieDeFin), depuis: etape.t }
}

/** The time one round takes in this episode: the previous round's, else the round clip's. */
function dureeAttendue(etapes: readonly EtapeRechargement[], i: number, boucle: ClipPremierePersonne, fps: number): number {
  return i >= 2 ? (etapes[i].t - etapes[i - 1].t) / fps : boucle.durationSeconds
}

/**
 * finNaturelle: the last stage (repeated messages) closes the reload rather than cutting it: at least one
 * round went in, and the last round lasted most of the expected round time (a cut 0.13 s into a 0.53 s
 * round is an interruption).
 */
function finNaturelle(etapes: readonly EtapeRechargement[], boucle: ClipPremierePersonne, fps: number): boolean {
  const n = etapes.length - 1
  if (n < 2) return false
  const derniere = (etapes[n].t - etapes[n - 1].t) / fps
  return derniere >= PART_FIN_NATURELLE * Math.min(boucle.durationSeconds, dureeAttendue(etapes, n - 1, boucle, fps))
}
