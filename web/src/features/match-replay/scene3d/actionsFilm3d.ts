// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** Actions du film converties sur la grille et fin des sauts par la trajectoire verticale. */
import { framesPerSecond, msToFrames } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import { magazineAtReload } from '../model/reloadMagazine'
import { reloadReadings } from '../model/reloadStarts'

import type { Span } from './clipSelect3d'
import { episodesRechargement, type EpisodeRechargement } from './rechargementPremierePersonne3d'
import type { Tracks3d } from './tracks3d'

export function actionsParSlot(doc: ReplayDocumentReady, kind: string): Map<number, number[]> {
  const out = new Map<number, number[]>()
  for (const a of doc.actions) {
    if (a.kind !== kind) continue
    const list = out.get(a.slot) ?? []
    list.push(msToFrames(a.ms, doc))
    out.set(a.slot, list)
  }
  for (const list of out.values()) list.sort((a, b) => a - b)
  return out
}

/**
 * rechargementsParSlot: each life's reload starts and reload cuts on the frame grid
 * (`reloadStarts`: a repeated instant starts no reload, it ends the one under way).
 */
export function rechargementsParSlot(doc: ReplayDocumentReady): { debuts: Map<number, number[]>; coupures: Map<number, number[]> } {
  const debuts = new Map<number, number[]>()
  const coupures = new Map<number, number[]>()
  for (const [slot, r] of reloadReadings(doc)) {
    if (r.starts.length > 0) debuts.set(slot, r.starts.map((ms) => msToFrames(ms, doc)))
    if (r.cuts.length > 0) coupures.set(slot, r.cuts.map((ms) => msToFrames(ms, doc)))
  }
  return { debuts, coupures }
}

/**
 * episodesRechargementParSlot: each life's reload episodes (`episodesRechargement`) on the frame grid,
 * each marked with whether the in-hand magazine was empty at its start (`magazineAtReload`).
 */
export function episodesRechargementParSlot(doc: ReplayDocumentReady): Map<number, EpisodeRechargement[]> {
  const out = new Map<number, EpisodeRechargement[]>()
  const fps = framesPerSecond(doc)
  for (const [slot, r] of reloadReadings(doc)) {
    const parFrame = new Map(r.starts.map((ms) => [msToFrames(ms, doc), ms]))
    const vide = (frame: number) => {
      const ms = parFrame.get(frame)
      const reste = ms === undefined ? null : magazineAtReload(doc, slot, ms, r.starts)
      return reste === null ? null : reste === 0
    }
    const episodes = episodesRechargement([...parFrame.keys()], r.cuts.map((ms) => msToFrames(ms, doc)), fps, vide)
    if (episodes.length > 0) out.set(slot, episodes)
  }
  return out
}

/** Durée d'un palier vertical qui vaut réception quand aucune descente ne l'a précédé (sommet exclu). */
const PALIER_SANS_CHUTE_S = 0.2

/** Fin à la stabilisation verticale après mouvement, ou après 1,5 s sans réception observée. */
export function sautDepuisAction(doc: ReplayDocumentReady, tracks: Tracks3d, slot: number, debut: number): Span {
  const escalade = doc.stances.filter((s) => s.slot === slot && s.kind === 'clamber' && s.t0 >= debut)
    .reduce((fin, s) => Math.min(fin, s.t0), Infinity)
  const limite = Math.min(debut + msToFrames(1500, doc), escalade)
  const tr = doc.tracks.find((t) => t.slot === slot && t.xuid && (t.startFrame ?? t.points[0]?.t ?? Infinity) <= debut && (t.endFrame ?? t.points.at(-1)?.t ?? -Infinity) >= debut)
  const vie = tr?.xuid ? tracks.life(tr.xuid, debut) : null
  const sol = tracks.sampleSlot(slot, debut)?.z
  if (!vie || sol === undefined) return { t0: debut, t1: limite - 1 }
  let mouvement = false
  let chute = false
  let immobiles = 0
  let precedent = { t: debut, z: sol }
  let debutPalier = debut
  const fps = framesPerSecond(doc)
  for (const p of vie.pts) {
    if (p.t <= debut) continue
    if (p.t > limite) break
    if (p.g) return { t0: debut, t1: precedent.t - 1 }
    const vitesse = (p.z - precedent.z) * fps / (p.t - precedent.t)
    if (Math.abs(vitesse) > 0.1) {
      mouvement = true
      if (vitesse < 0) chute = true
      immobiles = 0
    } else if (mouvement) {
      if (immobiles++ === 0) debutPalier = precedent.t
      // Le sommet du saut est lui aussi un palier : sans descente vue, il faut un palier tenu.
      const tenu = chute ? immobiles >= 2 : p.t - debutPalier >= PALIER_SANS_CHUTE_S * fps
      if (tenu) return { t0: debut, t1: debutPalier - 1 }
    }
    precedent = p
  }
  return { t0: debut, t1: Math.min(limite, tr?.endFrame ?? tr?.points.at(-1)?.t ?? limite) - 1 }
}
