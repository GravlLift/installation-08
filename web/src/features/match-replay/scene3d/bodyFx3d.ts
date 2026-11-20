// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * bodyFx3d.ts — WHAT A PLAYER'S BODY SHOWS AT ONE FRAME: the state that the energy shell
 * (`bodyShell3d`) and the armor (`avatar3d.showBodyFx`) draw, read from the document and the
 * page's inputs.
 *
 * The shield comes from the player's track (`Tracks3d.shield`), the camo and overshield from the
 * equipment episodes of their life (`equip3d`), the team from the page's allegiance
 * (`pageAllegiance`), the colors from the theme's inks and settings. A single state object is
 * overwritten on every call (no allocation per player per frame): the caller consumes it right away.
 */
import * as THREE from 'three'

import type { ActionContext } from './actionScene3d'
import type { BodyFxState } from './bodyShell3d'
import { equipFxAt, NO_EQUIP_FX } from './equip3d'
import { ShieldHitAssets } from './shieldGenerator3d'
import { NO_SHIELD_FX } from './shields3d'

/** The overshield: the theme's ink paled toward white (a light shell, not a team tint). */
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
    shieldHit: null,
  }
  private readonly ctx: ActionContext
  /** The game's shield impact generator, from the weapon library (created once it is known). */
  private hitAssets: ShieldHitAssets | null = null

  constructor(ctx: ActionContext) {
    this.ctx = ctx
  }

  dispose(): void {
    this.hitAssets?.dispose()
    this.hitAssets = null
  }

  /** at: the body state of player `xuid` at frame `frame` (overwritten on every call). */
  at(xuid: string, frame: number): BodyFxState {
    const inputs = this.ctx.inputs()
    const fps = Math.max(1, inputs.framesPerSecond)
    const s = this.state
    this.ctx.tracks.shield(xuid, frame, s.shield)
    const slot = this.ctx.tracks.sample(xuid, frame)?.slot
    if (slot === undefined) Object.assign(s.equip, NO_EQUIP_FX)
    else equipFxAt(this.ctx.doc.equipmentEpisodes, slot, frame, fps, s.equip)
    s.phase = frame / fps
    // Team as seen by the page's player, not the tracked player: switching viewpoint or camera
    // recolors no one.
    s.ally = inputs.pageAllegiance.ofXuid(xuid)
    s.teamColor.copy(this.ctx.ink.of(s.ally === null ? inputs.inks.fx.core : inputs.inks.teamColorOf(s.ally)))
    s.overshieldColor.copy(this.ctx.ink.of(inputs.inks.body.overshield)).lerp(WHITE, OVERSHIELD_WHITE)
    s.camoColor.copy(this.ctx.ink.of(inputs.inks.fx.core))
    if (!this.hitAssets) {
      const base = this.ctx.weaponLibrary?.() ?? null
      if (base) this.hitAssets = new ShieldHitAssets(base)
    }
    s.shieldHit = this.hitAssets?.get() ?? null
    return s
  }
}
