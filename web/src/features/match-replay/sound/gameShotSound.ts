// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * gameShotSound.ts — A SHOT AS THE GAME PLAYS IT: its near, mid and far layers at once, each a
 * random draw among its takes, each fading with distance on its own curve.
 *
 * The shipped weapon sounds are one file per weapon: two shooters of the same weapon firing
 * together played the same sample and phased, and a shot sounded the same at 2 and at 60 units.
 * Where the extraction found the weapon's own shot (`FootstepManifest.shots`, 15 weapons), every
 * event of the track playing that weapon's stem becomes one event per layer:
 *  - the TAKE is drawn at playback among the layer's (`variants`, as any RandomSequence), so no
 *    two shots replay the same file in step;
 *  - the LEVEL keeps the game's balance between the layers (their authored volumes) with the
 *    loudest layer at 0 dB: the game's own levels run up to +13.5 dB on full-scale takes and
 *    would clip, the buses that tame them in the game are not read, and at 0 dB the near layer
 *    matches the shipped file it replaces (the Bandit's: -19.0 dB mean against -18.9);
 *  - the PLACE and the event's own gain carry over; a placed shot fades on each layer's falloff
 *    (`spatialOf`), the followed player's own shot (no place) is heard at distance zero: only
 *    the layers audible there play.
 * The weapon's RANGED variation (`WEAPON_SOUND_VARIATIONS`) is drawn per layer (`weapon`).
 * INFERRED: whether the game draws its randomizers per layer or per shot is not read.
 */
import { falloffOf, layersOf, type FootstepManifest } from './footstepManifest'
import type { ReplaySoundEvent } from './replaySoundVariants'
import { falloffGain } from './soundSpatial'

/**
 * withGameShots — the track with every shot of a weapon the manifest has a shot for replaced by
 * its layers. Held sounds (a burst's loop, `holdMs`) are left as they are.
 */
export function withGameShots(track: readonly ReplaySoundEvent[], manifest: FootstepManifest): ReplaySoundEvent[] {
  const shots = manifest.shots
  if (!shots || Object.keys(shots).length === 0) return [...track]
  const layered = new Map<string, ReturnType<typeof shotLayers>>()
  const out: ReplaySoundEvent[] = []
  for (const e of track) {
    const entry = e.holdMs === undefined ? shots[e.stem] : undefined
    if (!entry) {
      out.push(e)
      continue
    }
    let layers = layered.get(e.stem)
    if (layers === undefined) {
      layers = shotLayers(manifest, e.stem)
      layered.set(e.stem, layers)
    }
    if (!layers) {
      out.push(e)
      continue
    }
    for (const l of layers) {
      const ev: ReplaySoundEvent = { ...e, stem: l.stems[0], weapon: e.stem }
      delete ev.variants
      if (l.stems.length > 1) ev.variants = l.stems
      let gainDb = (e.gainDb ?? 0) + l.gainDb
      if (e.at) {
        if (l.falloff) ev.falloff = l.falloff
      } else if (l.falloff) {
        // The followed player's own shot: heard where it is fired.
        const g = falloffGain(l.falloff, 0)
        if (g <= 0) continue
        gainDb += 20 * Math.log10(g)
      }
      ev.gainDb = gainDb
      out.push(ev)
    }
  }
  return out
}

/** One layer of a shot, ready to play: its take stems, its level against the shot's loudest layer, its falloff. */
interface ShotLayer {
  stems: string[]
  gainDb: number
  falloff?: ReturnType<typeof falloffOf>
}

/**
 * shotLayers — the playable layers of a weapon's shot, or `null` when it has none. A layer plays
 * at its first take's volume and falloff: within a layer of the game's shots they are all the
 * same (measured on the 15 extracted, 2026-11-19).
 */
function shotLayers(manifest: FootstepManifest, stem: string): ShotLayer[] | null {
  const layers = layersOf(manifest.shots?.[stem])
  if (!layers) return null
  const out: ShotLayer[] = layers.map((takes) => ({
    stems: takes.map((t) => t.stem),
    gainDb: takes[0].gainDb ?? 0,
    falloff: falloffOf(manifest, takes[0]),
  }))
  const loudest = Math.max(...out.map((l) => l.gainDb))
  for (const l of out) l.gainDb -= loudest
  return out
}
