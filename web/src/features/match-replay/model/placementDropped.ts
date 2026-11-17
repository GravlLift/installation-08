// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * placementDropped.ts — WHAT A PLAYER LEAVES ON THE GROUND IN DYING, and the little that deserves to be seen.
 *
 * THE R2/W4 RULE SAID « NOTHING », AND IT WAS RIGHT FOR THE ESSENTIAL. Close to nine placements
 * out of ten of the corpus are DROPS ON DEATH (`origin: dropped`, measurement of 2026-08-18,
 * 11 films, 3 661 placements with measured placer): drawing them all would drown the wall and the sensor
 * under hundreds of points that say nothing about the terrain. That is why the overlay
 * shows only the DEPLOYED objects.
 *
 * THE USER AMENDED THIS RULE ON 2026-08-18, and the amendment is narrow:
 * « outside Fiesta it is tactically interesting (power-ups, power weapons, equipment
 * dropped on death) ». An over-shield on the ground changes what the next exchange is worth; a
 * fragmentation grenade on the ground, no. This file carries the LIST of what is worth it, and
 * nothing else.
 *
 * THE « EXCEPT FIESTA » RESTRICTION WAS LIFTED ON 2026-08-20: it was hiding 26 drops quite
 * real on the Fiesta witness `000d5950` (11 walls, 15 sensors), and the user wants to
 * see them. The « Objects dropped on the ground » setting alone governs, in all modes; no more
 * mode guard crosses it.
 *
 * THE DROPPED WEAPONS ARE NOT IN IT, AND IT IS NOT AN OVERSIGHT. `equipmentPlacements` is a
 * EQUIPMENT channel (tag `eqip`); `weaponPads` is a PAD channel (position where a weapon
 * REAPPEARS), not of drops. No field of the document says « such weapon is on the ground at (x, y)
 * since such frame ». The dropped power weapons therefore ask for an additional publication of
 * data, on the server side — that is a report written in the register, not a gap here.
 *
 * A DROP IS NOT THE ACTIVE OBJECT, and the measurement proves it: on the witness `000d5950`, the
 * 11 placements `wall/dropped` carry the identifier of the DEVICE (`0x8e2dc574`), never that of the
 * PANELS (`0x528fce46`) that the deployment produces. A wall on the ground is the device that its
 * carrier did not have time to use: it has no arc, no orientation, no range. Hence a
 * unique and discreet shape for all the drops (cf. `drawDroppedObject`), never the shape
 * of the family.
 */
import type { ReplayEquipmentPlacement } from '@/lib/api/types'

import { PAD_EQUIPMENT_FAMILIES } from './weaponPadFamilies'

/**
 * The « dropped on death » origin. STABLE identifier of the document (schema 10), never a label.
 *
 * The published vocabulary is `deployed` / `dropped` / `unknown`. `unknown` DOES NOT COUNT as
 * a drop: those are the placements without measured placer and the artifacts prior to schema 10,
 * still on disk and in production. Treating them as drops would make appear, over all that
 * fleet, objects of which nothing establishes that they fell.
 */
export const PLACEMENT_ORIGIN_DROPPED = 'dropped'

/**
 * THE DEPLOYABLE EQUIPMENTS of the manifest — those of which the drop is drawn.
 *
 * Those are exactly the families to which `PLACEMENT_RENDER` gives a shape of ACTIVE object,
 * `other` excepted: if an object deserves to be seen when it is placed, it deserves to be seen when
 * it lingers on the ground, pickable. `other` is set apart from it because its toggle is a
 * diagnostic tool (« an object is here, its nature is not established »): promoting to power object
 * what one cannot name would assert a stake that nothing establishes — same
 * reasoning as the `classic` default of the pads.
 *
 * THE LIST IS WRITTEN AND NOT DEDUCED from `PLACEMENT_RENDER`, for a reason of dependencies:
 * this module is read BY the overlay, deducing it would create a cycle. A guard-rail therefore replays the
 * correspondence in both directions (`placementDropped.guard.test.ts`) — that is the pattern
 * « helper + guard-rail » of CLAUDE.md no. 6, not a second truth.
 */
export const DROPPED_EQUIPMENT_FAMILIES: readonly string[] = [
  'wall',
  'sensor',
  'translocator_beacon',
  // THE SHROUD SCREEN joins here on 2026-08-27, at the same time as it gains its placed shape. The
  // guard-rail demands it and it is right: a family that is drawn DEPLOYED must be drawn
  // DROPPED, otherwise it disappears from the map at the death of its carrier.
  'shroud_screen',
  'threat_seeker',
  'repair_field',
]

/**
 * ALL THE POWER FAMILIES of which the drop is drawn: the deployable equipments,
 * plus the POWER-UPS.
 *
 * THE POWER-UPS COME FROM `PAD_EQUIPMENT_FAMILIES`, they are NOT recopied. It is the
 * EXPLICIT list that the user asked for on 2026-08-18 for the pads (« EXPLICIT list »),
 * and it already lives in two places of `weaponPadFamilies.ts` (the table of thumbnails and
 * `POWER_PAD_KEYS`). A third copy would be the copy too much (CLAUDE.md no. 6) — and the
 * first to diverge the day the title adds a power-up.
 *
 * NOT THERE, AND IT IS THE HALF OF THE RULE: the four grenades (59 to 63 % of the placements
 * of the corpus) and the three abilities (`grapple`, `thruster`, `repulsor`). The one and the
 * others are at `null` in `PLACEMENT_RENDER` — the decision not to draw them is already
 * taken, measured and written; this batch does not reopen it.
 */
export const PLACEMENT_DROPPED_FAMILIES: readonly string[] = [
  ...DROPPED_EQUIPMENT_FAMILIES,
  ...Object.keys(PAD_EQUIPMENT_FAMILIES),
]

/**
 * placementIsDroppedPower — is this placement a POWER object fallen on the ground?
 *
 * TWO CONDITIONS, AND NEITHER IS DEDUCED FROM THE OTHER: the measured origin is a drop, and
 * the family figures in the list above. A placement of unknown origin is never one
 * (cf. `PLACEMENT_ORIGIN_DROPPED`), and a dropped grenade neither, whatever its sharpness.
 *
 * THE IDENTIFIER IS NOT TESTED, unlike the deployed wall (`WALL_PANEL_IDS`). It is
 * deliberate and measured: the deployment of a wall publishes TWO placements (the flying device and its
 * panels), hence the filter on the deployed side; a drop publishes only one, that of the device.
 * There is nothing to de-duplicate.
 */
export function placementIsDroppedPower(p: ReplayEquipmentPlacement): boolean {
  if (p.origin !== PLACEMENT_ORIGIN_DROPPED) return false
  return PLACEMENT_DROPPED_FAMILIES.includes(p.family)
}
