/**
 * topDownNavLogic.ts — pure math of the top-down view's framing: the safe area between the page's
 * chrome (top strip, transport bar), the orthographic frame that fits the played area in it, wheel
 * zoom toward the cursor, drag to pan, the clamp to the area, and the follow of the followed player
 * when zoomed in.
 *
 * Axes: the view looks straight down with screen right on scene +X and screen down on scene +Z
 * (`topDownView3d` sets the camera's up to -Z), so a CSS pixel offset (dx, dy) from the view's
 * center is the world offset (dx, dy) times the units per pixel.
 */

/** The page chrome over the view, in CSS px from each edge of the canvas. */
export interface Insets {
  top: number
  bottom: number
}

export const NO_INSETS: Insets = { top: 0, bottom: 0 }

/** The X/Z extent of the played area, margins already applied by the caller (u). */
export interface TopDownBounds {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

/** The view's size in CSS px. */
export interface Viewport {
  width: number
  height: number
}

/** What the viewer chose: the zoom over the whole-area fit, the world point at the safe area's center, and the follow. */
export interface NavState {
  /** 1 = the whole area fits the safe area; up to `MAX_ZOOM`. */
  zoom: number
  /** The world (X, Z) at the safe area's center; null = the area's center. */
  focus: [number, number] | null
  /** Keep the followed player inside the safe area's central box while zoomed in. */
  follow: boolean
}

/** The orthographic frame of the camera: its center (X, Z), half extents and the world units per CSS px. */
export interface ViewFrame {
  center: [number, number]
  halfWidth: number
  halfHeight: number
  unitsPerPx: number
}

export const NAV_HOME: NavState = { zoom: 1, focus: null, follow: true }
/** The closest zoom: a Spartan (~0.6 u wide) then spans tens of pixels on a team map. */
export const MAX_ZOOM = 8
/** Wheel zoom per wheel pixel (exponential): a 100 px notch zooms by about 16%. */
export const WHEEL_ZOOM_RATE = 0.0015
/** The followed player is kept inside this fraction of the safe area, centered (follow). */
export const FOLLOW_BOX = 0.6
/** Space kept between the chrome and the framed area (CSS px). */
export const INSET_GAP_PX = 8

/** The part of the canvas between the chrome: size and center, CSS px. */
interface SafeArea {
  width: number
  height: number
  cx: number
  cy: number
}

function safeArea(view: Viewport, insets: Insets): SafeArea {
  const height = Math.max(1, view.height - insets.top - insets.bottom)
  return { width: Math.max(1, view.width), height, cx: view.width / 2, cy: insets.top + height / 2 }
}

function boundsCenter(b: TopDownBounds): [number, number] {
  return [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2]
}

/** The world units per CSS px at zoom 1: the whole area fits the safe area. */
function baseUnitsPerPx(b: TopDownBounds, safe: SafeArea): number {
  return Math.max((b.maxX - b.minX) / safe.width, (b.maxZ - b.minZ) / safe.height)
}

/** clampAxis — a focus coordinate keeping a view `half` wide inside [lo, hi]; centered when it is wider. */
function clampAxis(value: number, lo: number, hi: number, half: number): number {
  if (2 * half >= hi - lo) return (lo + hi) / 2
  return Math.min(hi - half, Math.max(lo + half, value))
}

/** clampFocus — the focus that keeps the safe area inside the bounds (centered on an axis where it is wider). */
export function clampFocus(focus: [number, number], b: TopDownBounds, view: Viewport, insets: Insets, unitsPerPx: number): [number, number] {
  const safe = safeArea(view, insets)
  return [
    clampAxis(focus[0], b.minX, b.maxX, (safe.width / 2) * unitsPerPx),
    clampAxis(focus[1], b.minZ, b.maxZ, (safe.height / 2) * unitsPerPx),
  ]
}

/**
 * frameOf — the camera frame for a navigation state: the area fits the safe area at zoom 1, the
 * focus sits at the safe area's center (clamped), and the camera's center is offset from it by the
 * difference between the safe area's center and the canvas's.
 */
export function frameOf(b: TopDownBounds, view: Viewport, insets: Insets, nav: NavState): ViewFrame {
  const safe = safeArea(view, insets)
  const unitsPerPx = baseUnitsPerPx(b, safe) / clampZoom(nav.zoom)
  const focus = clampFocus(nav.focus ?? boundsCenter(b), b, view, insets, unitsPerPx)
  return {
    center: [focus[0] - (safe.cx - view.width / 2) * unitsPerPx, focus[1] - (safe.cy - view.height / 2) * unitsPerPx],
    halfWidth: (view.width / 2) * unitsPerPx,
    halfHeight: (view.height / 2) * unitsPerPx,
    unitsPerPx,
  }
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(1, Number.isFinite(zoom) ? zoom : 1))
}

/** worldAt — the world (X, Z) under a canvas point (CSS px) in a frame. */
export function worldAt(frame: ViewFrame, view: Viewport, px: number, py: number): [number, number] {
  return [frame.center[0] + (px - view.width / 2) * frame.unitsPerPx, frame.center[1] + (py - view.height / 2) * frame.unitsPerPx]
}

/** screenAt — the canvas point (CSS px) of a world (X, Z) in a frame. */
export function screenAt(frame: ViewFrame, view: Viewport, x: number, z: number): [number, number] {
  return [view.width / 2 + (x - frame.center[0]) / frame.unitsPerPx, view.height / 2 + (z - frame.center[1]) / frame.unitsPerPx]
}

/** The focus a frame shows: the world point at the safe area's center. */
function focusOf(frame: ViewFrame, view: Viewport, insets: Insets): [number, number] {
  const safe = safeArea(view, insets)
  return worldAt(frame, view, safe.cx, safe.cy)
}

/** What a zoom or pan acts on: the area, the view, the chrome and the state before. */
export interface NavContext {
  bounds: TopDownBounds
  view: Viewport
  insets: Insets
  nav: NavState
}

/**
 * zoomAt — zoom by `factor` keeping the world point under the cursor (`px`, `py`, CSS px) where it
 * is; the zoom is clamped to [1, MAX_ZOOM] and the focus to the area.
 */
export function zoomAt(c: NavContext, px: number, py: number, factor: number): NavState {
  const before = frameOf(c.bounds, c.view, c.insets, c.nav)
  const zoom = clampZoom(c.nav.zoom * factor)
  const cursor = worldAt(before, c.view, px, py)
  const focus = focusOf(before, c.view, c.insets)
  const k = clampZoom(c.nav.zoom) / zoom
  const next: [number, number] = [cursor[0] + (focus[0] - cursor[0]) * k, cursor[1] + (focus[1] - cursor[1]) * k]
  const unitsPerPx = before.unitsPerPx * k
  return { ...c.nav, zoom, focus: clampFocus(next, c.bounds, c.view, c.insets, unitsPerPx) }
}

/** wheelFactor — the zoom factor of a wheel delta (CSS px; negative = away from the user = zoom in). */
export function wheelFactor(deltaY: number): number {
  return Math.exp(-deltaY * WHEEL_ZOOM_RATE)
}

/** panBy — drag the map by (`dx`, `dy`) CSS px; a drag hands the framing to the viewer (follow off). */
export function panBy(c: NavContext, dx: number, dy: number): NavState {
  const frame = frameOf(c.bounds, c.view, c.insets, c.nav)
  const focus = focusOf(frame, c.view, c.insets)
  const next: [number, number] = [focus[0] - dx * frame.unitsPerPx, focus[1] - dy * frame.unitsPerPx]
  return { ...c.nav, focus: clampFocus(next, c.bounds, c.view, c.insets, frame.unitsPerPx), follow: false }
}

/**
 * followed — with follow on and zoomed in, move the focus the least that puts the player (X, Z)
 * inside the central `FOLLOW_BOX` of the safe area; the state unchanged otherwise.
 */
export function followed(c: NavContext, player: [number, number] | null): NavState {
  if (!player || !c.nav.follow || clampZoom(c.nav.zoom) <= 1) return c.nav
  const frame = frameOf(c.bounds, c.view, c.insets, c.nav)
  const focus = focusOf(frame, c.view, c.insets)
  const safe = safeArea(c.view, c.insets)
  const hw = (safe.width / 2) * FOLLOW_BOX * frame.unitsPerPx
  const hh = (safe.height / 2) * FOLLOW_BOX * frame.unitsPerPx
  const next: [number, number] = [into(focus[0], player[0], hw), into(focus[1], player[1], hh)]
  if (next[0] === focus[0] && next[1] === focus[1]) return c.nav
  return { ...c.nav, focus: clampFocus(next, c.bounds, c.view, c.insets, frame.unitsPerPx) }
}

/** into — the focus coordinate nearest to `focus` with `target` within `half` of it. */
function into(focus: number, target: number, half: number): number {
  if (target > focus + half) return target - half
  if (target < focus - half) return target + half
  return focus
}

/** A DOM rectangle's vertical span (CSS px, page coordinates). */
export interface Span {
  top: number
  bottom: number
}

/**
 * insetsFrom — the chrome insets of a canvas: the top strip's bottom edge below the canvas top and
 * the transport bar's top edge above the canvas bottom, each plus `INSET_GAP_PX`; 0 for a missing
 * element or one outside the canvas.
 */
export function insetsFrom(canvas: Span, topStrip: Span | null, bar: Span | null): Insets {
  const top = topStrip ? topStrip.bottom - canvas.top : 0
  const bottom = bar ? canvas.bottom - bar.top : 0
  const height = canvas.bottom - canvas.top
  const fit = (v: number) => (v > 0 && v < height / 2 ? v + INSET_GAP_PX : 0)
  return { top: fit(top), bottom: fit(bottom) }
}
