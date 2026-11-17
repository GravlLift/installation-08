// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * bodyFx3d.ts — CE QUE LE CORPS D'UN JOUEUR MONTRE À UNE IMAGE : l'état que la coque d'énergie
 * (`bodyShell3d`) et l'armure (`avatar3d.showBodyFx`) dessinent, lu dans le document et les entrées
 * de la page.
 *
 * Le bouclier vient de la piste du joueur (`Tracks3d.shield`), le camouflage et le surbouclier des
 * épisodes d'équipement de sa vie (`equip3d`), le camp de l'allégeance de la page
 * (`pageAllegiance`), les couleurs des encres du thème et des réglages. Un seul état est
 * réécrit à chaque appel (aucune allocation par joueur et par image) : l'appelant le consomme aussitôt.
 */
import * as THREE from 'three'

import type { ActionContext } from './actionScene3d'
import type { BodyFxState } from './bodyShell3d'
import { equipFxAt, NO_EQUIP_FX } from './equip3d'
import { NO_SHIELD_FX } from './shields3d'

/** Le surbouclier : l'encre du thème pâlie de blanc (une coque claire, pas une teinte de camp). */
const OVERSHIELD_WHITE = 0.45
const WHITE = new THREE.Color(1, 1, 1)

export class BodyFx3d {
  private readonly state: BodyFxState = {
    shield: { ...NO_SHIELD_FX },
    equip: { ...NO_EQUIP_FX },
    phase: 0,
    ally: null,
    teamColor: new THREE.Color(),
    overshieldColor: new THREE.Color(),
    camoColor: new THREE.Color(),
  }
  private readonly ctx: ActionContext

  constructor(ctx: ActionContext) {
    this.ctx = ctx
  }

  /** at : l'état du corps du joueur `xuid` à l'image `frame` (réécrit à chaque appel). */
  at(xuid: string, frame: number): BodyFxState {
    const inputs = this.ctx.inputs()
    const fps = Math.max(1, inputs.framesPerSecond)
    const s = this.state
    this.ctx.tracks.shield(xuid, frame, s.shield)
    const slot = this.ctx.tracks.sample(xuid, frame)?.slot
    if (slot === undefined) Object.assign(s.equip, NO_EQUIP_FX)
    else equipFxAt(this.ctx.doc.equipmentEpisodes, slot, frame, fps, s.equip)
    s.phase = frame / fps
    // Le camp vu du joueur de la page, pas du joueur suivi : changer de point de vue ou de caméra
    // ne recolore personne.
    s.ally = inputs.pageAllegiance.ofXuid(xuid)
    s.teamColor.copy(this.ctx.ink.of(s.ally === null ? inputs.inks.fx.core : inputs.inks.teamColorOf(s.ally)))
    s.overshieldColor.copy(this.ctx.ink.of(inputs.inks.body.overshield)).lerp(WHITE, OVERSHIELD_WHITE)
    s.camoColor.copy(this.ctx.ink.of(inputs.inks.fx.core))
    return s
  }
}
