// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import type { HeldWeapon3d } from './heldWeapon3d'
import { postureFilm } from './posturesFilm3d'
import { weaponModelKey } from './weaponModels3d'
import type { WeaponSwitch } from './firstPersonActions3d'

export interface SprintInterval { t0: number; t1: number }

export function prepareFirstPersonEvents(doc: ReplayDocumentReady, held: (slot: number, frame: number) => HeldWeapon3d | null) {
  const grenades = new Map<number, number[]>()
  const changes = new Map<number, WeaponSwitch[]>()
  const sprints = new Map<number, SprintInterval[]>()
  const slides = new Map<number, SprintInterval[]>()
  const candidates = new Map<number, Set<number>>()
  for (const g of doc.grenades) {
    const list = grenades.get(g.slot) ?? []
    list.push(g.t); grenades.set(g.slot, list)
  }
  for (const s of doc.stances) if (s.kind === 'sprint') {
    const list = sprints.get(s.slot) ?? []
    list.push(postureFilm(s, doc)); sprints.set(s.slot, list)
  }
  for (const s of doc.stances) if (s.kind === 'slide') {
    const list = slides.get(s.slot) ?? []
    list.push(postureFilm(s, doc)); slides.set(s.slot, list)
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
    const list: WeaponSwitch[] = []
    for (const t of [...times].sort((a, b) => a - b)) {
      const before = held(slot, t - 1), after = held(slot, t)
      if (before && after && before.id !== after.id) {
        list.push({ frame: t, before: weaponModelKey(before.id), after: weaponModelKey(after.id) })
      }
    }
    changes.set(slot, list)
  }
  for (const list of grenades.values()) list.sort((a, b) => a - b)
  for (const list of sprints.values()) list.sort((a, b) => a.t0 - b.t0)
  for (const list of slides.values()) list.sort((a, b) => a.t0 - b.t0)
  return { grenades, weaponSwitches: changes, sprints, slides }
}
