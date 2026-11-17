// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * riggedWeapons3d.ts — LES CLÉS DE MODÈLE DES RIGS DE PREMIÈRE PERSONNE QU'UN MATCH EMPLOIE.
 *
 * Un rig se charge à la première demande de son arme : pour que l'écran de chargement le couvre,
 * la scène le demande d'avance pour TOUTES les armes portées par un joueur du match (le
 * spectateur change de joueur suivi). Une arme portée l'est dans une dotation (`loadouts`) ou
 * par un changement d'arme (`weaponChanges`, dont `from` nomme l'arme rendue) : c'est l'union
 * complète de ce qui est porté. Les armes tirées ou lâchées l'ont été d'abord ; les socles de
 * carte sont des apparitions, jamais des armes portées, et n'entrent donc pas ici.
 */
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import { weaponModelKey } from './weaponModels3d'

/**
 * clesRigsRejeu : les clés de modèle (`weaponModelKey`) des armes portées par un joueur du
 * match, sans doublon ; les identifiants sans clé (grenades et autres) sont écartés.
 */
export function clesRigsRejeu(doc: ReplayDocumentReady): readonly string[] {
  const cles = new Set<string>()
  const ajouter = (id?: string) => { const cle = id && weaponModelKey(id); if (cle) cles.add(cle) }
  for (const loadout of doc.loadouts) for (const id of loadout.w) ajouter(id)
  for (const change of doc.weaponChanges) { ajouter(change.w); ajouter(change.from) }
  return [...cles]
}
