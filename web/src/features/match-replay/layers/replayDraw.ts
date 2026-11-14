/**
 * replayDraw.ts — BACKGROUND and EVENTS layers of the 2D replay: reconstructed ground, Forge
 * props (as fallback), shots and deaths. The player themselves lives in replayMarkers.ts.
 * No React: only a CanvasRenderingContext2D + pure geometry (replayLogic.ts). The colors
 * arrive ALREADY RESOLVED from the semantic tokens (getSeriesColors / resolveToken) — no
 * color literal here (color-tokens rule).
 *
 * A GRENADE THROW PLACES NO MARK AT THE DEPARTURE POINT: it is read by its FLIGHT
 * (replayProjectiles.ts), its END OF FLIGHT (useReplayGrenadeRest.ts) and the throw badge of
 * the thrower's card (model/grenadeFx.ts).
 */
import type { ReplayMapObject } from '@/lib/api/types'

import type { FxInk } from './fxInk'
import { drawMuzzleFlash } from './muzzleFlash'
import type { ShotFxEntry } from '../model/shotFx'
import { drawDeathMarker, drawShotEffect } from './shotEffects'
import { MELEE_LINK_MAX_M, type KillFxEntry } from '../model/killFx'
import { drawMeleeStar, meleeStarProgress } from './meleeStar'
import { altitudeRatio, footprint } from '../../../lib/replay/replayLogic'
import { vehicleShotOrigin, type VehicleMountSpriteSize } from '../model/vehicleWeaponMounts'
import { type CanvasView, projectTo, scaleOf } from '../model/replayView'
import { vehicleCeilPx } from '../../../lib/replay/screenSizes'

/** Vertical amplitude used for the floor indication. */
interface ZRange {
  min: number
  max: number
}

// Map background: Forge props of 0.25 m² on average — without a size floor they are
// invisible. Deliberately low opacities: the subject of the render remains the players.
const OBJECT_MIN_PX = 2.5
const OBJECT_ALPHA_LOW = 0.14
const OBJECT_ALPHA_SPAN = 0.24

interface GeometryStyle {
  color: string
  z: ZRange
}

/**
 * drawGeometryLayer draws the Forge props UNDER the trajectories: oriented rectangles
 * (or small squares when the projected footprint is under the readability threshold).
 * The opacity rises with altitude: a discreet floor indication, without a dedicated color.
 */
export function drawGeometryLayer(
  ctx: CanvasRenderingContext2D,
  objects: ReplayMapObject[],
  view: CanvasView,
  style: GeometryStyle,
): void {
  const scale = scaleOf(view)
  ctx.fillStyle = style.color
  for (const o of objects) {
    ctx.globalAlpha =
      OBJECT_ALPHA_LOW + OBJECT_ALPHA_SPAN * altitudeRatio(o.z ?? 0, style.z.min, style.z.max)
    const corners = footprint(o)
    const wide = (o.dx ?? 0) * scale >= OBJECT_MIN_PX && (o.dy ?? 0) * scale >= OBJECT_MIN_PX
    if (corners.length === 4 && wide) {
      ctx.beginPath()
      corners.forEach((w, i) => {
        const c = projectTo(view, w)
        if (i === 0) ctx.moveTo(c.x, c.y)
        else ctx.lineTo(c.x, c.y)
      })
      ctx.closePath()
      ctx.fill()
      continue
    }
    const c = projectTo(view, o)
    ctx.fillRect(c.x - OBJECT_MIN_PX / 2, c.y - OBJECT_MIN_PX / 2, OBJECT_MIN_PX, OBJECT_MIN_PX)
  }
  ctx.globalAlpha = 1
}

// The TRAJECTORIES and the player markers live in replayMarkers.ts: this layer gained the
// aim cone, the shield, the floor rings, the appearance and the death, and it would have
// made of this file a god file.

/**
 * Colors inherited from the reconstructed ground, REMOVED on 2026-09-03 (user decision: this
 * fallback must no longer be able to run by accident and cook a layer of ~45,000 cells).
 * Only `edge` survives — it serves as a fine ink for the NAMED ZONES. `fill` stays carried
 * by `useReplayInks`: it is the same pair of tokens, and separating it for a single field
 * would cost more wiring than it would save.
 */
export interface FloorStyle {
  fill: string
  edge: string
}

/** Display window of a point event, in frames. */
export interface EventWindow {
  frame: number
  /** Number of frames during which the event remains visible after its instant. */
  hold: number
  /**
   * REAL duration of a frame, in ms. The effects whose staging has its own clock — today the
   * melee star, 400 ms — read it here: a duration written in frames would change meaning the
   * day the sampling rate changes (same rule as the end of flight of the grenades, which
   * already carries this field).
   */
  frameMs: number
}

/**
 * drawShotsLayer draws the MUZZLE FLASHES of the current window.
 *
 * WHAT THE POINT MEANS, and the render must respect it: the film only records the shots that
 * DEAL damage. A drawn shot therefore hit. Its DIRECTION is that of the GAZE of the shooter
 * at that instant (re-read in their trajectory, cf. shotFx.ts) — without a reading, a round
 * puff, never an invented direction. ON A VEHICLE SHOT, the point AND the direction come from
 * the MOUNT of the weapon rather than the gaze (`vehicleShotOrigin`, user request of
 * 2026-09-03 — "si ça vient du passager, faut que le tir vienne du siège passager qui a une
 * tourelle" (if it comes from the passenger, the shot must come from the passenger seat that
 * has a turret)).
 *
 * THIS LAYER CHANGED NATURE on 2026-08-15 (step 2 of the shot effects plan): it used to
 * draw a TRACE of 62 px in the color of the SHOOTER; it now draws a short flash at the mouth
 * of the weapon, tinted by the NATURE OF THE DISCHARGE and by it alone (user decision). The
 * aim cone, for its part, did not move — the flash is added to it.
 */
export function drawShotsLayer(
  ctx: CanvasRenderingContext2D,
  shots: ShotFxEntry[],
  view: CanvasView,
  win: EventWindow,
  style: ShotStyle,
): void {
  // THE FRAMING SCALE, read once: the weapon mount of a vehicle shot follows the SIZE of the
  // sprite, which depends on it since 2026-09-20 (cf. `lib/replay/screenSizes.ts`).
  const scalePxPerM = scaleOf(view)
  // The size ceiling follows the CANVAS (small screen): the mount follows the sprite as it is drawn.
  const ceilPx = vehicleCeilPx(Math.min(view.width, view.height))
  for (const s of shots) {
    const age = win.frame - s.frame
    if (age < 0 || age > win.hold) continue
    const c = projectTo(view, s)
    const { origin, angle } = vehicleShotOrigin({
      h: s.h, vehicleShot: s.vehicleShot, center: c, sizeOf: style.vehicleSizeOf, k: style.k,
      scalePxPerM, ceilPx,
    })
    drawMuzzleFlash(ctx, s.fam, s.tint, {
      x: origin.x,
      y: origin.y,
      angle,
      fade: 1 - age / Math.max(win.hold, 1),
      reduced: style.reducedMotion,
      seed: s.seed,
      k: style.k,
    }, style.ink)
  }
  ctx.globalAlpha = 1
}

/** Style of the shot layer: the inks of the theme and the density of the screen. */
export interface ShotStyle {
  /**
   * Discharge tints resolved from the theme (fxInk.ts). NO player color enters here: user
   * correction of 2026-08-15 — "les couleurs des effets de tirs [...] prennent seulement
   * l'ARME en compte" (the shot effect colors [...] only take the WEAPON into account).
   */
  ink: FxInk
  /** Canvas density: the flash addresses the eye, its size is in screen pixels. */
  k: number
  reducedMotion: boolean
  /**
   * Sprite size of a vehicle family, or `null` (not yet loaded). Optional: a caller that does
   * not wire the vehicle layer (tests, or a future screen without vehicles) keeps the center
   * fallback for every vehicle shot, never an exception.
   */
  vehicleSizeOf?: (family: string) => VehicleMountSpriteSize | null
}

/** Style of the death layer: the color of the killer, and the fallback when they have no trace. */
export interface KillFxStyle {
  /**
   * Color of the KILLER, resolved by slot AND by frame: it is requested at THE INSTANT OF THE
   * KILL (`e.frame`), not at the drawing frame — a slot is reassigned between rounds, and the
   * death effect persists several frames after the blow, during which the slot could already
   * belong to another player.
   */
  colorOfSlot: (slot: number, frame: number) => string | null
  fallback: string
  reducedMotion: boolean
  /** Canvas density: the melee star is declared in SCREEN pixels. */
  k: number
}

/**
 * drawKillFxLayer draws the DEATH EFFECTS of the current window.
 *
 * ORIENTED KILLER -> VICTIM only when the pair is complete (rule POC 89/93, carried by
 * `buildKillFx`: `vx` null = no axis); otherwise an unoriented dotted marker. The end is
 * REAL (`target`): that is the only difference of nature with the shots, whose length is
 * only a trace. The COLOR is that of the killer — the weapon family is read in the SHAPE
 * (ruling of lot 3.2, kept).
 *
 * THE FATAL MELEE IS THE EXCEPTION since 2026-08-18 (D3/R2-3): it traces neither arc nor
 * marker, it places a STAR at the place of the death (meleeStar.ts). Close combat is exactly
 * the case where the axis almost never exists — killer and victim fall under the 1.5 px
 * threshold below — and where the generic render would have reduced to a dotted ring,
 * indistinguishable from a death of which we know nothing.
 */
export function drawKillFxLayer(
  ctx: CanvasRenderingContext2D,
  fx: KillFxEntry[],
  view: CanvasView,
  win: EventWindow,
  style: KillFxStyle,
): void {
  for (const e of fx) {
    const age = win.frame - e.frame
    if (age < 0 || age > win.hold) continue
    const fade = 1 - age / (win.hold + 1)
    const c = projectTo(view, e)
    const color = (e.slot !== null ? style.colorOfSlot(e.slot, e.frame) : null) ?? style.fallback
    if (e.fam === 'melee') {
      // INSTEAD OF THE DEATH: the victim when they are re-read, the origin otherwise (it
      // then equals the position of the killer, within one close-combat step — it is a close
      // combat).
      const mort =
        e.deathX !== null && e.deathY !== null
          ? projectTo(view, { x: e.deathX, y: e.deathY })
          : c
      const p = meleeStarProgress(age * win.frameMs, style.reducedMotion)
      if (p !== null) drawMeleeStar(ctx, mort, p, style.k, color)
      continue
    }
    let angle: number | null = null
    let length = 0
    if (e.vx !== null && e.vy !== null) {
      const v = projectTo(view, { x: e.vx, y: e.vy })
      const dx = v.x - c.x
      const dy = v.y - c.y
      const d = Math.hypot(dx, dy)
      // < 1.5 px: killer and victim at the same place on screen (close combat). No reliable
      // axis to draw from it — the unoriented marker is worth more than an angle computed on
      // rounding noise (rule POC).
      if (d > 1.5) {
        angle = Math.atan2(dy, dx)
        length = d
      }
    }
    const shape = {
      x: c.x,
      y: c.y,
      angle,
      length,
      fade,
      reduced: style.reducedMotion,
      seed: e.seed,
      target: angle !== null,
      meleeLink: e.dist !== null && e.dist < MELEE_LINK_MAX_M,
    }
    if (angle === null) drawDeathMarker(ctx, shape, color)
    else drawShotEffect(ctx, e.fam, shape, color)
  }
  ctx.globalAlpha = 1
}

/**
 * tintedIconCanvas — a HUD mask (white/gray + alpha) TINTED with an ink of the theme, once
 * for all in an off-screen canvas. A canvas does not know the CSS `mask-image` of WeaponIcon:
 * the tint is done by `source-in` composition, which preserves the alpha and follows the
 * theme by re-tinting (the caller re-tints on change).
 *
 * THE MIRROR IS BAKED HERE, NOT AT THE TRACE (2026-08-28): the weapon thumbnails of the
 * pedestals are now the FULL icons of the cards, and the two game atlases point LEFT when the
 * kill feed — hence the card, hence the pedestal — points right. Flipping at each frame would
 * require a `save`/`scale`/`restore` per pedestal and per frame; flipping once at the baking
 * costs nothing and lets the layer place an image like the others.
 *
 * `tint: false` LEAVES THE IMAGE AS IS (colors included): that is the case of a finished
 * drawing that one only flips. Without this gate, a flipped finished image would lose its
 * colors.
 */
export interface TintedIconOptions {
  /** Flip the image horizontally (the direction of the game's kill feed). */
  mirrored?: boolean
  /** Tint with the given ink (default) or keep the colors of the image. */
  tinted?: boolean
  /**
   * Tint composition mode (2026-09-02, vehicle lot): `'source-in'` (DEFAULT, behavior
   * STRICTLY UNCHANGED) — the tint REPLACES the color of the sprite, that is the mode of the
   * HUD masks (white/gray + alpha). `'multiply'` — the tint MULTIPLIES with the colors of
   * the sprite: the white becomes the ink, the BLACK STAYS BLACK (the volume strokes of the
   * vehicle sprites).
   * `multiply` does not respect the alpha on its own (`fillRect` in multiply mode makes every
   * transparent background pixel opaque): a second `destination-in` pass with the original
   * image reapplies the alpha channel of the sprite after the `fillRect`.
   */
  composite?: 'source-in' | 'multiply'
}

export function tintedIconCanvas(
  img: HTMLImageElement,
  color: string,
  options: TintedIconOptions = {},
): HTMLCanvasElement {
  const { mirrored = false, tinted = true, composite = 'source-in' } = options
  const off = document.createElement('canvas')
  off.width = Math.max(1, img.naturalWidth)
  off.height = Math.max(1, img.naturalHeight)
  const octx = off.getContext('2d')
  if (!octx) return off
  if (mirrored) {
    octx.translate(off.width, 0)
    octx.scale(-1, 1)
  }
  octx.drawImage(img, 0, 0)
  if (!tinted) return off
  octx.globalCompositeOperation = composite
  octx.fillStyle = color
  // `source-in`/`multiply` apply to the WHOLE canvas: the rectangle is therefore placed in
  // the starting frame, otherwise the mirror would offset it out of the frame.
  octx.setTransform(1, 0, 0, 1, 0, 0)
  octx.fillRect(0, 0, off.width, off.height)
  if (composite === 'multiply') {
    // `multiply` made the whole canvas opaque (including the background, previously
    // transparent): we redraw the sprite in the SAME frame as the first trace (mirror
    // included, to stay aligned pixel by pixel) and we keep, via `destination-in`, only what
    // its alpha channel covers — the background becomes transparent again, the black strokes
    // keep their near full alpha, the fill keeps its shading alpha (0.80..1).
    if (mirrored) {
      octx.translate(off.width, 0)
      octx.scale(-1, 1)
    }
    octx.globalCompositeOperation = 'destination-in'
    octx.drawImage(img, 0, 0)
    octx.setTransform(1, 0, 0, 1, 0, 0)
  }
  return off
}

/**
 * outlinedSpriteCanvas — places the OUTLINE (never tinted) then the ALREADY TINTED sprite on
 * top, in an off-screen thumbnail (redrawn vehicle sprites, 2026-09-16). The two images have
 * the SAME canvas and the SAME center by construction: no offset to compute. The outline is
 * placed AFTER the tint, in a fresh canvas: a `multiply`/`source-atop` composition applied
 * to the same context would tint it too.
 */
export function outlinedSpriteCanvas(
  outline: HTMLImageElement,
  tintedSprite: HTMLCanvasElement,
): HTMLCanvasElement {
  const off = document.createElement('canvas')
  off.width = Math.max(1, outline.naturalWidth, tintedSprite.width)
  off.height = Math.max(1, outline.naturalHeight, tintedSprite.height)
  const octx = off.getContext('2d')
  if (!octx) return tintedSprite
  octx.drawImage(outline, (off.width - outline.naturalWidth) / 2, (off.height - outline.naturalHeight) / 2)
  octx.drawImage(tintedSprite, (off.width - tintedSprite.width) / 2, (off.height - tintedSprite.height) / 2)
  return off
}

/**
 * drawRotatedSprite — THE BITMAP ROTATION OF THE REPLAY, without precedent before the vehicle
 * lot (2026-09-02). Taken from the only landmark of the repository that already rotates an
 * image around a point — `glow()` in `muzzleFlash.ts:159-165` (translate + rotate + scale,
 * then restore) — rather than inventing a second mechanic for the same need.
 *
 * `angle` IS ALREADY IN CANVAS RADIANS, not world heading: the conversion (sign inversion,
 * cf. `drawShotsLayer`: "world -> canvas, the Y axis is inverted, so the angle is too") is
 * the responsibility of THE CALLER, which alone knows which heading it starts from. This
 * helper ONLY does the screen geometry: center the image on `(x, y)`, rotate it, scale it.
 *
 * `scale` IS A MULTIPLICATIVE FACTOR OF THE NATURAL PIXELS OF THE IMAGE, not a target size
 * in screen pixels: it is the caller (`vehiclesLayer.ts`) that computes this factor from the
 * desired screen size and the resolution of the sprite — exactly the role that `ctx.scale`
 * already plays in `glow()`. `drawImage` is then placed at ITS NATURAL SIZE, centered on the
 * origin of the scaled frame: the canvas does the rest.
 *
 * WITHOUT A VALID IMAGE (load not yet complete, null dimensions), NOTHING IS DRAWN — never
 * a fallback rectangle that would pretend to show a vehicle.
 */
export function drawRotatedSprite(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  x: number,
  y: number,
  angle: number,
  scale: number,
): void {
  const w = 'width' in img && typeof img.width === 'number' ? img.width : 0
  const h = 'height' in img && typeof img.height === 'number' ? img.height : 0
  if (w <= 0 || h <= 0 || scale <= 0) return
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.scale(scale, scale)
  ctx.drawImage(img, -w / 2, -h / 2, w, h)
  ctx.restore()
}
