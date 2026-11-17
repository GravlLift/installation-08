// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * mapCallouts.ts — the place name the game's HUD shows under the motion tracker ("OVERHANG" on
 * Recharge): which of the map's named areas (`GET /api/matches/{id}/callouts`, read from the
 * game at runtime) holds the followed player.
 *
 * An area is a prism: a ground polygon and a vertical slice, in game world meters, the frame of
 * the replay tracks. A point is inside when its XY is in the polygon and its height in the slice.
 *
 * THE HEIGHT TESTED IS THE TRACK'S Z PLUS `CALLOUT_PROBE_ABOVE_M`. Measured on Recharge
 * (match 0d4244de, 150 585 track samples, 2026-11-15): at the track's own z only 84 % of the
 * samples fall in an area, the slices start a little above the floor the tracks stand on; from
 * +0.1 to +0.9 m, 99.9 % do. Half a meter sits in the middle of that plateau.
 *
 * WHERE AREAS OVERLAP (1.8 % of those samples), the smallest one wins: it is the most specific
 * place. How the game itself breaks the tie is not known.
 */
import { isAliveAt } from '../../../lib/replay/replayLogic'
import type { ReplayCutPoint, ReplayTrackReady } from '../../../lib/replay/replayReadyTypes'
import type { ReplayLocale } from '../i18n/i18n'

/** One named area, as the server serves it. */
export interface CalloutZone {
  en: string
  fr?: string
  polygon: [number, number][]
  zBottom: number
  zTop: number
}

/** A map's named areas, as the server serves them. */
export interface MapCallouts {
  version: number
  source: string
  zones: CalloutZone[]
}

/**
 * The place label's layout in the first-person HUD, shared by the live HUD and the video export:
 * its left edge and its bottom as shares of the view, its size and letter spacing in HUD ems, bold
 * small caps (upper case).
 */
export const CALLOUT_LABEL = { left: 0.03, bottom: 0.06, em: 0.42, tracking: 0.12, weight: 700 } as const

/** How far above the track's z the area test probes, in meters (see the header). */
export const CALLOUT_PROBE_ABOVE_M = 0.5

/** A prepared area: its polygon's area and XY box, computed once per map. */
interface PreparedZone {
  zone: CalloutZone
  area: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** PreparedCallouts — a map's areas, prepared for many lookups. */
export interface PreparedCallouts {
  zones: PreparedZone[]
}

export function prepareCallouts(set: MapCallouts | null | undefined): PreparedCallouts | null {
  const zones = (set?.zones ?? []).filter((z) => z.polygon.length >= 3 && z.zTop > z.zBottom)
  if (zones.length === 0) return null
  return {
    zones: zones.map((zone) => {
      let area = 0
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      const p = zone.polygon
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        area += p[j][0] * p[i][1] - p[i][0] * p[j][1]
        minX = Math.min(minX, p[i][0])
        maxX = Math.max(maxX, p[i][0])
        minY = Math.min(minY, p[i][1])
        maxY = Math.max(maxY, p[i][1])
      }
      return { zone, area: Math.abs(area) / 2, minX, maxX, minY, maxY }
    }),
  }
}

/** inPolygon — even-odd ray test of (x, y) against a ground polygon. */
export function inPolygon(p: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i]
    const [xj, yj] = p[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * calloutAt — the area holding the point (x, y, z), z being a track's z (the probe offset is
 * added here); null in none. Without a z (an older document), the height is not tested.
 */
export function calloutAt(prepared: PreparedCallouts | null, x: number, y: number, z: number | undefined): CalloutZone | null {
  if (!prepared) return null
  const probe = z === undefined ? undefined : z + CALLOUT_PROBE_ABOVE_M
  let best: PreparedZone | null = null
  for (const pz of prepared.zones) {
    if (x < pz.minX || x > pz.maxX || y < pz.minY || y > pz.maxY) continue
    if (probe !== undefined && (probe < pz.zone.zBottom || probe > pz.zone.zTop)) continue
    if (!inPolygon(pz.zone.polygon, x, y)) continue
    if (!best || pz.area < best.area) best = pz
  }
  return best?.zone ?? null
}

/** calloutName — the area's name in the viewer's language, English when it has no other. */
export function calloutName(zone: CalloutZone | null, locale: ReplayLocale): string | null {
  if (!zone) return null
  return (locale === 'fr' && zone.fr) || zone.en || null
}

/** sampleAt — the track sample in force at `frame` (the last one at or before it). */
function sampleAt(points: readonly ReplayCutPoint[], frame: number): ReplayCutPoint | null {
  if (points.length === 0 || frame < points[0].t) return null
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (points[mid].t <= frame) lo = mid
    else hi = mid - 1
  }
  return points[lo]
}

/**
 * calloutOfLivesAt — the area of a player at `frame`, from his lives (`buildLivesByXuid`): the
 * life alive at that frame, its sample in force. Dead or not yet spawned: null, as the game
 * shows no place then.
 */
export function calloutOfLivesAt(prepared: PreparedCallouts | null, lives: readonly ReplayTrackReady[] | undefined, frame: number): CalloutZone | null {
  if (!prepared || !lives) return null
  const life = lives.find((l) => isAliveAt(l, frame))
  const s = life ? sampleAt(life.points, frame) : null
  return s ? calloutAt(prepared, s.x, s.y, s.z) : null
}
