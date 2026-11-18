// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import type { HeldWeapon3d } from './heldWeapon3d'
import { filmPosture } from './posturesFilm3d'
import { weaponModelKey } from './weaponModels3d'
import type { ChangementArme } from './firstPersonActions3d'

export interface IntervalleSprint { t0: number; t1: number }

export function preparerEvenementsPremierePersonne(doc: ReplayDocumentReady, held: (slot: number, frame: number) => HeldWeapon3d | null) {
  const grenades = new Map<number, number[]>()
  const changes = new Map<number, ChangementArme[]>()
  const sprints = new Map<number, IntervalleSprint[]>()
  const slides = new Map<number, IntervalleSprint[]>()
  const candidates = new Map<number, Set<number>>()
  for (const g of doc.grenades) {
    const list = grenades.get(g.slot) ?? []
    list.push(g.t); grenades.set(g.slot, list)
  }
  for (const s of doc.stances) if (s.kind === 'sprint') {
    const list = sprints.get(s.slot) ?? []
    list.push(filmPosture(s, doc)); sprints.set(s.slot, list)
  }
  for (const s of doc.stances) if (s.kind === 'slide') {
    const list = slides.get(s.slot) ?? []
    list.push(filmPosture(s, doc)); slides.set(s.slot, list)
  }
  // Anything that can flip the weapon in hand marks a candidate frame: loadout, inventory, grabs,
  // selector flips and magazine reads (a read timed in ms acts on the following frame).
  const candidate = (slot: number, t: number) => {
    const times = candidates.get(slot) ?? new Set<number>()
    times.add(t); candidates.set(slot, times)
  }
  for (const list of [doc.loadouts, doc.inventory, doc.weaponChanges, doc.drawnWeapons]) for (const r of list) candidate(r.slot, r.t)
  for (const l of doc.ammoReads) if (l.src === 'delta') { candidate(l.slot, l.t); candidate(l.slot, l.t + 1) }
  for (const [slot, times] of candidates) {
    const list: ChangementArme[] = []
    for (const t of [...times].sort((a, b) => a - b)) {
      const avant = held(slot, t - 1), apres = held(slot, t)
      if (avant && apres && avant.id !== apres.id) {
        list.push({ frame: t, avant: weaponModelKey(avant.id), apres: weaponModelKey(apres.id) })
      }
    }
    changes.set(slot, list)
  }
  for (const list of grenades.values()) list.sort((a, b) => a - b)
  for (const list of sprints.values()) list.sort((a, b) => a.t0 - b.t0)
  for (const list of slides.values()) list.sort((a, b) => a.t0 - b.t0)
  return { grenades, changements: changes, sprints, slides }
}
