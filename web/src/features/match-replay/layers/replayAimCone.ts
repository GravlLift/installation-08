// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayAimCone.ts — the AIM CONE of a marker: its heading, and its ELEVATION read from its
 * LENGTH.
 *
 * EXTRACTED FROM `replayMarkers.ts` ON 2026-08-18 (lot R2-V): the marker layer had crossed
 * the repository size threshold (CLAUDE.md n°5) and the lot added to it the double outline of
 * the page player. The cut falls on a clean boundary — the cone does NOT draw the player, it
 * draws what the player LOOKS AT, and it is the only block in the file that reads two fields
 * (`h` and `p`) rather than a position.
 */
import type { MarkerStyle } from "./replayMarkers";
import { freshness, heldReading, type XY } from "../../../lib/replay/replayLogic";
import type { ReplayTrackReady } from "../../../lib/replay/replayNormalize";

/** Length of a FLAT aim — the reference, not the maximum: elevation plays around it. */
const AIM_LENGTH = 52;
const AIM_HALF_ANGLE = 0.42;
/**
 * THE SCOPE (schema 29): the cone TIGHTENS ITS OPENING, and does NOT change length.
 *
 * The two mechanics are deliberately orthogonal. ELEVATION drives the LENGTH (a tilted
 * gaze carries shorter on the plane); the SCOPE drives the ANGLE (a player with the weapon
 * shouldered looks more narrowly). They are therefore read together without being confused:
 * a scoped player aiming down has a cone that is at once narrower and shorter.
 *
 * THE STEP COUNTS, NOT JUST THE FACT OF BEING AT THE
 * SCOPE (`Point.S`): the higher steps are measured there — rare, but real: across four films,
 * the second detent appears five times out of ~1,000 flips (the weapons that zoom twice,
 * the sniper rifle first among them). Each detent DIVIDES the opening again, by analogy with
 * the game where an extra detent doubles the magnification.
 *
 * THESE VALUES ARE RENDERING CHOICES, AND THAT IS WHAT THEY ARE. The weapon's real
 * magnification has no meaning here: on a top-view map, the cone is not a field of vision,
 * it is a READING MARK. What matters is that the states are distinguishable at a glance —
 * hip, first detent, second detent — not that an opening reproduces an optical factor. The
 * ratio kept (each detent divides by ~2.3) is calibrated for this readability, and the level
 * published by the film is enough to drive it: no need to go fetch the magnification in the
 * weapon data.
 */
const AIM_SCOPED_DIVISOR = 2.3;
/**
 * OPENING FLOOR. Below ~0.07 rad the sector becomes thinner than the marker's outline at
 * usual scales: it would stop reading as a cone and become a line, and the information "he
 * is shouldered" would be lost at the very moment it is strongest.
 */
const AIM_SCOPED_MIN_HALF_ANGLE = 0.07;
/**
 * A narrower cone covers fewer pixels: at equal opacity it would be seen LESS than a wide
 * cone, though it says something rarer and more interesting. The supplement compensates the
 * surface lost; it does not shout.
 */
const AIM_SCOPED_ALPHA_BOOST = 1.25;
const AIM_CONE_ALPHA = 0.55;
/** A 5 s aim is not worth an instant aim: it loses 62% of its opacity. */
const AIM_FADE = 0.62;
/**
 * THE SWING OF THE ELEVATION: ±55% of the flat length, reached at the vertical.
 *
 * The cone therefore runs from 23 px (full dive aim) to 81 px (full upward aim) around the
 * 52 px of the horizontal gaze — a ratio of 3.4 between the two extremes, enough that the
 * direction reads WITHOUT a second mark, which is the whole point of the change.
 *
 * What the measurement says of the field (lot E, 3 films): median −4.7 / −3.4 / −3.6°, 67 to
 * 77% of the aims DOWNWARD, extremes −85.5 to +82°. The map does not stretch then: the cones
 * spend their time a hair BELOW the reference, and it is the instants that matter — a diving
 * shot, a player covering a bridge — that deviate sharply.
 */
const AIM_PITCH_SWING = 0.55;
/** Beyond this, `sin` CLIMBS BACK DOWN and would invert the reading: the length would stop being monotone. */
const AIM_PITCH_CLAMP_DEG = 90;

/**
 * drawAimCone draws the DIRECTION OF THE GAZE, decoded from the same record as the position.
 *
 * The cone fades from the center to the edge — dense at the origin, where one must read WHO
 * is aiming, transparent at the tip, where it must not mask the background. It pales with the
 * age of the measurement and is NOT drawn beyond the hold: past that delay, we no longer know
 * where the player looks, and an expired direction would assert what we do not know.
 *
 * THERE IS NO AXES ANYMORE (decision D3, 2026-08-16): the two lines that extended the point
 * — "the stick" — were removed at the user's request. What the cone alone loses in angular
 * precision, the map gains in readability: eight sticks on a 4v4 crossed above the names.
 *
 * THERE IS NO ELEVATION TICK ANYMORE EITHER (2026-08-29, same request, same reason). The line
 * stuck to the cone's tip read as a tracing defect rather than as a measurement, and it only
 * existed to compensate for the COSINE of the time, which being even confused "aims at the
 * sky" and "aims at his own feet". The length now carries the sign itself (`pitchScale`):
 * the tick had nothing left to say, so it was removed — not disabled (CLAUDE.md n°7).
 *
 * ITS DIMENSIONS ARE THOSE OF THE BOARD, "a bit more pronounced" (verdict of the evening of
 * 2026-08-16, §1bis of the plan): radius 52 flat, half-opening 0.42 rad, alpha 0.55. The
 * cone had first been shrunk to 30 px / 0.30 — too timid to read once the names were placed.
 *
 * SINCE SCHEMA 13, IT SAYS BOTH AXES OF THE GAZE. The heading orients the sector; the
 * ELEVATION (`p`, degrees, positive = upward) rules its LENGTH — short when down, long when
 * up. An artifact prior to schema 13 does not carry `p`: the cone keeps its reference length
 * there, and that is the intended behavior — absent reads "flat", never "unknown".
 */
export function drawAimCone(
  ctx: CanvasRenderingContext2D,
  track: ReplayTrackReady,
  c: XY,
  style: MarkerStyle,
  color: string,
): void {
  const read = heldReading(
    track.points,
    style.frame,
    (p) => p.h,
    style.timing.aimHold,
  );
  if (!read) return;
  const fresh = freshness(read.age, style.timing.aimHold, AIM_FADE);
  // World -> canvas: the Y axis is inverted, so the angle is too.
  const ang = (-read.value * Math.PI) / 180;
  // THE SCOPE acts on the OPENING, never on the length: the latter is already carried by
  // the elevation. The two mechanics thus remain readable together.
  const palier = heldScoped(track.points, style, read.age);
  drawAimSector(ctx, c, ang, style.k, color, {
    lengthScale: aimLengthScale(heldPitch(track.points, style, read.age)),
    fresh,
    halfAngle: scopedHalfAngle(palier),
    alphaBoost: palier > 0 ? AIM_SCOPED_ALPHA_BOOST : 1,
  });
}

/** What the SECTOR leaves to its caller, besides the angle and the ink. */
export interface AimSectorOptions {
  /**
   * Multiplies the reference length (52 px). The cone of a PAWN puts its elevation there
   * (`aimLengthScale`); a caller with no elevation to say leaves 1 — "flat", which is exactly
   * the meaning of the absence (cf. the note on the `p` field above).
   */
  lengthScale?: number;
  /** Freshness of the measurement, 0..1: it modulates the opacity. 1 = measurement of the instant. */
  fresh?: number;
  /**
   * HALF-OPENING of the sector, in radians. Default: that of the hip. The cone of a PAWN
   * puts its scope step there (`scopedHalfAngle`); a vehicle has no scope and leaves the
   * default.
   */
  halfAngle?: number;
  /**
   * Multiplies the opacity, capped at 1. Serves the SCOPE STEP, which tightens the cone:
   * without this gain, a sector three times narrower would read three times paler on
   * screen.
   */
  alphaBoost?: number;
}

/**
 * drawAimSector — the AIM SECTOR itself: the geometry and the opacities, without the
 * measurement.
 *
 * EXTRACTED FROM `drawAimCone` (vehicle lot): an EMBARKED player no longer replicates their
 * biped, so no more aim heading — but the VEHICLE, for its part, carries a heading, and the
 * user's decision of the workstream is to use it ("at rest we assume it looks in front of
 * itself; in motion, the direction of the movement"). The vehicle layer therefore needs the
 * SAME cone, from an angle it computes itself — not a second geometry that would diverge at
 * the first tuning ("≤ 2 copies" rule).
 *
 * `ang` IS ALREADY IN CANVAS RADIANS (the world -> screen inversion belongs to the caller,
 * which alone knows which heading it starts from), and the caller also supplies its density
 * `k` and its ink: this block knows neither marker, nor track, nor theme.
 */
export function drawAimSector(
  ctx: CanvasRenderingContext2D,
  c: XY,
  ang: number,
  k: number,
  color: string,
  options: AimSectorOptions = {},
): void {
  const {
    lengthScale = 1,
    fresh = 1,
    halfAngle = AIM_HALF_ANGLE,
    alphaBoost = 1,
  } = options;
  const R = AIM_LENGTH * lengthScale * k;
  const gradient = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, R);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "transparent");
  ctx.globalAlpha = Math.min(1, AIM_CONE_ALPHA * fresh * alphaBoost);
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.arc(c.x, c.y, R, ang - halfAngle, ang + halfAngle);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * heldPitch returns the ELEVATION in force, or 0 (flat).
 *
 * THE AGE RULE IS NOT A DECORATIVE PRECAUTION. `p` is omitted when the aim rounds to flat
 * (contract of the field, cf. `Point.P` on the Go side), and `heldReading` would then climb
 * back to an OLDER point that, for its part, carries an elevation: the marker would display
 * an expired dive on a current flat aim. The two angles coming from the SAME record, an
 * elevation found further back in the past than the heading necessarily belongs to another
 * aim — we refuse it, and "absent" becomes what it should be.
 */
function heldPitch(
  points: ReplayTrackReady["points"],
  style: MarkerStyle,
  headingAge: number,
): number {
  const read = heldReading(
    points,
    style.frame,
    (p) => p.p,
    style.timing.aimHold,
  );
  return read && read.age <= headingAge ? read.value : 0;
}

/**
 * heldScoped says whether the player IS AT THE SCOPE at the moment read, and applies THE
 * SAME AGE RULE as the elevation, for the same reason.
 *
 * `s` is omitted when the player is not at the scope (contract of the field, cf. `Point.S`
 * on the Go side): `heldReading` would therefore climb back to an OLDER point that, for its
 * part, carries a step, and the marker would display an expired shoulder on a current hip
 * aim. The field being set by the SAME record as the heading, a step found further back in
 * the past than the heading necessarily belongs to another instant — we refuse it.
 *
 * ABSENT READS "NOT AT THE SCOPE", NEVER "UNKNOWN": that is the contract published by the
 * document, and it makes correct by default the rendering of artifacts prior to schema 29 —
 * they draw the wide opening, which is what they have always done.
 */
function heldScoped(
  points: ReplayTrackReady["points"],
  style: MarkerStyle,
  headingAge: number,
): number {
  const read = heldReading(
    points,
    style.frame,
    (p) => p.s,
    style.timing.aimHold,
  );
  if (read === null || read.age > headingAge) return 0;
  return read.value > 0 ? read.value : 0;
}

/**
 * scopedHalfAngle: the cone opening for a given scope step.
 *
 * Step 0 (or absent): the full opening, that of the hip. Each detent then divides, with a
 * floor — without it, a third detent would make the cone unreadable.
 */
function scopedHalfAngle(palier: number): number {
  if (palier <= 0) return AIM_HALF_ANGLE;
  const ouverture = AIM_HALF_ANGLE / Math.pow(AIM_SCOPED_DIVISOR, palier);
  return Math.max(AIM_SCOPED_MIN_HALF_ANGLE, ouverture);
}

/**
 * aimLengthScale: what the elevation does to the LENGTH of the cone — `1 + 0.55 × sin(p)`.
 *
 * EXPORTED ON 2026-09-03 (vehicle workstream, schema 39): the cone of a VEHICLE OCCUPANT
 * now reads a real elevation (`ReplayVehicleAim.p`, same component `i21`, same convention as
 * `Point.p`) and must therefore translate it the SAME way a pawn does — otherwise two length
 * scales would coexist for the same quantity.
 *
 * IT IS NO LONGER A PROJECTION, AND THAT IS DELIBERATE. The previous version was `cos(p)`,
 * the horizontal part of a tilted gaze: physically right, but EVEN — diving 30° and aiming
 * 30° into the air gave exactly the same cone, so a direction mark (the tick) had to be added
 * beside it to lift an ambiguity that the length itself created.
 *
 * The sine flips this bargain: it is ODD and STRICTLY INCREASING on [−90, +90], so the
 * length alone orders the aims — the more the player noses down, the shorter the cone; the
 * more it raises the head, the longer. A single stroke carries the information, and nothing
 * is stuck on the cone to complete it.
 *
 * IT IS ALSO THE MOST SENSITIVE WHERE THE MEASUREMENTS LIVE: its slope is maximal flat,
 * where the median of the field falls (−4.7 / −3.4 / −3.6° across three films), and it
 * saturates near the vertical, where the exact degree teaches nothing more.
 *
 * THE FLOOR IS NO LONGER A SEPARATE CONSTANT: at −90° the factor is 0.45, i.e. 23 px — the
 * marker stays readable without having to border anything. The CLAMP, however, is necessary
 * for another reason: `sin` comes back down beyond ±90°, and the published formula of `p`
 * covers ±180° under explicit condition (cf. `AimPitchDeg` on the Go side). A value outside
 * the central half of the field would then shorten a cone that is rising — we cap it rather
 * than let the reading invert.
 */
export function aimLengthScale(pitchDeg: number): number {
  const bounded = Math.max(
    -AIM_PITCH_CLAMP_DEG,
    Math.min(AIM_PITCH_CLAMP_DEG, pitchDeg),
  );
  return 1 + AIM_PITCH_SWING * Math.sin((bounded * Math.PI) / 180);
}
