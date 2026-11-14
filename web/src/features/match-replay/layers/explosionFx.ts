/**
 * explosionFx.ts — THE EXPLOSION OF A GRENADE, in particles.
 *
 * BORROWED, NOT REINVENTED. The reference is `apps/web/src/components/replay/ExplosionFx.tsx`
 * from the Csstat project: a 1.4 s timeline — very brief radial flash, additive fireball,
 * shockwave ring, shard trails, residual dust — and three typed particle families (embers,
 * shards, puffs). The mechanics, the drag coefficients and the TIME PROPORTIONS are taken
 * from it; what changes amounts to three constraints of THIS canvas, written below: the
 * render must be a FUNCTION OF TIME, it must be BOUNDED, and its DURATION is what the
 * 16/08 board asked for (2.4 s, cf. EXPLOSION_MS — the phases follow, to scale).
 *
 * WHAT THE EXPLOSION ASSERTS, AND WHAT IT DOES NOT ASSERT. CORRECTED 2026-10-22 (detonations
 * lot): the film WRITES the detonation (`projectile_detonate`/`projectile_impact_effect`
 * message from view A), and the server publishes it on `Projectile.detoT/detoX/detoY` when it
 * is in range of the track (`detoLue` true, measured on 727 linked throws of five witness
 * films, median 17-35 ms after the last replicated position). Without a detonation in range,
 * the server sets a NAMED and COUNTED fallback — THE LAST REPLICATED POSITION — never an
 * asserted detonation without a reading. The explosion remains a STAGING (particles,
 * timeline) placed at the instant and position the server decided; it does not recompute
 * them.
 *
 * FUNCTION OF TIME, NOT STATEFUL ANIMATION. The reference advances its particles frame by
 * frame. Here the reading moves: we go forward, backward, jump to the cursor. A stateful
 * explosion would show anything after a rewind. Each particle is therefore REPLAYED from
 * its seed at every frame — same seed, same age, same image.
 *
 * THE COMPOSITION IS A PROPERTY OF THE BACKGROUND, NOT OF THE EFFECT (correction of
 * 2026-08-15). The reference composes its four hot layers ADDITIVELY (`lighter`): on its
 * black map, the explosion burns. Measured here in real Chromium, phase by phase, on the two
 * backgrounds of each theme (`--background` and `--card`) and for the three types that
 * detonate — pixels actually changed by at least 24/255, worst of the two backgrounds and
 * the three types:
 *
 *   phase                | dark theme    | light theme
 *   flash        (40 ms) | 648 -> 820    |   0 -> 1484
 *   fireball     (180)   | 235 -> 194    |   0 ->  379
 *   shockwave    (180)   | 326 -> 318    |   0 ->  313
 *   shards       (180)   |  47 ->  46    |   0 ->   43
 *   dust         (900)   |  40 ->  40    | 314 ->  314   <- the only one already in `source-over`
 *
 * (These figures date from the 1.4 s timeline; the 17/08 stretch touches neither the inks
 * nor the composition, and the guard remeasures them on every run.)
 *
 * Zero is not "little": `lighter` computes `dst + src*alpha` then clamps to 255. On a
 * background already at 250-254, NO color, NO size, NO opacity can change a pixel. The
 * explosion was not absent on the light theme: it was AMPUTATED of everything that pops,
 * and only the dust remained. No primitive test could see it — hence the rasterization
 * guard `e2e/replay-explosion-raster.spec.ts`.
 *
 * WHAT WAS JUDGED SITE BY SITE, and not replaced in bulk. Additive remains the right operator
 * when TWO LUMINOUS SOURCES OVERLAP ON A GUARANTEED DARK BACKGROUND. Two conditions,
 * therefore, and each site was confronted with the two:
 *  - THE FLASH and the SHOCKWAVE each draw only ONE primitive: they have nothing to
 *    accumulate, even on a black background. Additive brought them nothing and exposed them
 *    to the failure — they therefore LOSE NOTHING by leaving it;
 *  - THE EMBERS (12 disks) and THE SHARDS (10 trails) really do overlap: there, additive
 *    brought something, and they LOSE in it the white overglow of their overlaps. What
 *    remains: semi-transparent disks whose opacities still compose (1-(1-a1)(1-a2)), so a
 *    core that densifies — and the white-hot core is still carried by the `core` ink of the
 *    young embers and by the flash.
 * The background, for its part, is never guaranteed dark: it is that of the theme. None of
 * the four sites therefore fulfills the second condition, and all four move to
 * `source-over` — the same test four times, four measured answers, not a mechanical
 * replacement.
 *
 * BOUNDED, AND THE BOUND IS MEASURED (item 3.4): 12 embers + 10 shards + 6 puffs = 28
 * particles per explosion, at most 144 simulation steps (2.4 s at 60 Hz). The NUMBER of
 * particles does not depend on the duration — it is the same swarm, living longer — so the
 * cost per frame does not move: **19 radial gradients and 228 primitives** at the worst
 * instant, frozen by test. What changes with the 17/08 stretch is the OVERLAP WINDOW: the
 * corpus of 23 local artifacts (801 placed explosions) showed at most 5 simultaneous
 * explosions on 1.4 s; on 2.4 s that number can only grow, and the worst case remains
 * modest (~10 explosions = 190 gradients) on a canvas whose background, structure, zones
 * and objectives are already cooked offscreen.
 */

/**
 * Total duration of the timeline, in milliseconds.
 *
 * 2,400 ms SINCE 2026-08-17, against 1,400 in the Csstat reference: at the validation board,
 * the three explosions were judged "too brief" — the gesture read as a flicker rather than
 * as a detonation. It is a RHYTHM setting, not a measurement: the film still says nothing
 * of the detonation (cf. the header), only the duration of the staging changes.
 *
 * IT IS THE ONLY KNOB: all the phases derive from it by `TIME_SCALE`, including the particle
 * lifetimes. Lengthening the timeline without lengthening the embers would have given an
 * explosion that dies out at a third then leaves a 1.6 s void.
 */
export const EXPLOSION_MS = 2_400

/** The timeline of the reference, from which all the settings below derive. */
const REFERENCE_MS = 1_400
/** Stretch factor of ALL the phases (1.714 today). */
const TIME_SCALE = EXPLOSION_MS / REFERENCE_MS

/** Simulation step, in milliseconds: the reference coefficients are per 60 Hz frame. */
const STEP_MS = 1000 / 60

/** Cost bounds — the reason for the existence of item 3.4. */
const EMBERS = 12
const SPARKS = 10
const DUST = 6
const MAX_STEPS = Math.ceil(EXPLOSION_MS / STEP_MS)

/** Reference radius of the fireball, in SCREEN pixels. */
const BLAST_R = 13
/** Duration of the radial flash (reference: ~70 ms, then extinction over three times as much). */
const FLASH_MS = 70 * TIME_SCALE
/** Duration of the shockwave. */
const WAVE_MS = 380 * TIME_SCALE

/** The inks of an explosion, resolved from the theme (no color written here). */
export interface ExplosionInk {
  /** Tint of the blast: it follows the TYPE of grenade (fire, plasma, crystal). */
  fire: string
  /** White-hot core, common to all firing and explosion effects. */
  core: string
  /** Residual dust: a layout ink, not a data color. */
  smoke: string
}

/** Where and when the explosion plays. */
export interface ExplosionShape {
  x: number
  y: number
  /** Age of the explosion, in milliseconds. Beyond EXPLOSION_MS, nothing is drawn. */
  ageMs: number
  /** Stable seed: two readings of the same instant give back exactly the same image. */
  seed: number
  /** Canvas density: everything addressed to the eye is multiplied by this factor. */
  k: number
  /** Under "reduced motion", the explosion does not play: a fixed footprint replaces it. */
  reduced: boolean
}

/** Seeded pseudo-random generator — the same as the electric net (32-bit LCG). */
function rng(seed: number): () => number {
  let s = (seed | 0) || 1
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

/**
 * drawExplosion plays the explosion at the requested age. Nothing outside the window: a
 * finished explosion costs no operation.
 */
export function drawExplosion(
  ctx: CanvasRenderingContext2D,
  shape: ExplosionShape,
  ink: ExplosionInk,
): void {
  if (shape.ageMs < 0 || shape.ageMs > EXPLOSION_MS) return
  if (!ink.fire) return
  ctx.save()
  if (shape.reduced) {
    drawStill(ctx, shape, ink)
    ctx.restore()
    return
  }
  const steps = Math.min(MAX_STEPS, Math.floor(shape.ageMs / STEP_MS))
  drawDust(ctx, shape, ink, steps)
  drawWave(ctx, shape, ink)
  drawEmbers(ctx, shape, ink, steps)
  drawSparks(ctx, shape, ink, steps)
  drawFlash(ctx, shape, ink)
  ctx.restore()
}

/**
 * drawStill — UNDER REDUCED MOTION: a fixed footprint, neither particles nor progression.
 * The information ("something exploded here") is kept; the stimulation is not.
 */
function drawStill(ctx: CanvasRenderingContext2D, s: ExplosionShape, ink: ExplosionInk): void {
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 0.55
  ctx.strokeStyle = ink.fire
  ctx.lineWidth = 1.6 * s.k
  ctx.beginPath()
  ctx.arc(s.x, s.y, BLAST_R * s.k, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 0.8
  ctx.fillStyle = ink.fire
  ctx.beginPath()
  ctx.arc(s.x, s.y, 2.2 * s.k, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * drawEmbers — THE FIREBALL: puffs projected radially, braked (drag 0.86 per step, reference)
 * and slightly pulled downward. They GROW as they die, and their core goes from white-hot to
 * the type tint: that is the fire scene, in two inks of the theme rather than four hard-coded
 * colors.
 */
function drawEmbers(
  ctx: CanvasRenderingContext2D,
  s: ExplosionShape,
  ink: ExplosionInk,
  steps: number,
): void {
  // SITE 1/4 — the only one, with the shards, where additive brought something: twelve disks
  // that overlap, and whose overlaps burned. But 0 px changed on a light background
  // (measured): the fireball did not exist half the time. In normal composition the opacities
  // still compose (the core densifies), and it exists on both backgrounds.
  ctx.globalCompositeOperation = 'source-over'
  const rand = rng(s.seed)
  for (let i = 0; i < EMBERS; i++) {
    const ang = rand() * Math.PI * 2
    const sp = (0.35 + rand() * 1.1) * s.k
    // LIFE follows the timeline (TIME_SCALE): `el` therefore remains the same fraction at the
    // same relative instant — same size, same opacity as before at mid-course, but over 2.4 s.
    const life = (16 + rand() * 16) * TIME_SCALE
    const r0 = (2.4 + rand() * 2.6) * s.k
    const el = steps / life
    if (el >= 1) continue
    let x = s.x
    let y = s.y
    let vx = Math.cos(ang) * sp
    let vy = Math.sin(ang) * sp * 0.85
    for (let n = 0; n < steps; n++) {
      x += vx
      y += vy
      vx *= 0.86
      vy = vy * 0.86 + 0.02 * s.k
    }
    const r = r0 * (1 + el * 1.3)
    // Young = white-hot core, old = type tint: the cooling of the reference, said with the
    // two inks we have.
    paintRadial(ctx, x, y, r, el < 0.35 ? ink.core : ink.fire, (1 - el) * 0.8)
  }
}

/**
 * drawSparks — THE SHARDS: thin fast trails, braked and attracted downward. They are strokes,
 * not gradients — that is what makes the spray cheap.
 */
function drawSparks(
  ctx: CanvasRenderingContext2D,
  s: ExplosionShape,
  ink: ExplosionInk,
  steps: number,
): void {
  // SITE 2/4 — the shards overlap each other at the start (they are all born at the same
  // point), so additive had a meaning there; it cost them their existence on a light
  // background (0 px) and, on a dark background, it DILUTED them in the fireball they
  // cross — an additive trail laid on an already-saturated core no longer distinguishes.
  // In normal composition, they keep their outline on both backgrounds.
  ctx.globalCompositeOperation = 'source-over'
  ctx.lineCap = 'round'
  ctx.strokeStyle = ink.fire
  const rand = rng(s.seed ^ 0x5f5f)
  for (let i = 0; i < SPARKS; i++) {
    const ang = rand() * Math.PI * 2
    const sp = (1.1 + rand() * 1.6) * s.k
    const life = (22 + rand() * 18) * TIME_SCALE
    const sl = steps / life
    if (sl >= 1) continue
    let x = s.x
    let y = s.y
    let vx = Math.cos(ang) * sp
    let vy = Math.sin(ang) * sp
    for (let n = 0; n < steps; n++) {
      x += vx
      y += vy
      vx *= 0.9
      vy = vy * 0.9 + 0.04 * s.k
    }
    ctx.globalAlpha = 1 - sl
    ctx.lineWidth = (1 - sl) * 1.4 * s.k + 0.3
    ctx.beginPath()
    ctx.moveTo(x - vx * 1.8, y - vy * 1.8)
    ctx.lineTo(x, y)
    ctx.stroke()
  }
}

/**
 * drawDust — THE RESIDUAL DUST: a few puffs that widen and linger, painted UNDER the fire
 * (normal composition). That is what prevents the explosion from disappearing all at once —
 * the reference makes them live much longer than the embers.
 */
function drawDust(
  ctx: CanvasRenderingContext2D,
  s: ExplosionShape,
  ink: ExplosionInk,
  steps: number,
): void {
  if (!ink.smoke) return
  ctx.globalCompositeOperation = 'source-over'
  const rand = rng(s.seed ^ 0x2b2b)
  for (let i = 0; i < DUST; i++) {
    const ang = rand() * Math.PI * 2
    const sp = (0.1 + rand() * 0.4) * s.k
    const life = (60 + rand() * 50) * TIME_SCALE
    const r0 = (3.5 + rand() * 3) * s.k
    // THE SPREAD IS PER LIFE, NOT PER STEP: it divides by the same factor that the life
    // multiplies, otherwise a puff of a 1.7-times-longer timeline would end 1.7 times wider
    // — the dust would eat the map instead of lingering on it.
    const grow = ((0.05 + rand() * 0.09) * s.k) / TIME_SCALE
    const lf = steps / life
    if (lf >= 1) continue
    let x = s.x
    let y = s.y
    let vx = Math.cos(ang) * sp
    let vy = Math.sin(ang) * sp
    for (let n = 0; n < steps; n++) {
      x += vx
      y += vy
      vx *= 0.95
      vy *= 0.95
    }
    // It rises in opacity at the very start (it forms), then fades: that is the ramp of the
    // reference, which avoids a puff that "appears" in one block.
    const a = (1 - lf) * Math.min(1, lf / 0.12) * 0.4
    paintRadial(ctx, x, y, r0 + grow * steps, ink.smoke, a)
  }
}

/** drawWave — THE SHOCKWAVE: a ring that opens fast then calms down (easeOutCubic). */
function drawWave(ctx: CanvasRenderingContext2D, s: ExplosionShape, ink: ExplosionInk): void {
  if (s.ageMs >= WAVE_MS) return
  const pr = s.ageMs / WAVE_MS
  const ease = 1 - Math.pow(1 - pr, 3)
  // SITE 3/4 — A SINGLE ring: it has nothing to accumulate, additive therefore brought it
  // nothing even on a black background, and cost it everything on a light background (0 px).
  // Zero loss here.
  ctx.globalCompositeOperation = 'source-over'
  ctx.strokeStyle = ink.fire
  ctx.globalAlpha = (1 - pr) * 0.8
  ctx.lineWidth = (1 - pr) * 2.4 * s.k + 0.4
  ctx.beginPath()
  ctx.arc(s.x, s.y, ease * BLAST_R * 2.2 * s.k, 0, Math.PI * 2)
  ctx.stroke()
}

/** drawFlash — THE RADIAL FLASH, very brief, over everything else. */
function drawFlash(ctx: CanvasRenderingContext2D, s: ExplosionShape, ink: ExplosionInk): void {
  const fl =
    s.ageMs < FLASH_MS ? 1 : s.ageMs < FLASH_MS * 4 ? 1 - (s.ageMs - FLASH_MS) / (FLASH_MS * 3) : 0
  if (fl <= 0) return
  // SITE 4/4 — A SINGLE disk, over everything else: nothing to accumulate either, and this is
  // THE ONE the user did not see (648 px on a dark background, 0 on a light background).
  // The plateau gives it body: without it, a radial gradient has already lost half its
  // opacity at a third of the radius, and the flash blow was reduced to its center.
  ctx.globalCompositeOperation = 'source-over'
  paintRadial(ctx, s.x, s.y, BLAST_R * 1.8 * s.k, ink.core || ink.fire, fl * 0.9, FLASH_PLATEAU)
}

/**
 * PLATEAU of the FLASH gradient: part of the radius that stays at FULL tint before the
 * falloff.
 *
 * It serves ONLY THE FLASH, and that is deliberate: the embers and the dust are PUFFS, a
 * plateau would make them sharp disks; the flash, for its part, is A BLOW — it needs a body.
 * Same remedy as the muzzle flash (`muzzleFlash.ts`, GRADIENT_PLATEAU), same reason.
 */
const FLASH_PLATEAU = 0.3

/** paintRadial — a graded disk, from the given color toward transparency. */
function paintRadial(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha: number,
  plateau = 0,
): void {
  if (!color || radius <= 0 || alpha <= 0) return
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius)
  g.addColorStop(0, color)
  if (plateau > 0) g.addColorStop(plateau, color)
  // "transparent" rather than a color with zero alpha: the canvas accepts any format of the
  // theme (oklch included) without us having to disassemble it.
  g.addColorStop(1, 'transparent')
  ctx.globalAlpha = Math.min(1, alpha)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
}
