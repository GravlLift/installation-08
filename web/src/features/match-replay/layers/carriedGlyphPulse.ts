/**
 * carriedGlyphPulse — the PULSATION OF A CARRIED GLYPH, written once.
 *
 * WHY THIS MODULE EXISTS (register 2026-09-05, K4). Three layers carry an object ON its
 * carrier — the crown of the VIP, the skull of Oddball, the bomb of Assault — and the three
 * had rewritten identically the same breathing: four constants and a sinusoid, identical in
 * md5.
 *
 * WHAT THE DUPLICATION RISSED, exactly. The three glyphs belong to three distinct game modes
 * and never co-occur on screen: the danger was therefore NOT a visible desynchronization,
 * but the DRIFT — an eye setting on one of the three, never reported to the other two, and
 * three different breathings for a single gesture of reading, that no one can compare since
 * they are never seen together.
 *
 * WHAT THE PULSATION SAYS. An OPEN carry (the player still carries) breathes; a CLOSED
 * carry — a dated fact has closed it, death of the carrier or handover — is FULL. It is the
 * only thing the opacity tells, and that is why it only depends on `closed` and the frame.
 *
 * REDUCED MOTION: the breathing stops on its MEAN value, not on its minimum nor on its
 * maximum — the glyph stays readable without blinking (`prefers-reduced-motion`).
 */

/** Full opacity: a dated fact closes the carry (death of the carrier, or handover). */
export const CARRIED_ALPHA_SOLID = 0.95

/** Bounds of the pulsation of an "open" glyph (`closed` false), and its period in frames. */
export const CARRIED_PULSE_MIN = 0.42
export const CARRIED_PULSE_MAX = 0.78
export const CARRIED_PULSE_PERIOD_FRAMES = 26

/**
 * carriedGlyphAlpha returns the opacity of a carried glyph at the given frame.
 *
 * The period is in FRAMES and not in milliseconds, like everything read on the grid of the
 * film: at double speed, the breathing doubles with the scene, which is the expected
 * behavior of an effect placed on a carrier that moves twice as fast as well.
 */
export function carriedGlyphAlpha(closed: boolean, frame: number, reducedMotion: boolean): number {
  if (closed) return CARRIED_ALPHA_SOLID
  if (reducedMotion) return (CARRIED_PULSE_MIN + CARRIED_PULSE_MAX) / 2
  const phase = (2 * Math.PI * frame) / CARRIED_PULSE_PERIOD_FRAMES
  return CARRIED_PULSE_MIN + (CARRIED_PULSE_MAX - CARRIED_PULSE_MIN) * (0.5 + 0.5 * Math.sin(phase))
}
