// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import type { HeldWeapon3d } from './heldWeapon3d'
import { postureFilm } from './posturesFilm3d'
import { weaponModelKey } from './weaponModels3d'
import type { ChangementArme } from './firstPersonActions3d'

export interface IntervalleSprint { t0: number; t1: number }

export function preparerEvenementsPremierePersonne(doc: ReplayDocumentReady, held: (slot: number, frame: number) => HeldWeapon3d | null) {
  const grenades = new Map<number, number[]>()
  const changements = new Map<number, ChangementArme[]>()
  const sprints = new Map<number, IntervalleSprint[]>()
  const slides = new Map<number, IntervalleSprint[]>()
  const candidats = new Map<number, Set<number>>()
  for (const g of doc.grenades) {
    const liste = grenades.get(g.slot) ?? []
    liste.push(g.t); grenades.set(g.slot, liste)
  }
  for (const s of doc.stances) if (s.kind === 'sprint') {
    const liste = sprints.get(s.slot) ?? []
    liste.push(postureFilm(s, doc)); sprints.set(s.slot, liste)
  }
  for (const s of doc.stances) if (s.kind === 'slide') {
    const liste = slides.get(s.slot) ?? []
    liste.push(postureFilm(s, doc)); slides.set(s.slot, liste)
  }
  // Tout ce qui peut faire basculer l'arme en main date un candidat : rangée, inventaire, prises,
  // bascules du sélecteur et lectures de chargeur (une lecture datée en ms agit à l'image suivante).
  const candidat = (slot: number, t: number) => {
    const temps = candidats.get(slot) ?? new Set<number>()
    temps.add(t); candidats.set(slot, temps)
  }
  for (const liste of [doc.loadouts, doc.inventory, doc.weaponChanges, doc.drawnWeapons]) for (const r of liste) candidat(r.slot, r.t)
  for (const l of doc.ammoReads) if (l.src === 'delta') { candidat(l.slot, l.t); candidat(l.slot, l.t + 1) }
  for (const [slot, temps] of candidats) {
    const liste: ChangementArme[] = []
    for (const t of [...temps].sort((a, b) => a - b)) {
      const avant = held(slot, t - 1), apres = held(slot, t)
      if (avant && apres && avant.id !== apres.id) {
        liste.push({ frame: t, avant: weaponModelKey(avant.id), apres: weaponModelKey(apres.id) })
      }
    }
    changements.set(slot, liste)
  }
  for (const liste of grenades.values()) liste.sort((a, b) => a - b)
  for (const liste of sprints.values()) liste.sort((a, b) => a.t0 - b.t0)
  for (const liste of slides.values()) liste.sort((a, b) => a.t0 - b.t0)
  return { grenades, changements, sprints, slides }
}
