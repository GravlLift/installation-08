/**
 * carrierPosition.ts — WHERE THE GLYPH OF AN OBJECTIVE CARRIER IS DRAWN, and nothing else.
 *
 * THE FACT, MEASURED ON THE SERVER SIDE. A player attached to a vehicle STOPS REPLICATING ITS
 * WORLD POSITION (written precondition of `replay/vehicle_rides.go:12-15`): its bipode trajectory
 * no longer has a sample between boarding and dismounting. `positionAt` (replayLogic.ts) then
 * does what it is asked to do — it LINEARLY INTERPOLATES between the last point before
 * boarding and the first point after dismounting. The piece, for its part, is already removed during
 * the episode (`replayMarkers.ts`, `MarkerStyle.embarkedAtSlot`); the CARRIED GLYPH, not so: bomb,
 * skull, carried flag and VIP crown were thus crossing the scenery in a straight line, alone.
 *
 * THE SHIPPED DECISION (user, 2026-09-05, « option 1 »): during the episode, the glyph is
 * drawn ON THE VEHICLE — it follows the mount's trajectory, at the SAME interpolation as the
 * sprite (`vehiclePositionAt`, the single writing of a vehicle's position at a frame), so
 * that the glyph and the vehicle coincide on screen down to the pixel.
 *
 * THE KEY IS THE XUID, because it is the one the objective layers already hold: a
 * carrying period names its carrier by its xuid, never by a bipode slot. And the episode
 * of occupation names it the same way (`VehicleRide.xuid`) — it is even the PRIORITY SOURCE
 * of its identity for the vehicle's tint and name, for the exact reason that concerns us
 * here: during the episode, the slot->player bridge is silent. AN EPISODE WITHOUT XUID MOVES NO
 * GLYPH: the fallback is the bipode position, that is, the pre-this-batch behavior —
 * never an invented position, never a second identity bridge to maintain.
 *
 * INDEPENDENT OF THE VEHICLE LAYER'S TOGGLE (contract, and it is a decision): the glyph
 * follows the vehicle even when the user has turned off that layer. The position of a carrier is a
 * FACT OF THE DOCUMENT, not a decoration of the layer; the toggle only commands what is DRAWN.
 * It therefore deliberately diverges from `Vehicles.isEmbarkedAt` — that one follows the toggle, because
 * hiding a piece without showing its vehicle would make a player disappear with no setting to
 * bring it back (adversarial review of 2026-09-02, point 7). Here the call is the reverse: layer
 * off, the piece returns to ITS interpolated position (false, but that is the accepted regime of the
 * toggle) while the glyph keeps the only true position at our disposal.
 *
 * ONE PATH FOR FIVE LAYERS. The five consumers (carried bomb, VIP crown,
 * Oddball skull, carried flag, Assault blast) call `useCarrierPosAt` and nothing else:
 * the rule « embarked -> vehicle, otherwise bipode » is written HERE, once
 * (`positionOfCarrierAt`), and `carrierPosition.guard.test.ts` forbids it being copied elsewhere.
 */
import { useMemo } from 'react'

import { buildPlayerPosAt, type PlayerPosAt } from './livesPosition'
import type { XY } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady, ReplayVehicleTrackReady } from '../../../lib/replay/replayNormalize'
import { vehicleCanEmbark, vehiclePositionAt } from './vehiclesLayer'

/** The position of an EMBARKED player at a frame, or `null` (it is not embarked, or it is unknown). */
export type EmbarkedPosAt = (xuid: string, frame: number) => XY | null

/** An occupation episode reduced to what the position needs: its window and its mount. */
interface EmbarkedEpisode {
  t0: number
  t1: number
  vehicle: ReplayVehicleTrackReady
}

/**
 * buildEmbarkedPosAt — the index of occupation episodes BY XUID, then the mount's position.
 *
 * Same construction and same filter as `buildEmbarkedPredicate` (vehiclesLayer.ts): the episodes
 * of ALL vehicles are gathered ONCE, and only the lives that pass `vehicleCanEmbark`
 * enter it — no scenery, no unresolved chassis. The filter must stay the SAME as the one of the
 * piece's predicate, otherwise a false episode would move a glyph to where it hides no piece (the three
 * episodes lent to the Falcon prop of artifact `0d76e8f1`, on 2026-09-02, while the Falcon was
 * still refused by its family; since 2026-09-24 it is the server's guards that hold
 * these false episodes).
 *
 * The predicate, for its part, indexes by SLOT: that is what the piece layer holds. Here it is the xuid —
 * two keys for two callers, not two rules of occupation.
 */
export function buildEmbarkedPosAt(
  vehicles: readonly ReplayVehicleTrackReady[],
): EmbarkedPosAt {
  const byXuid = new Map<string, EmbarkedEpisode[]>()
  for (const vehicle of vehicles) {
    if (!vehicleCanEmbark(vehicle)) continue
    for (const ride of vehicle.rides) {
      if (!ride.xuid) continue
      const episode: EmbarkedEpisode = { t0: ride.t0, t1: ride.t1, vehicle }
      const list = byXuid.get(ride.xuid)
      if (list) list.push(episode)
      else byXuid.set(ride.xuid, [episode])
    }
  }
  if (byXuid.size === 0) return () => null
  return (xuid, frame) => {
    const list = byXuid.get(xuid)
    if (!list) return null
    for (const episode of list) {
      if (frame < episode.t0 || frame > episode.t1) continue
      const at = vehiclePositionAt(episode.vehicle, frame)
      if (at) return at
    }
    return null
  }
}

/**
 * positionOfCarrierAt — THE RULE, in a single writing: embarked -> the vehicle's position;
 * otherwise -> the bipode's position, as the layers were reading it until now.
 *
 * The fallback covers three cases, all « pre-this-batch behavior »: the player is not aboard,
 * the episode does not name it, or the mount has NO position at this frame (neither a sample nor a
 * read birth — `vehiclePositionAt` refuses to invent one).
 */
export function positionOfCarrierAt(
  embarkedAt: EmbarkedPosAt,
  bipedAt: PlayerPosAt,
  xuid: string,
  frame: number,
): XY | null {
  return embarkedAt(xuid, frame) ?? bipedAt(xuid, frame)
}

/** buildCarrierPosAt — the full rereading of a document, for non-React builders. */
export function buildCarrierPosAt(doc: ReplayDocumentReady): PlayerPosAt {
  const embarkedAt = buildEmbarkedPosAt(doc.vehicles)
  const bipedAt = buildPlayerPosAt(doc)
  return (xuid, frame) => positionOfCarrierAt(embarkedAt, bipedAt, xuid, frame)
}

/** useCarrierPosAt — the same rereading, memoized for the layer hooks. */
export function useCarrierPosAt(doc: ReplayDocumentReady): PlayerPosAt {
  return useMemo(() => buildCarrierPosAt(doc), [doc])
}
