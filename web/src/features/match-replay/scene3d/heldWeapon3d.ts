// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * heldWeapon3d.ts — EACH PLAYER'S HELD WEAPON, for the 3D view.
 *
 * The reading, shared with the HUD, accounts for the life's dated events.
 *
 * Readings only change on the whole frame: they are cached per frame and per slot, the view
 * requests one per player per screen frame.
 */
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import { catalogText } from '../i18n/catalogLabel'
import type { ReplayLocale } from '../i18n/i18n'
import { fxTintOf, type FxTint } from '../layers/fxInk'
import { weaponInHand, flagTeamInHand, handObject } from '../model/weaponInHand'

export interface HeldWeapon3d {
  id: string
  /** The weapon's name in the viewer's language; empty when the catalog does not carry it. */
  name: string
  /** The weapon's discharge type (the tint of its shots). */
  tint: FxTint
  /** The team of the CTF flag held instead of a weapon (its banner), absent for anything else. */
  flagTeam?: number
}

export class HeldWeapons3d {
  private frame = Number.NaN
  private readonly cache = new Map<number, HeldWeapon3d | null>()
  private readonly doc: ReplayDocumentReady
  private readonly locale: () => ReplayLocale

  constructor(doc: ReplayDocumentReady, locale: () => ReplayLocale) {
    this.doc = doc
    this.locale = locale
  }

  at(slot: number, frame: number): HeldWeapon3d | null {
    const f = Math.floor(frame)
    if (f !== this.frame) {
      this.frame = f
      this.cache.clear()
    }
    if (this.cache.has(slot)) return this.cache.get(slot) ?? null
    const read = heldWeaponAt(this.doc, slot, f, this.locale())
    this.cache.set(slot, read)
    return read
  }
}

export function heldWeaponAt(
  doc: ReplayDocumentReady,
  slot: number,
  frame: number,
  locale: ReplayLocale,
): HeldWeapon3d | null {
  // The carrier of the skull or of a flag holds it in hand: the weapon reading leaves it out (the HUD shows none), the 3D view shows it.
  const weapon = weaponInHand(doc, slot, frame)
  const held = weapon ?? handObject(doc, slot, frame)
  if (!held) return null
  const label = doc.weaponLabels?.[held.id]
  const read: HeldWeapon3d = { id: held.id, name: catalogText(label, locale) ?? '', tint: fxTintOf(label?.tint) }
  const flagTeam = weapon ? null : flagTeamInHand(doc, slot, frame)
  if (flagTeam !== null) read.flagTeam = flagTeam
  return read
}
