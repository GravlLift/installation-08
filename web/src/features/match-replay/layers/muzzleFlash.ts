/**
 * muzzleFlash.ts — the MUZZLE FLASH of a shot.
 *
 * BORROWED, NOT REINVENTED. The reference is `apps/web/src/components/replay/ReplayCanvas.tsx`
 * of the Csstat project: "a small flame in the direction of the GAZE of the player who
 * fires", `MUZZLE_DURATION = 6` frames, melee excluded, drawn ON TOP OF the aim cone. The
 * mechanic is taken as is: additive composition (`lighter`), a puff stretched along the axis
 * (translate + rotate + scale), a wide halo under a white-hot core, and an opacity that falls
 * with the age.
 *
 * WHAT IT SAYS, AND NOTHING ELSE: where the shot starts from, when, and of what NATURE the
 * discharge is. It points at NO victim — the shot events do not carry one (measured), and the
 * line toward a target would be an invention. It does not carry the shooter's color either:
 * user correction of 2026-08-15, "les couleurs des effets de tirs [...] prennent seulement
 * l'ARME en compte" (the shot effect colors [...] only take the WEAPON into account). The
 * player's identity stays with the marker and the cone.
 *
 * IT DOES NOT REPLACE THE AIM CONE (explicit request): the cone remains what it is, the
 * flash is placed at the marker, short and quick.
 *
 * MELEE HAS NO FLASH — a hammer blow is not a shot. The reference excludes it too. The
 * filtering is done upstream (`buildShotFx`), not here: an effect that one draws and then
 * erases is an effect one has paid for.
 *
 * No React, no state: a function of time, so stepping back gives exactly the same image.
 */
import type { FxInk, FxTint } from './fxInk'
import type { ShotFamily } from './shotEffects'

/**
 * BOMB_SCALE — the SCALE OF THE BOMB against the blast (`explosive`), on the muzzle flash as
 * on the death effect (`shotEffects.ts` imports it from here): same drawing, larger halo and
 * wave.
 *
 * USER DECISION OF 2026-09-23 (night, replay returns, lot M6.2): the Banshee bomb "ROUGE et
 * PLUS GROSSE (éclair et explosion)" (RED and BIGGER (flash and explosion)). The redness is
 * the TINT (`plasma_hot`, title registry); the size is this SHAPE. It is a STAGING setting,
 * not a measurement: the film says nothing about the radius of an explosion, and a dropped
 * charge reads heavier than a shell.
 *
 * WHY HERE AND NOT IN `shotEffects.ts` (2026-09-24, CI of feat/retours-rejeu). This module
 * has only TYPE imports: the rasterization guardrail (`e2e/replay-muzzle-raster.spec.ts`)
 * transpiles it ALONE, without bundler, and refuses any value import. First placed in
 * `shotEffects.ts`, the constant brought a value import in there and redened that guardrail.
 * The constant therefore lives in the leaf module; whoever depends on the other imports it.
 */
export const BOMB_SCALE = 1.6

/** Geometry of a flash, in SCREEN pixels (the density factor is applied by `k`). */
export interface MuzzleShape {
  x: number
  y: number
  /** Canvas radians. null = the gaze was not readable: a ROUND puff, without axis. */
  angle: number | null
  /** 1 = at the instant of the shot, 0 = end of afterglow. */
  fade: number
  /** Under "reduced motion", the flash neither progresses nor flickers. */
  reduced: boolean
  /** Ties the broken shapes apart: two neighboring shots do not overlap. */
  seed: number
  /** Canvas density: everything addressed to the eye is multiplied by this factor. */
  k: number
}

/**
 * Reference radius of the flash, in screen pixels.
 *
 * MEASURED, NOT SET BY EYE (2026-08-15, real Chromium rasterization): at 9 px, the kinetic
 * lens measured 30 × 8 px and changed only 64 pixels of the scene — less than the HALO of
 * the marker that carries it (radius 9 px, 254 px²) and twelve times less than the aim cone
 * (46 px long, ~635 px²) on which it sits. At 13 px it measures 44 × 12 and changes 5.6
 * times more pixels, without exceeding the length of the cone.
 */
const FLASH_R = 13
/** Radius of the white-hot core, smaller and sharper than the halo. */
const CORE_R = 4.6
/** Stretch along the axis of fire: the Csstat reference stretches 1.7 long, 0.45 wide. */
const STRETCH_LONG = 1.7
const STRETCH_WIDE = 0.45
/**
 * The flash is born IN FRONT of the marker: at the end of the barrel, not in the torso.
 * Moved from 5 to 12 px so that it comes out of the halo of the marker (radius 9 px)
 * instead of drowning in it.
 */
const MUZZLE_OFFSET = 12

/**
 * drawMuzzleFlash draws the flash of a shot according to the FAMILY of its weapon (the
 * shape) and the TINT of its discharge (the color). The two are orthogonal: two weapons of
 * the same shape do not have the same color in the game, and the reverse is true too.
 */
export function drawMuzzleFlash(
  ctx: CanvasRenderingContext2D,
  family: ShotFamily,
  tint: FxTint,
  shape: MuzzleShape,
  ink: FxInk,
): void {
  const color = ink.tint[tint] || ink.tint.neutral
  if (!color) return
  ctx.save()
  // NORMAL COMPOSITION, AND THAT IS A BUG FIX. The Csstat reference composes in ADDITIVE
  // (`lighter`): on its black map, the flash burns. Measured here in real Chromium
  // (2026-08-15): on the LIGHT theme, the additive of an amber tint on a near-white ground
  // saturates immediately — maximum gap of 3 values out of 255, **ZERO pixel** modified by
  // at least 8. The flash was mathematically invisible there, whatever its size. In normal
  // composition, the tint of the theme (the `--replay-fx-*` tokens already have a darkened
  // value in light) is placed as is on both backgrounds. What is lost: two overlapping
  // flashes no longer add up. What is gained: they exist.
  ctx.globalCompositeOperation = 'source-over'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = color
  ctx.fillStyle = color
  // THE SPARK FALLS FAST, but more to the SQUARE: the real-time step of the documents is
  // 100 ms (measured on the 23 local artifacts, single value), so 600 ms of afterglow are
  // 6 frames. To the square, the flash had already lost 75% of its intensity at the third
  // and no longer read beyond two. At power 3/2, it holds four. Under reduced motion, the
  // intensity no longer varies at all.
  const heat = shape.reduced ? 0.6 : shape.fade * Math.sqrt(shape.fade)
  const grow = shape.reduced ? 0.5 : 1 - shape.fade
  if (shape.angle === null) {
    drawPuff(ctx, shape, heat, color, ink.core)
  } else {
    const s = { ...shape, angle: shape.angle, heat, grow, color, core: ink.core }
    switch (family) {
      case 'ballistic':
        drawFlame(ctx, s)
        break
      case 'plasma':
        drawBloom(ctx, s)
        break
      case 'light':
        drawRay(ctx, s)
        break
      case 'shock':
        drawArc(ctx, s)
        break
      case 'explosive':
        drawBlast(ctx, s, 1)
        break
      case 'bomb':
        // THE BOMB (lot M6.2): the blast at the scale of a dropped charge.
        drawBlast(ctx, s, BOMB_SCALE)
        break
      case 'needles':
        drawSpray(ctx, s)
        break
      case 'plain':
        drawPlainFlash(ctx, s)
        break
      default:
        // MELEE, AND IT ALONE. It never arrives here (`buildShotFx` sets it aside), and if
        // it did it must ASSERT NOTHING: a hammer blow has no muzzle flash, so never an
        // oriented shape — the round puff, like an unreadable gaze.
        drawPuff(ctx, shape, heat, color, ink.core)
    }
  }
  ctx.restore()
}

/** An oriented flash: its geometry, its heat, its progress and its two inks. */
interface Oriented extends Omit<MuzzleShape, 'angle'> {
  angle: number
  heat: number
  grow: number
  color: string
  core: string
}

/** muzzle — the point from which the flash starts: in front of the marker, along the gaze axis. */
function muzzle(s: Oriented): { x: number; y: number } {
  const d = MUZZLE_OFFSET * s.k
  return { x: s.x + Math.cos(s.angle) * d, y: s.y + Math.sin(s.angle) * d }
}

/**
 * glow — the halo and the core of the reference: two concentric radial gradients, the second
 * smaller and lighter. `long`/`wide` stretch the puff along the axis.
 */
function glow(
  ctx: CanvasRenderingContext2D,
  at: { x: number; y: number },
  s: Oriented,
  radius: number,
  long: number,
  wide: number,
): void {
  ctx.save()
  ctx.translate(at.x, at.y)
  ctx.rotate(s.angle)
  ctx.scale(long, wide)
  paintRadial(ctx, radius * s.k, s.color, 0.9 * s.heat)
  paintRadial(ctx, CORE_R * s.k * (radius / FLASH_R), s.core, s.heat)
  ctx.restore()
}

/**
 * PLATEAU of the gradient: part of the radius that stays at FULL tint before the fall.
 *
 * Without it, a radial gradient loses half of its opacity at a third of the radius: the
 * flash had a sharp color only at its center, and that center is a few pixels. The plateau
 * gives it a BODY — that is what distinguishes a puff from a blurred point.
 */
const GRADIENT_PLATEAU = 0.35

/** paintRadial paints a gradient disk centered on the origin of the current frame. */
function paintRadial(
  ctx: CanvasRenderingContext2D,
  radius: number,
  color: string,
  alpha: number,
): void {
  if (!color || radius <= 0) return
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, radius)
  g.addColorStop(0, color)
  g.addColorStop(GRADIENT_PLATEAU, color)
  // "transparent" rather than a color with zero alpha: the canvas accepts any color format
  // of the theme (oklch included) without having to disassemble it.
  g.addColorStop(1, 'transparent')
  ctx.globalAlpha = Math.min(1, alpha)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, radius, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * drawFlame — the POWDER: the stretched puff of the reference, short and hot. It is the
 * shape borrowed as is from Csstat (halo + core, stretch 1.7 / 0.45).
 */
function drawFlame(ctx: CanvasRenderingContext2D, s: Oriented): void {
  glow(ctx, muzzle(s), s, FLASH_R, STRETCH_LONG, STRETCH_WIDE)
}

/**
 * drawBloom — the PLASMA: energy does not crack, it blooms. The puff is rounder, it GROWS
 * as it fades, and its decay is soft (square root) — the intended contrast with the powder,
 * already established by the death effects.
 */
function drawBloom(ctx: CanvasRenderingContext2D, s: Oriented): void {
  const soft = { ...s, heat: Math.sqrt(Math.max(0, s.fade)) * (s.reduced ? 0.6 : 1) }
  glow(ctx, muzzle(s), soft, FLASH_R * (1 + 0.45 * s.grow), 1.15, 0.9)
}

/**
 * drawRay — the LIGHT AMMO: a CONTINUOUS beam, two superposed strokes (wide and pale under
 * thin and sharp). The thickness does not vary with the age, only the opacity falls: a beam
 * does not disperse, it fades.
 */
function drawRay(ctx: CanvasRenderingContext2D, s: Oriented): void {
  const m = muzzle(s)
  const len = 26 * s.k
  const ex = m.x + Math.cos(s.angle) * len
  const ey = m.y + Math.sin(s.angle) * len
  ctx.beginPath()
  ctx.moveTo(m.x, m.y)
  ctx.lineTo(ex, ey)
  ctx.globalAlpha = 0.3 * s.fade
  ctx.lineWidth = 5 * s.k
  ctx.stroke()
  ctx.globalAlpha = 0.95 * s.fade
  ctx.lineWidth = 1.6 * s.k
  ctx.strokeStyle = s.core || s.color
  ctx.stroke()
  ctx.strokeStyle = s.color
  glow(ctx, m, s, FLASH_R * 0.6, 1, 1)
}

/**
 * drawArc — the ELECTRIC ARC: a BROKEN line, never straight, regenerated from a stable
 * seed (stepping back gives the same image, like the Dynamo net).
 */
function drawArc(ctx: CanvasRenderingContext2D, s: Oriented): void {
  const m = muzzle(s)
  const nx = -Math.sin(s.angle)
  const ny = Math.cos(s.angle)
  const segments = 4
  const reach = 18 * s.k
  ctx.globalAlpha = Math.min(1, 1.1 * s.heat)
  ctx.lineWidth = 1.6 * s.k
  ctx.beginPath()
  for (let i = 0; i <= segments; i++) {
    const u = i / segments
    const amp = i === segments ? 0 : (1.5 + (s.seed % 4)) * (i % 2 ? 1 : -1) * s.k
    ctx.lineTo(m.x + Math.cos(s.angle) * reach * u + nx * amp, m.y + Math.sin(s.angle) * reach * u + ny * amp)
  }
  ctx.stroke()
  glow(ctx, m, s, FLASH_R * 0.55, 1, 1)
}

/**
 * drawBlast — the BLAST: a wide puff at the start, plus a wave that opens AT THE BARREL.
 * The wave never settles at the end: the film dates no impact, and asserting one would
 * invent a point of fall. `scale`: 1 for the blast, `BOMB_SCALE` for the bomb (same
 * drawing, larger halo and wave — lot M6.2).
 */
function drawBlast(ctx: CanvasRenderingContext2D, s: Oriented, scale: number): void {
  const m = muzzle(s)
  glow(ctx, m, s, FLASH_R * 1.25 * scale, 1.3, 0.85)
  ctx.globalAlpha = 0.45 * s.fade
  ctx.lineWidth = 1.4 * scale * s.k
  ctx.beginPath()
  ctx.arc(m.x, m.y, (4 + 16 * s.grow) * scale * s.k, 0, Math.PI * 2)
  ctx.stroke()
}

/**
 * drawSpray — the NEEDLES: the signature is the BURST, not the stroke. Five short spikes
 * that spread from the barrel, asserting nothing about their point of fall.
 */
function drawSpray(ctx: CanvasRenderingContext2D, s: Oriented): void {
  const m = muzzle(s)
  const nx = -Math.sin(s.angle)
  const ny = Math.cos(s.angle)
  ctx.globalAlpha = 0.9 * s.fade
  ctx.lineWidth = 1.1 * s.k
  for (let i = 0; i < 5; i++) {
    const spread = (i - 2) / 2
    const reach = (10 + 2 * i) * s.k
    ctx.beginPath()
    ctx.moveTo(m.x, m.y)
    ctx.lineTo(
      m.x + Math.cos(s.angle) * reach + nx * spread * 5 * s.k,
      m.y + Math.sin(s.angle) * reach + ny * spread * 5 * s.k,
    )
    ctx.stroke()
  }
  glow(ctx, m, s, FLASH_R * 0.5, 1, 1)
}

/**
 * drawPlainFlash — the FLASH OF A WEAPON THE REGISTRY DOES NOT NAME, but whose DIRECTION is
 * known: a puff stretched along the axis, without the shape of any family.
 *
 * WHY IT EXISTS SINCE 2026-09-20. The `plain` family fell on `drawPuff` — the ROUND puff of
 * the "unreadable gaze" case — which threw away the only thing we knew: the axis. The case
 * was not theoretical: VEHICLE WEAPONS are absent from `weaponLabels` (hence without `fx`),
 * and they make 68% of the vehicle shots of `4f77afc1`. A pale gray round centered on a
 * chassis does not read as a shot; an oriented puff does.
 *
 * IT ASSERTS NO FAMILY, and that is its rule: neither the flame of the powder, nor the
 * bloom of the plasma, nor the ray — the stretch is deliberately WEAKER than that of the
 * powder (1.25 against 1.7) so that it reads as "a shot, over there", not as "a ballistic".
 */
function drawPlainFlash(ctx: CanvasRenderingContext2D, s: Oriented): void {
  glow(ctx, muzzle(s), s, FLASH_R * 0.85, 1.25, 0.9)
}

/**
 * drawPuff — the SHOT WHOSE GAZE IS NOT READABLE: a ROUND puff, placed on the marker. No
 * direction is invented — that is the rule that holds for the whole replay.
 */
function drawPuff(
  ctx: CanvasRenderingContext2D,
  shape: MuzzleShape,
  heat: number,
  color: string,
  core: string,
): void {
  ctx.save()
  ctx.translate(shape.x, shape.y)
  paintRadial(ctx, FLASH_R * 0.85 * shape.k, color, 0.7 * heat)
  paintRadial(ctx, CORE_R * 0.85 * shape.k, core, heat)
  ctx.restore()
}
