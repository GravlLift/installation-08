/**
 * shotEffects.ts — the SHAPE OF A SHOT SAYS ITS WEAPON.
 *
 * WHAT IS MEASURED, AND WHAT IS CHOSEN. What is measured is the LABEL of the weapon: the
 * film carries it on every shot event, and the artifact names it (22 named families out of
 * 22 for this match). What is chosen is the staging — a weapon family is drawn differently
 * from another. No family is deduced from an observation: a weapon outside the catalog falls
 * on the neutral rendering, never on an approximating one.
 *
 * WHERE THE CLASSIFICATION LIVES: in the mappings of the title, published by the artifact
 * (`weaponLabels[id].fx`). This file no longer knows a single Halo weapon.
 *
 * WHY THE SHAPE AND NOT THE TINT. The POC distinguished the families by seven hard-coded
 * `hsla` tints. Here the color belongs to the SHOOTER — that is what allows following a
 * player with the eyes — and the semantic colors go through tokens (repository rule). Making
 * the family carried by the tint would force either crushing the identity of the shooter,
 * or inventing seven colors outside the system. The shape, for its part, is free: a burst
 * of needles does not resemble anything else, and it stays readable in both themes without
 * having to be derived.
 *
 * ACCESSIBILITY: under "reduced motion", the effects do not animate. The geometry and the
 * opacity stay constant for the whole afterglow — the marker remains, it no longer moves.
 * The stylesheet cannot do anything for a canvas drawn in JS: the preference is therefore
 * read here.
 */
// The scale of the bomb lives in the leaf module of the flash (see its doc): it is the one
// the rasterization guardrail transpiles alone, without value import.
import { BOMB_SCALE } from './muzzleFlash'

/** Rendering families. `sobre` is not a family: it is the absence of a known family. */
export type ShotFamily =
  | 'ballistic'
  | 'plasma'
  | 'light'
  | 'shock'
  | 'explosive'
  | 'bomb'
  | 'melee'
  | 'needles'
  | 'spread'
  | 'plain'

/**
 * DRAWN_FAMILIES — the families this file knows how to DRAW.
 *
 * THE CATALOG OF WEAPONS IS NO LONGER HERE (lot 3.2). It used to live hard-coded, by
 * canonical weapon name — 22 Halo names in rendering code, hence a game catalog copied on
 * the web side, which would have gone silent the day a weapon is renamed and which would
 * never have known anything of a second title. The classification now comes from the
 * DOCUMENT (`weaponLabels[id].fx`), resolved offline from
 * `config/titles/{slug}/mappings/replay_labels.toml`.
 *
 * What remains here is what BELONGS to the rendering: the geometry of each family, and the
 * refusal to draw what one does not know.
 */
const DRAWN_FAMILIES: Record<string, ShotFamily> = {
  ballistic: 'ballistic',
  plasma: 'plasma',
  light: 'light',
  shock: 'shock',
  explosive: 'explosive',
  bomb: 'bomb',
  melee: 'melee',
  needles: 'needles',
  spread: 'spread',
}

/**
 * familyOf validates the family announced by the document.
 *
 * WITHOUT FAMILY, OR OUTSIDE THE KNOWN SHAPES: `plain`. We do not snap to a nearby family —
 * a borrowed rendering would assert a weapon we do not know, exactly as a default visual
 * would. A family unknown to the client (document newer than the app) therefore falls on the
 * neutral stroke, not on an approximating shape.
 */
export function familyOf(effect: string | undefined): ShotFamily {
  if (!effect) return 'plain'
  return DRAWN_FAMILIES[effect] ?? 'plain'
}

/** Geometry of an effect: origin, direction (canvas radians) and length in pixels. */
export interface ShotShape {
  x: number
  y: number
  /** null = the aim was not readable: no direction is drawn. */
  angle: number | null
  length: number
  /** 1 = at the instant of the shot, 0 = end of afterglow. */
  fade: number
  /** Under "reduced motion", the shape does not progress with `fade`. */
  reduced: boolean
  /** Ties the broken shapes apart so that two neighboring shots do not overlap. */
  seed: number
  /**
   * true ONLY when the end is a REAL position — that of the victim of a death (rule POC:
   * complete killer-victim pair). On a SHOT, `length` is only a trace length: placing an
   * impact halo there would invent a point of fall the film does not give. The families
   * `explosive`, `needles` and `melee` use it not to lie about their end.
   */
  target?: boolean
  /**
   * MELEE ONLY: the victim is in REACH of the gesture (world distance < 8 m, threshold
   * measured on the killFx side). The killer -> victim link arc is only drawn then —
   * beyond it, the gesture keeps its arc open toward the victim, without a line linking it.
   */
  meleeLink?: boolean
}

/**
 * drawShotEffect draws a shot according to its family, in the ALREADY RESOLVED color of the
 * shooter.
 *
 * The direction is only traced if the film carries it: without it, only the origin burst is
 * drawn. Tracing a line by default would make one believe in a known aim.
 */
export function drawShotEffect(
  ctx: CanvasRenderingContext2D,
  family: ShotFamily,
  shape: ShotShape,
  color: string,
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const advance = shape.reduced ? 0.5 : 1 - shape.fade
  if (shape.angle === null) {
    drawOrigin(ctx, shape, shape.fade)
  } else {
    const s = { ...shape, angle: shape.angle, advance }
    switch (family) {
      case 'ballistic':
        drawBallistic(ctx, s)
        break
      case 'plasma':
        drawPlasma(ctx, s)
        break
      case 'light':
        drawLight(ctx, s)
        break
      case 'shock':
        drawShock(ctx, s)
        break
      case 'explosive':
        drawExplosive(ctx, s, 1)
        break
      case 'bomb':
        drawExplosive(ctx, s, BOMB_SCALE)
        break
      case 'melee':
        drawMelee(ctx, s)
        break
      case 'needles':
        drawNeedles(ctx, s)
        break
      case 'spread':
        drawSpread(ctx, s)
        break
      default:
        drawPlain(ctx, s)
    }
  }
  ctx.restore()
}

/** Oriented shape: its geometry plus its advance, once the direction is known. */
interface Oriented extends Omit<ShotShape, 'angle'> {
  angle: number
  advance: number
}

/**
 * drawDeathMarker — the death of which NO axis is readable (incomplete pair, rule 89/93):
 * a DOTTED ring, dated and localized, that asserts no direction. Convention already
 * established by the POC — the dotted line is the mark of "read but not orientable".
 */
export function drawDeathMarker(
  ctx: CanvasRenderingContext2D,
  shape: ShotShape,
  color: string,
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.globalAlpha = 0.75 * shape.fade
  ctx.beginPath()
  ctx.arc(shape.x, shape.y, 5.5, 0, Math.PI * 2)
  ctx.lineWidth = 1.3
  ctx.setLineDash([2, 2])
  ctx.stroke()
  ctx.setLineDash([])
  drawOrigin(ctx, shape, shape.fade)
  ctx.restore()
}

/** drawOrigin — the burst of a shot whose aim is not readable. No direction invented. */
function drawOrigin(ctx: CanvasRenderingContext2D, shape: ShotShape, fade: number): void {
  ctx.globalAlpha = 0.85 * fade
  ctx.beginPath()
  ctx.arc(shape.x, shape.y, 2.5, 0, Math.PI * 2)
  ctx.fill()
}

function endOf(s: Oriented): { x: number; y: number } {
  return { x: s.x + Math.cos(s.angle) * s.length, y: s.y + Math.sin(s.angle) * s.length }
}

/**
 * drawBallistic — a POWDER: a clean short stroke, that fades sharply.
 *
 * TWO CLOCKS, re-tuned on the POC: the SPARK fades fast (square of the remaining time) —
 * that is the dry detonation asked for; the STROKE decays more slowly (power 1.5) because it
 * carries WHO shot at WHOM, and an information of that price must not disappear in two
 * frames. The POC had measured the opposite defect: everything to the cube, and the effect
 * was absent at the 4x and 8x speeds.
 */
function drawBallistic(ctx: CanvasRenderingContext2D, s: Oriented): void {
  const e = endOf(s)
  const k = s.fade * s.fade
  const kt = Math.pow(Math.max(0, s.fade), 1.5)
  ctx.globalAlpha = 0.9 * kt
  ctx.lineWidth = 2.2
  ctx.beginPath()
  ctx.moveTo(s.x, s.y)
  ctx.lineTo(e.x, e.y)
  ctx.stroke()
  // The muzzle spark: it grows as it fades (POC), to the square — a detonation.
  ctx.globalAlpha = Math.min(1, 1.1 * k)
  ctx.beginPath()
  ctx.arc(s.x, s.y, 2 + 4.2 * k, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * drawPlasma — the energy does not fade like a powder: SOFT decay (square root, re-tuned
 * POC — that is the intended contrast with the ballistic: same gesture, opposite
 * extinction), and the stroke WAVES.
 */
function drawPlasma(ctx: CanvasRenderingContext2D, s: Oriented): void {
  const nx = -Math.sin(s.angle)
  const ny = Math.cos(s.angle)
  const phase = (s.seed % 13) * 0.48
  const k = Math.sqrt(Math.max(0, s.fade))
  ctx.globalAlpha = 0.8 * k
  ctx.lineWidth = 2.3
  ctx.beginPath()
  const steps = 14
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    const off = Math.sin(u * 7.5 + phase + s.advance * 2.2) * 3.6 * (1 - u) * k
    const px = s.x + Math.cos(s.angle) * s.length * u + nx * off
    const py = s.y + Math.sin(s.angle) * s.length * u + ny * off
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.stroke()
}

/**
 * drawLight — a CONTINUOUS BEAM: two superposed strokes, wide and pale under thin and
 * sharp. The thickness does not vary with the age, only the opacity falls: a beam does not
 * disperse, it fades (widths re-tuned POC: 6.5 / 2.0).
 */
function drawLight(ctx: CanvasRenderingContext2D, s: Oriented): void {
  const e = endOf(s)
  ctx.beginPath()
  ctx.moveTo(s.x, s.y)
  ctx.lineTo(e.x, e.y)
  ctx.globalAlpha = 0.28 * s.fade
  ctx.lineWidth = 6.5
  ctx.stroke()
  ctx.globalAlpha = 0.95 * s.fade
  ctx.lineWidth = 2
  ctx.stroke()
}

/**
 * drawShock — a BROKEN ARC: a zigzag line, never straight. Decay re-tuned POC (power 1.6):
 * quicker than a plasma, less dry than a powder.
 */
function drawShock(ctx: CanvasRenderingContext2D, s: Oriented): void {
  const nx = -Math.sin(s.angle)
  const ny = Math.cos(s.angle)
  const segments = 6
  const k = Math.pow(Math.max(0, s.fade), 1.6)
  ctx.globalAlpha = Math.min(1, 1.1 * k)
  ctx.lineWidth = 1.7
  ctx.beginPath()
  for (let i = 0; i <= segments; i++) {
    const u = i / segments
    const amp = i === segments ? 0 : (2 + (s.seed % 5)) * (i % 2 ? 1 : -1)
    const px = s.x + Math.cos(s.angle) * s.length * u + nx * amp
    const py = s.y + Math.sin(s.angle) * s.length * u + ny * amp
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.stroke()
}

/**
 * drawExplosive — TWO TIMES: a thick short start, then a wave that opens. The wave settles
 * at the END only if it is REAL (`target`, the victim of a death); on a shot it stays
 * centered on the shooter — the film dates no impact. `scale`: 1 for the blast,
 * `BOMB_SCALE` for the bomb (range, wave AND strokes larger — lot M6.2).
 */
function drawExplosive(ctx: CanvasRenderingContext2D, s: Oriented, scale: number): void {
  const burst = Math.max(0, (s.fade - 0.7) / 0.3)
  if (burst > 0) {
    const dl = Math.min(s.length, 22 * scale)
    const e = { x: s.x + Math.cos(s.angle) * dl, y: s.y + Math.sin(s.angle) * dl }
    ctx.globalAlpha = 0.9 * burst
    ctx.lineWidth = 3.4 * scale
    ctx.beginPath()
    ctx.moveTo(s.x, s.y)
    ctx.lineTo(e.x, e.y)
    ctx.stroke()
  }
  const cx = s.target ? s.x + Math.cos(s.angle) * s.length : s.x
  const cy = s.target ? s.y + Math.sin(s.angle) * s.length : s.y
  ctx.globalAlpha = 0.5 * s.fade
  ctx.lineWidth = 1.4 * scale
  ctx.beginPath()
  ctx.arc(cx, cy, (5 + 24 * s.advance) * scale, 0, Math.PI * 2)
  ctx.stroke()
}

/**
 * drawMelee — NO muzzle flash: the gesture is not a shot, it is a short arc, open toward the
 * victim. The LINK ARC between the two is only drawn if the victim is really in reach
 * (`meleeLink`, threshold 8 m measured on the killFx side): linking a hammer to a victim 20
 * m away would assert a contact that did not happen.
 */
function drawMelee(ctx: CanvasRenderingContext2D, s: Oriented): void {
  const r = 7 + 13 * s.advance
  ctx.globalAlpha = 0.9 * s.fade
  ctx.lineWidth = 2.4
  ctx.beginPath()
  ctx.arc(s.x, s.y, r, s.angle - 0.9, s.angle + 0.9)
  ctx.stroke()
  ctx.globalAlpha = 0.45 * s.fade
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.arc(s.x, s.y, r * 0.6, s.angle - 1.25, s.angle + 1.25)
  ctx.stroke()
  if (s.target && s.meleeLink) {
    const ex = s.x + Math.cos(s.angle) * s.length
    const ey = s.y + Math.sin(s.angle) * s.length
    const nx = -Math.sin(s.angle)
    const ny = Math.cos(s.angle)
    const b = s.length * 0.3
    ctx.globalAlpha = 0.75 * s.fade
    ctx.lineWidth = 1.9
    ctx.beginPath()
    ctx.moveTo(s.x, s.y)
    ctx.quadraticCurveTo((s.x + ex) / 2 + nx * b, (s.y + ey) / 2 + ny * b, ex, ey)
    ctx.stroke()
  }
}

/**
 * drawNeedles — the signature is the BURST, not the stroke: five spikes that spread. The
 * small detonation at the end only plays if it is real (`target`, a death): a shot of the
 * Needler does not say where its needles ended up.
 */
function drawNeedles(ctx: CanvasRenderingContext2D, s: Oriented): void {
  const nx = -Math.sin(s.angle)
  const ny = Math.cos(s.angle)
  ctx.globalAlpha = 0.85 * s.fade
  ctx.lineWidth = 1.1
  for (let i = 0; i < 5; i++) {
    const spread = (i - 2) / 2
    const reach = s.length * (0.6 + 0.1 * i)
    const ex = s.x + Math.cos(s.angle) * reach + nx * spread * 9
    const ey = s.y + Math.sin(s.angle) * reach + ny * spread * 9
    ctx.beginPath()
    ctx.moveTo(s.x, s.y)
    ctx.lineTo(ex, ey)
    ctx.stroke()
  }
  if (s.target && s.advance > 0.55) {
    const ex = s.x + Math.cos(s.angle) * s.length
    const ey = s.y + Math.sin(s.angle) * s.length
    ctx.globalAlpha = 0.65 * s.fade
    ctx.beginPath()
    ctx.arc(ex, ey, 4 + 15 * ((s.advance - 0.55) / 0.45), 0, Math.PI * 2)
    ctx.lineWidth = 1.2
    ctx.stroke()
  }
}

/**
 * drawSpread — a FAN OF BOLTS (the Heatwave's line of hard-light bolts): five short dashes that
 * leave together and open out as they fly. The film dates the pull, not the bolts: their end is
 * never drawn as an impact.
 */
function drawSpread(ctx: CanvasRenderingContext2D, s: Oriented): void {
  const k = Math.sqrt(Math.max(0, s.fade))
  ctx.globalAlpha = 0.9 * k
  ctx.lineWidth = 2
  for (let i = 0; i < 5; i++) {
    const a = s.angle + ((i - 2) / 2) * 0.09
    const head = s.length * (0.25 + 0.75 * s.advance)
    const tail = Math.max(0, head - 7)
    ctx.beginPath()
    ctx.moveTo(s.x + Math.cos(a) * tail, s.y + Math.sin(a) * tail)
    ctx.lineTo(s.x + Math.cos(a) * head, s.y + Math.sin(a) * head)
    ctx.stroke()
  }
}

/** drawPlain — uncatalogued weapon: a sober stroke, that asserts no family. */
function drawPlain(ctx: CanvasRenderingContext2D, s: Oriented): void {
  const e = endOf(s)
  ctx.globalAlpha = 0.7 * s.fade
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(s.x, s.y)
  ctx.lineTo(e.x, e.y)
  ctx.stroke()
  drawOrigin(ctx, s, s.fade)
}
