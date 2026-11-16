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
import { frameToMs } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady, ReplayFireBurstReady } from '../../../lib/replay/replayNormalize'
import { buildLivesBySlot, lifeOfSlotAt, soundPositionOfSlot } from '../model/livesPosition'
import { burstShotFrames } from '../model/fireBursts'
import { vehicleWeaponOf } from '../model/vehicleWeaponRegistry'
import { soundEvent, type ReplaySoundEvent } from './replaySoundVariants'
import { VEHICLE_SHOT_LOOPS } from './vehicleShotSound'

/**
 * OTHER_SHOOTER_GAIN_DB — THE GAP BETWEEN "MY GUN" AND "THEIRS" THAT DISTANCE ALONE DOES NOT MAKE.
 *
 * Owner's listening note (2026-11-16): another player's shot sounded "nearly as loud" as the
 * followed player's own. The spatial fall-off (`soundSpatial.ts`) ALREADY attenuates a shooter
 * beyond `SPATIAL_FULL_RADIUS` (3 map units) — but within it, a close enemy's shot plays at the
 * SAME full gain as the followed player's own shot, because the file and the base level are
 * identical: the game does not use one file for "my gun" and another for "theirs", it mixes
 * the first-person weapon on a hotter bus than the world's. This offset reproduces that bus
 * gap for every shooter who is NOT the one followed, on top of (never instead of) the distance
 * fall-off: a close enemy is now always a bit duller than our own shot, and a distant one
 * additionally fades with range, exactly as the spatial model already does for everyone else.
 */
export const OTHER_SHOOTER_GAIN_DB = -4

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
 *
 * `followed`: the followed player's own burst stays WITHOUT A PLACE (full, centered — the
 * audio perspective follows the life, not the camera, `soundPositionOfSlot`). Every other
 * shooter gets its map position AND `OTHER_SHOOTER_GAIN_DB`, so that even a shooter standing
 * within the full-level radius sounds duller than our own gun.
 */
export function fireBurstSoundEvents(
  doc: ReplayDocumentReady,
  stemOf: (w: string | undefined) => string | undefined,
  followed: string | null = null,
): ReplaySoundEvent[] {
  const out: ReplaySoundEvent[] = []
  const vies = buildLivesBySlot(doc.tracks)
  for (const b of doc.bursts) {
    const coup = stemOf(b.w)
    if (!coup) continue
    const own = followed !== null && lifeOfSlotAt(vies, b.slot, b.t0)?.xuid === followed
    const at = soundPositionOfSlot(vies, b.slot, b.t0, followed)
    const gainDb = own ? undefined : OTHER_SHOOTER_GAIN_DB
    const boucle = boucleDe(doc, b, coup)
    if (boucle) out.push(...sonsTenus(doc, b, boucle, boucle === coup ? undefined : coup, at, gainDb))
    else out.push(...coupsALaCadence(doc, b, coup, at, gainDb))
  }
  return out
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
  gainDb: number | undefined,
): ReplaySoundEvent[] {
  const out: ReplaySoundEvent[] = []
  let debut = b.t0
  for (const h of [...b.holes].sort((x, y) => x.t0 - y.t0)) {
    if (h.t0 > debut) out.push(tenu(doc, boucle, debut, h.t0, at, gainDb))
    debut = Math.max(debut, h.t1)
  }
  // A single-frame burst still holds one frame: that is the shortest trigger read.
  if (b.t1 > debut || (b.holes.length === 0 && b.t1 === b.t0)) {
    out.push(tenu(doc, boucle, debut, Math.max(b.t1, debut + 1), at, gainDb))
  }
  if (queue && b.b1 === 'released') out.push(withGain(soundEvent(frameToMs(b.t1, doc), queue, at), gainDb))
  return out
}

/** tenu — a held sound event between two frames. */
function tenu(
  doc: ReplayDocumentReady,
  stem: string,
  de: number,
  a: number,
  at: { x: number; y: number } | undefined,
  gainDb: number | undefined,
): ReplaySoundEvent {
  const ms = frameToMs(de, doc)
  return { ...withGain(soundEvent(ms, stem, at), gainDb), holdMs: frameToMs(a, doc) - ms }
}

/** coupsALaCadence — one shot per simulated shot, cut to the next; the last one sounds in full. */
function coupsALaCadence(
  doc: ReplayDocumentReady,
  b: ReplayFireBurstReady,
  coup: string,
  at: { x: number; y: number } | undefined,
  gainDb: number | undefined,
): ReplaySoundEvent[] {
  const instants = burstShotFrames(b, frameToMs(1, doc)).map((t) => frameToMs(t, doc))
  return instants.map((ms, i) => {
    const suivant = instants[i + 1]
    const e = withGain(soundEvent(ms, coup, at), gainDb)
    return suivant === undefined ? e : { ...e, cutMs: suivant - ms }
  })
}

/** withGain — attaches the event's level gain (`ReplaySoundEvent.gainDb`), absent = the file's level. */
function withGain(e: ReplaySoundEvent, gainDb: number | undefined): ReplaySoundEvent {
  return gainDb === undefined ? e : { ...e, gainDb }
}
