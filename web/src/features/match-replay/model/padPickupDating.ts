// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * padPickupDating.ts — THE PICKUP OF A PAD, DATED BY THE NATIVE EVENT WHEN THE FILM SAYS IT.
 *
 * FIXED ON 2026-10-22 (detonations batch, item 2, continuation of control no. 21 of the v8
 * controls: a power-up pad seen as « uncertain » while a player had just passed). The server
 * publishes `padPickups[].t`/`.xuid` — the exact instant and the picker — for any occupation that the
 * native pickup (`biped_pickup`) dates unambiguously, WEAPON AS WELL AS POWER-UP since the same batch
 * (`pad_pickup_dating.go`, join on the canonical slug on the power-up side). This module applies THIS
 * date to the `[tLow, tHigh]` window of the occupation it designates — before even the refinement by
 * proximity (`padPresenceRefine.ts`), which stays the fallback of the occupations no native pickup
 * covers: THE GRAMMAR OUTRANKS THE HEURISTIC.
 *
 * THE WINDOW COLLAPSES, IT DOES NOT DISAPPEAR: `tLow` AND `tHigh` take the dated value, separated
 * by [PAD_BETWEEN_FRAMES] so as never to reach the « never emptied » sentinel of `padStateAt`
 * (`tHigh <= tLow`) — same guarantee, same reason as `padPresenceRefine.ts`. The state therefore goes from
 * FULL to EMPTY in a fraction of a frame (at worst one frame painted « uncertain », invisible in
 * practice), where it stayed uncertain up to twenty seconds — and `padStateAt`/`padRespawnAt`
 * need no other change: they already read `tLow`/`tHigh` without knowing where they
 * come from.
 *
 * WHAT THIS MODULE DOES NOT DO: date an occupation the server did not date. An occupation
 * without a matching `padPickups[].t` passes UNCHANGED — it stays on the refinement by
 * proximity, or on the raw interval if nothing approaches it.
 *
 * THE PICKER (`pickupXuid`) IS CAPTURED, WITHOUT A READER FOR NOW. The pad's tooltip
 * (`ReplayWeaponPadTip.tsx`) keeps its « two lines at most » decision (user feedback of
 * 2026-08-28) and the old surface that was to show it (the table « Control of special
 * weapons ») was removed on 2026-10-07: no page names this picker yet. The
 * field stays on the occupation, tested, so that it need not be redone the day a surface
 * shows it — not a dead computation, a measured datum without a reader.
 *
 * Pure: no React dependency, no canvas.
 */
import type { ReplayDocumentReady, ReplayWeaponPadReady } from '../../../lib/replay/replayNormalize'
import { PAD_BETWEEN_FRAMES } from './padPresenceRefine'

/** An occupation whose instant comes from a native pickup carries its picker in addition. */
export type DatedPadPresence = ReplayWeaponPadReady['presence'][number] & {
  /** XUID of the picker, decimal — same shape as Track.xuid. Absent if the native pickup
   *  did not name a player (life not bridged), present even without a resolved player, otherwise never. */
  pickupXuid?: string
}

/** clePickup — the join key PadPickup <-> occupation: (pad index, tLow, tHigh). */
function clePickup(pad: number, tLow: number, tHigh: number): string {
  return `${pad}|${tLow}|${tHigh}`
}

/**
 * applyPadPickupDating — the same pads, of which the occupations `padPickups` dates carry
 * now the EXACT instant (collapsed window) and the picker.
 *
 * REFERENCE PRESERVED WHEN NOTHING CHANGES, same convention as `refinePadPresence`: a pad
 * without a dated occupation is returned AS IS.
 */
export function applyPadPickupDating(
  pads: readonly ReplayWeaponPadReady[],
  padPickups: ReplayDocumentReady['padPickups'],
): readonly ReplayWeaponPadReady[] {
  if (!padPickups || padPickups.length === 0) return pads
  const parCle = new Map<string, { t: number; xuid?: string }>()
  for (const p of padPickups) {
    if (p.t === undefined || p.t === null) continue
    parCle.set(clePickup(p.pad, p.tLow, p.tHigh), { t: p.t, xuid: p.xuid ?? undefined })
  }
  if (parCle.size === 0) return pads
  let touche = false
  const out = pads.map((pad, i) => {
    let touchePad = false
    const presence = pad.presence.map((occ) => {
      const date = parCle.get(clePickup(i, occ.tLow, occ.tHigh))
      if (!date) return occ
      touchePad = true
      const datee: DatedPadPresence = { ...occ, tLow: date.t, tHigh: date.t + PAD_BETWEEN_FRAMES }
      if (date.xuid !== undefined) datee.pickupXuid = date.xuid
      return datee
    })
    if (!touchePad) return pad
    touche = true
    return { ...pad, presence }
  })
  return touche ? out : pads
}
