// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * stuckGrenades3d.ts — A GRENADE STUCK POINT-BLANK, ON THE BODY IT STUCK TO.
 *
 * A point-blank stick (schema 129, `Grenade.deto`, the throw's surface `s` = 'biped') replicates no
 * flight and no attach record: the film carries the throw's frame (`t`, when the grenade is created
 * and sticks), the body type it stuck to, and the detonation's frame and position WITH its height
 * (`deto`). Drawn from the film alone, the grenade would not exist between the stick and the
 * explosion, yet in the game it rides the victim the whole time (9220185c, the game winner: KamUz's
 * plasma sticks to BC0R at frame 13193 and goes off at 13222, killing him from the grave).
 *
 * The body is the living player nearest the detonation point at the detonation (the published
 * point is ON that body); the grenade's place on it is the detonation point taken into that body's
 * frame (its position and heading at the last frame it is alive), so from the stick until the
 * explosion the grenade follows the body and turns with it, and lands exactly where the film puts
 * the explosion. Which bone it sits on is not in the film: the body frame (origin and heading) is
 * the gap filled here.
 */
import type { ReplayGrenadeReady } from '@/lib/replay/replayReadyTypes'

/** A body state as the scene samples it: position (Halo axes, world units), heading (Halo degrees). */
export interface BodyAt {
  x: number
  y: number
  z: number
  h: number
}

/** A grenade stuck to a body: drawn from `from` until `detoT` on slot `slot`, at `local` in its frame. */
export interface StuckGrenade {
  from: number
  detoT: number
  slot: number
  rank: number
  /** The offset in the body's frame: forward, left (Halo axes turned by the heading), up. */
  local: { fwd: number; left: number; up: number }
  /** The throw's index in `grenades` (the ledger's `grenade/<i>` when `grenades` is `doc.grenades`). */
  grenade: number
}

/** A stick farther than this from every body (u, horizontally) is not placed on one (~1.2 m). */
export const STUCK_BODY_REACH = 0.4

/**
 * stuckGrenadesOf: the point-blank sticks of `grenades` placed on the body they stuck to. `slots`
 * lists the biped slots that may carry one; `sample` answers a slot's body at a frame (null when it
 * is not alive). A stick whose body cannot be found is left out (its explosion still plays).
 */
export function stuckGrenadesOf(
  grenades: readonly ReplayGrenadeReady[],
  slots: readonly number[],
  sample: (slot: number, frame: number) => BodyAt | null,
): StuckGrenade[] {
  const out: StuckGrenade[] = []
  for (const [gi, g] of grenades.entries()) {
    const d = g.deto
    if (!d || g.proj !== undefined || g.s !== 'biped' || d.t <= g.t) continue
    let best: { slot: number; body: BodyAt; dist: number } | null = null
    for (const slot of slots) {
      // The victim usually dies on the detonation frame: his body at the frame before it.
      const body = sample(slot, d.t) ?? sample(slot, d.t - 1)
      if (!body || !sample(slot, g.t)) continue
      const dist = Math.hypot(body.x - d.x, body.y - d.y)
      if (dist <= STUCK_BODY_REACH && (!best || dist < best.dist)) best = { slot, body, dist }
    }
    if (!best) continue
    const a = (best.body.h * Math.PI) / 180
    const dx = d.x - best.body.x
    const dy = d.y - best.body.y
    out.push({
      from: g.t,
      detoT: d.t,
      slot: best.slot,
      rank: g.rank ?? -1,
      local: { fwd: dx * Math.cos(a) + dy * Math.sin(a), left: -dx * Math.sin(a) + dy * Math.cos(a), up: d.z - best.body.z },
      grenade: gi,
    })
  }
  return out
}

/** stuckPointAt: where stick `s` is on `body` (Halo axes), the body's frame turned back to the world. */
export function stuckPointAt(s: StuckGrenade, body: BodyAt): { x: number; y: number; z: number } {
  const a = (body.h * Math.PI) / 180
  return {
    x: body.x + s.local.fwd * Math.cos(a) - s.local.left * Math.sin(a),
    y: body.y + s.local.fwd * Math.sin(a) + s.local.left * Math.cos(a),
    z: body.z + s.local.up,
  }
}
