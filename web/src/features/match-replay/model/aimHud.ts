// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * aimHud.ts — THE FIRST-PERSON AIM of the HUD as data: the hip reticle's geometry and, at a frame,
 * which ADS overlay is drawn and whether the hip reticle stays. One source for the live HUD
 * (`ui/ReplayHud3d`, SVG) and the video export (`export/exportHud`, canvas 2D), so the file shows
 * the aim the screen shows.
 *
 * THE RETICLE BOX is 100 units square, centered on the screen, `max(50px, 10 % of the height)`.
 */
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import { adsLevelIndex, adsOverlayFor, type AdsOverlaySpec } from './adsOverlay'
import type { reticleShape } from './hud3d_logic'
import { scopeOf, zoomAt, type ScopeSpec, type Zoom3d } from './scopeLogic'

/** The hip reticle family of a weapon (`reticleShape`). */
export type ReticleForm = ReturnType<typeof reticleShape>

/** The reticle box: at least this many CSS pixels... */
export const RETICLE_MIN_PX = 50
/** ...and this share of the view height. */
export const RETICLE_HEIGHT_SHARE = 0.1
/** The reticle's line width, in box units; a kill mark is heavier. */
export const RETICLE_STROKE = 1.5
export const RETICLE_KILL_STROKE = 2.5
/** The center dot radius, in box units. */
export const RETICLE_DOT_R = 1.7
/**
 * The dark halo under the reticle's lines (wider by this many box units, at this opacity, in the
 * `--replay-ads-ink` dark), so the white reads over a bright wall as the game's dark-edged reticle
 * does on the owner's Bandit capture (2026-11-19). The ADS reticles draw the same halo.
 */
export const RETICLE_HALO_STROKE = 1.2
export const RETICLE_HALO_OPACITY = 0.55

/** A line segment in box units: x1, y1, x2, y2. */
export type Segment = readonly [number, number, number, number]

/** The four ticks of the 'circle' and 'pistol' reticles. */
const TICKS: readonly Segment[] = [[50, 18, 50, 23], [50, 77, 50, 82], [18, 50, 23, 50], [77, 50, 82, 50]]
/** The hit marker: four short diagonals at the box corners, pointing in. */
const HIT_MARKS: readonly Segment[] = [[20, 20, 27, 27], [80, 20, 73, 27], [20, 80, 27, 73], [80, 80, 73, 73]]

export interface ReticleGeometry {
  /** The ring's radius (box units), null without a ring. */
  ring: number | null
  dot: boolean
  ticks: readonly Segment[]
  /** The hit marker: a kill (enemy color, heavier line) or a hit (reticle color), at `opacity`. */
  hit: { segments: readonly Segment[]; kill: boolean; opacity: number } | null
}

/** reticleGeometry: what the hip reticle of `form` draws, with the hit marker of the moment. */
export function reticleGeometry(form: ReticleForm, elimination: number, touche: number): ReticleGeometry {
  const ring = ['circle', 'precision', 'large', 'default'].includes(form) ? (form === 'large' ? 32 : form === 'precision' ? 15 : 25) : null
  const dot = ['precision', 'pistol', 'dot', 'default'].includes(form)
  const ticks = ['circle', 'pistol'].includes(form) ? TICKS : []
  const hit = elimination > 0 || touche > 0 ? { segments: HIT_MARKS, kill: elimination > 0, opacity: elimination || touche } : null
  return { ring, dot, ticks, hit }
}

/** segmentsPath: the SVG path of segments. */
export function segmentsPath(segments: readonly Segment[]): string {
  return segments.map(([x1, y1, x2, y2]) => `M${x1} ${y1}L${x2} ${y2}`).join(' ')
}

/** reticleBoxPx: the side of the reticle box for a view `height` pixels tall. */
export function reticleBoxPx(height: number): number {
  return Math.max(RETICLE_MIN_PX, height * RETICLE_HEIGHT_SHARE)
}

/** heldModelKey: the model key (first eight hex digits, lowercase) of a held weapon id. */
export function heldModelKey(weaponId: string | null | undefined): string | undefined {
  return weaponId?.replace(/^0x/i, '').slice(0, 8).toLowerCase()
}

export interface AimHud {
  spec: ScopeSpec
  zoom: Zoom3d
  /** The ADS overlay drawn at this frame (faded by `zoom.amount`), null when none. */
  ads: AdsOverlaySpec | null
  /** The overlay level drawn (`adsLevelIndex`). */
  adsLevel: number
  /** The hip reticle is drawn: hidden once an overlay with its own reticle is past half its fade. */
  reticleShown: boolean
  /** The hip reticle's scale: a smart link shrinks it by 30 % with the zoom. */
  reticleScale: number
}

/**
 * aimHudAt: the aim at `frame` for the weapon of model key `modelKey` and label key `labelKey`.
 * `mags` only changes `zoom.mag` (the camera's field): the overlay and the reticle read the
 * level and the fade, which do not depend on it.
 */
export function aimHudAt(doc: ReplayDocumentReady, xuid: string, frame: number, modelKey: string | undefined, labelKey: string | null | undefined, mags: number[] | null): AimHud {
  const spec = scopeOf(modelKey, labelKey)
  const zoom = zoomAt(doc, xuid, frame, spec, mags)
  const overlay = adsOverlayFor(modelKey, labelKey, spec)
  const visible = overlay !== null && zoom.shownLevel > 0 && zoom.amount > 0
  const mounted = visible && overlay.ownReticle && zoom.amount > 0.5
  return {
    spec,
    zoom,
    ads: visible ? overlay : null,
    adsLevel: overlay ? adsLevelIndex(overlay, zoom.shownLevel) : 0,
    reticleShown: !mounted,
    reticleScale: spec.kind === 'smartLink' ? 1 - 0.3 * zoom.amount : 1,
  }
}
