// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * heldWeapon3d.ts — L'ARME EN MAIN de chaque joueur, pour la vue 3D.
 *
 * La lecture commune avec l'ATH tient compte des événements datés de la vie.
 *
 * Les lectures ne changent qu'à l'image entière : elles se gardent par image et par emplacement,
 * la vue en demande une par joueur et par image d'écran.
 */
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import { catalogText } from '../i18n/catalogLabel'
import type { ReplayLocale } from '../i18n/i18n'
import { fxTintOf, type FxTint } from '../layers/fxInk'
import { armeEnMain, flagTeamInHand, objetEnMain } from '../model/armeEnMain'

export interface HeldWeapon3d {
  id: string
  /** Le nom de l'arme dans la langue du lecteur ; vide quand le catalogue ne le porte pas. */
  name: string
  /** La nature de décharge de l'arme (la teinte de ses tirs). */
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
  const weapon = armeEnMain(doc, slot, frame)
  const held = weapon ?? objetEnMain(doc, slot, frame)
  if (!held) return null
  const label = doc.weaponLabels?.[held.id]
  const read: HeldWeapon3d = { id: held.id, name: catalogText(label, locale) ?? '', tint: fxTintOf(label?.tint) }
  const flagTeam = weapon ? null : flagTeamInHand(doc, slot, frame)
  if (flagTeam !== null) read.flagTeam = flagTeam
  return read
}
