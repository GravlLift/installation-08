/**
 * fireBurstSound.ts — THE SOUND OF A FULL-AUTO FIRE BURST (schema 71, replay-feedback lot M4b).
 *
 * THE USER'S DECISION (Q5, approved): a SUSTAINED sound during the firing, from the start to the
 * end of the burst — not a loop that re-triggers the attack —, and the SHOT in the tail on release.
 * Two shapes, according to what the weapon has of delivered:
 *
 *  - A DELIVERED LOOP (Wasp LMG: `vehicleWeapons[w].loop`, recognized by `VEHICLE_SHOT_LOOPS`):
 *    it is HELD on each read passage of the burst (silent passages cut it), and the tail shot
 *    sounds on the READ release (`b1 = released`) — a release lost in a hole has no moment;
 *  - WITHOUT LOOP (Ghost, Banshee, Chopper, LMG, LAAG): the shot is replayed AT THE WEAPON'S RATE,
 *    each shot CUT to the next — that is the game container itself, in "trigger rate" mode
 *    (AkTransitionMode 5, V3 manifest: Ghost 0.130 s, Banshee 0.125 s, Chopper
 *    0.250 s, LMG 0.077 s, the firing period of each weapon). One voice per burst, never a wall;
 *    the last shot sounds in full;
 *  - A BEAM (beyond `CADENCE_FAISCEAU`, the Sentinel Ray at 60 shots per second: one
 *    shot per game tick): its shots no longer distinguish themselves, the weapon sound is HELD like a
 *    loop.
 *
 * A burst whose weapon has no sound (silence decided in the registry, weapon absent) stays silent.
 * The moments are those of `model/fireBursts.ts` — the same as the flashes.
 */
import { frameToMs, positionAt } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady, ReplayFireBurstReady, ReplayTrackReady } from '../../../lib/replay/replayNormalize'
import { buildLivesBySlot, lifeOfSlotAt } from '../model/livesPosition'
import { burstShotFrames } from '../model/fireBursts'
import { vehicleWeaponOf } from '../model/vehicleWeaponRegistry'
import { soundEvent, type ReplaySoundEvent } from './replaySoundVariants'
import { VEHICLE_SHOT_LOOPS } from './vehicleShotSound'

/**
 * CADENCE_FAISCEAU — beyond (shots per second), the firing is a BEAM: 60/s is one shot per
 * simulation tick (Sentinel Ray, read in its tag), and no projectile weapon read at
 * lot M4b exceeds 18/s (LAAG). The threshold separates the two measured families; a future weapon that
 * would fall between the two would be decided by ear.
 */
export const CADENCE_FAISCEAU = 30

/** The loops the client knows to hold (manifest `VEHICLE_SHOT_LOOPS`). */
const BOUCLES_CONNUES = new Set(Object.values(VEHICLE_SHOT_LOOPS))

/**
 * fireBurstSoundEvents — the sounds of the document's bursts. `stemOf` resolves the sound of a weapon
 * (`shotSoundStem` of the track: player weapons registry, then vehicle weapons).
 */
export function fireBurstSoundEvents(
  doc: ReplayDocumentReady,
  stemOf: (w: string | undefined) => string | undefined,
): ReplaySoundEvent[] {
  const out: ReplaySoundEvent[] = []
  const vies = buildLivesBySlot(doc.tracks)
  for (const b of doc.bursts) {
    const coup = stemOf(b.w)
    if (!coup) continue
    const at = positionOfSlot(vies, b.slot, b.t0)
    const boucle = boucleDe(doc, b, coup)
    if (boucle) out.push(...sonsTenus(doc, b, boucle, boucle === coup ? undefined : coup, at))
    else out.push(...coupsALaCadence(doc, b, coup, at))
  }
  return out
}

/**
 * positionOfSlot — the place where a burst starts: the position of the firing slot, at `t0` (the
 * biped that triggers, shared index of the gesture layers, `livesPosition.ts`). A slot without
 * a living life at that moment gives no place — the sound plays without a place, never invented.
 */
function positionOfSlot(vies: Map<number, ReplayTrackReady[]>, slot: number, frame: number): { x: number; y: number } | undefined {
  const vie = lifeOfSlotAt(vies, slot, frame)
  if (!vie) return undefined
  const p = positionAt(vie.points, frame)
  return p ? { x: p.x, y: p.y } : undefined
}

/** boucleDe — the HELD sound of a burst: the weapon's delivered loop, or its shot if it is a beam. */
function boucleDe(doc: ReplayDocumentReady, b: ReplayFireBurstReady, coup: string): string | undefined {
  const livree = vehicleWeaponOf(doc, b.w)?.loop
  if (livree && BOUCLES_CONNUES.has(livree)) return livree
  return b.rate >= CADENCE_FAISCEAU ? coup : undefined
}

/**
 * sonsTenus — the loop held on each READ passage of the burst, and the tail shot on the read release
 * (absent for a beam, whose loop IS the shot).
 */
function sonsTenus(
  doc: ReplayDocumentReady,
  b: ReplayFireBurstReady,
  boucle: string,
  queue: string | undefined,
  at: { x: number; y: number } | undefined,
): ReplaySoundEvent[] {
  const out: ReplaySoundEvent[] = []
  let debut = b.t0
  for (const h of [...b.holes].sort((x, y) => x.t0 - y.t0)) {
    if (h.t0 > debut) out.push(tenu(doc, boucle, debut, h.t0, at))
    debut = Math.max(debut, h.t1)
  }
  // A single-frame burst still holds one frame: that is the shortest trigger read.
  if (b.t1 > debut || (b.holes.length === 0 && b.t1 === b.t0)) {
    out.push(tenu(doc, boucle, debut, Math.max(b.t1, debut + 1), at))
  }
  if (queue && b.b1 === 'released') out.push(soundEvent(frameToMs(b.t1, doc), queue, at))
  return out
}

/** tenu — a held sound event between two frames. */
function tenu(
  doc: ReplayDocumentReady,
  stem: string,
  de: number,
  a: number,
  at: { x: number; y: number } | undefined,
): ReplaySoundEvent {
  const ms = frameToMs(de, doc)
  return { ...soundEvent(ms, stem, at), holdMs: frameToMs(a, doc) - ms }
}

/** coupsALaCadence — one shot per simulated shot, cut to the next; the last one sounds in full. */
function coupsALaCadence(
  doc: ReplayDocumentReady,
  b: ReplayFireBurstReady,
  coup: string,
  at: { x: number; y: number } | undefined,
): ReplaySoundEvent[] {
  const instants = burstShotFrames(b, frameToMs(1, doc)).map((t) => frameToMs(t, doc))
  return instants.map((ms, i) => {
    const suivant = instants[i + 1]
    const e = soundEvent(ms, coup, at)
    return suivant === undefined ? e : { ...e, cutMs: suivant - ms }
  })
}
