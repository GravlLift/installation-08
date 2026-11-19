// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * gameShotSound.ts — A SHOT AS THE GAME PLAYS IT, in its two versions.
 *
 * The shipped weapon sounds are one file per weapon: two shooters of the same weapon firing
 * together played the same sample and phased, and a shot sounded the same at 2 and at 60 units.
 * Where the extraction found the weapon's own shot (`FootstepManifest.shots`, 15 weapons), every
 * event of the track playing that weapon's stem becomes one event per layer:
 *  - ANOTHER PLAYER'S shot (placed) plays the third-person event: near, mid and far layers, each
 *    fading with distance on its own curve (`spatialOf`);
 *  - the FOLLOWED PLAYER'S own shot (no place) plays the first-person event
 *    (`FootstepManifest.shotsFirstPerson`): a stereo take drawn among 30, a low thump and a
 *    mechanical click, heard in 2D. The third-person near layer alone, heard at distance zero,
 *    lacked that low end and attack (measured 2026-11-19: the S7's near take carries 9.6 dB
 *    less under 150 Hz than the shipped file, its first-person take 3.5 dB more). Without a
 *    first-person event the third-person layers audible at distance zero play instead.
 * In both:
 *  - the TAKE is drawn at playback among the layer's (`variants`, as any RandomSequence), so no
 *    two shots replay the same file in step;
 *  - the LEVEL keeps the game's balance between the layers (their authored volumes), the
 *    loudest the shot gets at any distance at 0 dB. The game's own levels run up to +13 dB on
 *    full-scale takes and would clip; the buses (and the HDR window, INFERRED) that tame them in
 *    the game are not read. Anchoring the loudest authored layer instead left the S7's near
 *    layer 4 dB down, since its loudest (+10 dB, far) layer is silent under 20 units;
 *  - the PLACE and the event's own gain carry over.
 * The weapon's RANGED variation (`WEAPON_SOUND_VARIATIONS`) is drawn per layer (`weapon`).
 * INFERRED: whether the game draws its randomizers per layer or per shot is not read.
 */
import { falloffOf, layersOf, type FootstepEntry, type FootstepManifest } from './footstepManifest'
import type { ReplaySoundEvent } from './replaySoundVariants'
import { falloffGain } from './soundSpatial'

/**
 * withGameShots — the track with every shot of a weapon the manifest has a shot for replaced by
 * its layers. Held sounds (a burst's loop, `holdMs`) are left as they are.
 */
export function withGameShots(track: readonly ReplaySoundEvent[], manifest: FootstepManifest): ReplaySoundEvent[] {
  const shots = manifest.shots
  if (!shots || Object.keys(shots).length === 0) return [...track]
  const layered = new Map<string, ShotLayer[] | null>()
  const layersFor = (key: string, entry: FootstepEntry | undefined) => {
    let layers = layered.get(key)
    if (layers === undefined) {
      layers = shotLayers(manifest, entry)
      layered.set(key, layers)
    }
    return layers
  }
  const out: ReplaySoundEvent[] = []
  for (const e of track) {
    const entry = e.holdMs === undefined ? shots[e.stem] : undefined
    if (!entry) {
      out.push(e)
      continue
    }
    const own = !e.at
    const firstPerson = own ? layersFor(`1p:${e.stem}`, manifest.shotsFirstPerson?.[e.stem]) : null
    const layers = firstPerson ?? layersFor(`3p:${e.stem}`, entry)
    if (!layers) {
      out.push(e)
      continue
    }
    for (const l of layers) {
      const ev: ReplaySoundEvent = { ...e, stem: l.stems[0], weapon: e.stem }
      delete ev.variants
      if (l.stems.length > 1) ev.variants = l.stems
      let gainDb = (e.gainDb ?? 0) + l.gainDb
      if (!own) {
        if (l.falloff) ev.falloff = l.falloff
      } else if (l.falloff) {
        // The own shot without a first-person event: heard where it is fired.
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

/** One layer of a shot, ready to play: its take stems, its level against the shot's peak, its falloff. */
interface ShotLayer {
  stems: string[]
  gainDb: number
  falloff?: ReturnType<typeof falloffOf>
}

/**
 * shotLayers — the playable layers of a shot, or `null` when it has none. A layer plays at its
 * first take's volume and falloff: within a layer of the game's shots they are all the same
 * (measured on the 15 extracted, 2026-11-19).
 */
function shotLayers(manifest: FootstepManifest, entry: FootstepEntry | undefined): ShotLayer[] | null {
  const layers = layersOf(entry)
  if (!layers) return null
  const out: ShotLayer[] = layers.map((takes) => ({
    stems: takes.map((t) => t.stem),
    gainDb: takes[0].gainDb ?? 0,
    falloff: falloffOf(manifest, takes[0]),
  }))
  const peak = Math.max(...out.map(peakDb))
  for (const l of out) l.gainDb -= peak
  return out
}

/** peakDb — the loudest a layer gets at any distance: its volume plus its falloff's highest point. */
function peakDb(l: ShotLayer): number {
  if (!l.falloff || l.falloff.length === 0) return l.gainDb
  const top = Math.max(...l.falloff.map((p) => falloffGain(l.falloff!, p[0])))
  return top > 0 ? l.gainDb + 20 * Math.log10(top) : -Infinity
}
