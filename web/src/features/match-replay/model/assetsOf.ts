import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import { weaponModelKey } from '../scene3d/weaponModels3d'

export function assetsOf(doc: ReplayDocumentReady) {
  const weapons = new Set<string>()
  const add = (id?: string | null) => { const key = id && weaponModelKey(id); if (key) weapons.add(key) }
  for (const shot of doc.shots) add(shot.w)
  for (const loadout of doc.loadouts) for (const id of loadout.w) add(id)
  for (const change of doc.weaponChanges) { add(change.w); add(change.from) }
  for (const item of doc.groundWeapons) add(item.w)
  for (const pad of doc.weaponPads) add(pad.weapon)
  for (const pad of doc.mapWeaponPads?.pads ?? []) add(pad.family)
  return {
    weapons: [...weapons],
    grenades: [...new Set(doc.grenades.map((g) => g.rank))],
    xuids: [...new Set([...doc.roster.map((p) => p.xuid), ...doc.tracks.map((p) => p.xuid)].filter((x): x is string => !!x))],
  }
}
