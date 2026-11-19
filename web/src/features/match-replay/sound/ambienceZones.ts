// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ambienceZones.ts — THE MAP'S ACOUSTIC ZONES: ground polygons, each extruded from a floor up to
 * a ceiling, each bound to a looping bed ("room tone") the game authored for that place.
 *
 * WHERE THEY COME FROM: the server (`internal/ambience`) extracts, per map, one loop per acoustic
 * zone and serves the whole layout of a match as JSON (`/api/matches/<id>/ambience.json`); the
 * loops themselves are separate files served on demand. Zones OVERLAP: a huge fallback zone covers
 * the whole world and the rooms sit inside the bigger areas.
 *
 * THE RULE (`ambienceLoopAt`): the zone that CONTAINS the listener and has the SMALLEST volume
 * (polygon area x height) wins; when no zone contains it, or there is no listener (2D view), the
 * `fallback` loop sounds. This is the same smallest-area lookup the HUD uses for its place names
 * (`mapCallouts.calloutAt`); `inPolygon` is imported, not copied.
 */
import { inPolygon } from '../model/mapCallouts'

/** One acoustic zone as the server's layout JSON says it. `loop` is empty for a zone with no bed
 * (a reverb-only room); `reverb` names its sound environment, a key of the layout's `reverbs`. */
export interface AmbienceZone {
  zone: number
  loop: string
  reverb?: string
  floor: number
  height: number
  points: [number, number][]
}

/** One sound environment's impulse response: its file and the game's wet level (dB). */
export interface AmbienceReverb {
  file: string
  wetDb: number
  durationMs?: number
}

/** The layout served at `/api/matches/<id>/ambience.json`. */
export interface AmbienceLayout {
  fallback: string
  files: Record<string, string>
  gains?: Record<string, number>
  zones: AmbienceZone[]
  reverbs?: Record<string, AmbienceReverb>
  fallbackReverb?: string
}

/** A zone prepared for many lookups: volume, XY box and the polygon to test. */
interface PreparedAmbienceZone {
  loop: string
  volume: number
  floor: number
  top: number
  minX: number
  maxX: number
  minY: number
  maxY: number
  points: readonly (readonly [number, number])[]
}

/** The layout ready for per-frame lookups. */
export interface PreparedAmbience {
  fallback: string
  zones: PreparedAmbienceZone[]
}

/** prepareAmbienceZones precomputes each zone's volume and XY box; broken zones are dropped
 * (fewer than 3 points, no height, a loop with no served file). */
export function prepareAmbienceZones(layout: AmbienceLayout): PreparedAmbience {
  return prepareZones(layout.fallback, layout.zones, (z) => (layout.files[z.loop] !== undefined ? z.loop : null))
}

/**
 * prepareReverbZones — the same lookup keyed by sound environment: `ambienceLoopAt` on the result
 * answers the reverb of the smallest containing zone that names one, `fallbackReverb` elsewhere
 * (empty when the map names none). Zones whose reverb was not extracted are dropped.
 */
export function prepareReverbZones(layout: AmbienceLayout): PreparedAmbience {
  const reverbs = layout.reverbs ?? {}
  return prepareZones(layout.fallbackReverb ?? '', layout.zones, (z) => (z.reverb && reverbs[z.reverb] ? z.reverb : null))
}

function prepareZones(fallback: string, all: AmbienceZone[], keyOf: (z: AmbienceZone) => string | null): PreparedAmbience {
  const zones = all
    .filter((z) => z.points.length >= 3 && z.height > 0 && keyOf(z) !== null)
    .map((z) => {
      let area = 0
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      const p = z.points
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        area += p[j][0] * p[i][1] - p[i][0] * p[j][1]
        minX = Math.min(minX, p[i][0])
        maxX = Math.max(maxX, p[i][0])
        minY = Math.min(minY, p[i][1])
        maxY = Math.max(maxY, p[i][1])
      }
      return {
        loop: keyOf(z) as string,
        volume: (Math.abs(area) / 2) * z.height,
        floor: z.floor,
        top: z.floor + z.height,
        minX,
        maxX,
        minY,
        maxY,
        points: p,
      }
    })
  return { fallback, zones }
}

/**
 * ambienceLoopAt — the loop to play at a position: the containing zone with the smallest volume,
 * the fallback when none contains it or the listener is absent. Without a z, only XY is tested.
 */
export function ambienceLoopAt(prepared: PreparedAmbience, pos: { x: number; y: number; z?: number } | null): string {
  if (!pos) return prepared.fallback
  let best: PreparedAmbienceZone | null = null
  for (const z of prepared.zones) {
    if (pos.x < z.minX || pos.x > z.maxX || pos.y < z.minY || pos.y > z.maxY) continue
    if (pos.z !== undefined && (pos.z < z.floor || pos.z > z.top)) continue
    if (!inPolygon(z.points, pos.x, pos.y)) continue
    if (!best || z.volume < best.volume) best = z
  }
  return best ? best.loop : prepared.fallback
}
