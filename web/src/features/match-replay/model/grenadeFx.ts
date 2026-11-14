/**
 * grenadeFx.ts — WHAT THE THROW -> PROJECTILE LINK ALLOWS TO SAY, and nothing more.
 *
 * FIXED ON 2026-10-22 (detonations batch, follow-up to check no. 24 of the v8 checks). The film
 * WRITES the detonation (message `projectile_detonate`/`projectile_impact_effect` of view A,
 * types 5/6): the server publishes it on `Projectile.detoT/detoX/detoY` when it is within reach
 * of the track (`detoLue` true), and places otherwise a NAMED and COUNTED fallback on the Go side — the LAST
 * REPLICATED POSITION, never an asserted detonation. This layer reads these three fields as
 * the server has already resolved them: it no longer recomputes anything from `P`.
 *
 * BY TYPE (plan decision, batch 2 item 2.3): Shock/Dynamo (rank 2) leaves a persistent
 * ELECTRIC POND ~2-3 s — that is what the weapon does in the game, and the shattered
 * geometry is already the signature of the `shock` family. The other types receive a
 * subtle halo, without an assertion of detonation.
 *
 * No React, no canvas: pure logic, tested (grenadeFx.test.ts).
 */
import { EXPLOSION_MS } from '../layers/explosionFx'
import type { FxTint } from '../layers/fxInk'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'

/** Rank of the Shock/Dynamo type in GrenadeLabels — the order of the ranks is THE data
 *  (established by two independent chains, cf. replay_labels.toml). */
export const DYNAMO_RANK = 2

/**
 * restKindOf — WHAT A GRENADE DOES AT THE END OF ITS FLIGHT, by type.
 *
 * THE ORDER OF THE RANKS IS THE DATA (0 Frag, 1 Plasma, 2 Dynamo, 3 Spike), established by two
 * independent chains and published by the title; what is CHOSEN here is the staging, and it
 * follows what the weapon does in the game:
 *  - Frag and Plasma DETONATE: particle explosion (item 3.3);
 *  - Dynamo DOES NOT EXPLODE — it places a persistent electric pond (~2.5 s). Rule
 *    delivered at batch 2.3 and confirmed by the user, unchanged here;
 *  - Spike: it PLANTS itself then projects its needles. It is also the only type whose end
 *    of flight is certified `at-rest` (measurement: 15 linked flights out of 21, 0 for the three others)
 *    — the object comes to rest BEFORE arming itself. It therefore receives an explosion, tinted
 *    « crystal » rather than fire. **This is the point the plan leaves TO BE JUDGED BY EYE**
 *    (item 3.3): if the user prefers it without detonation, one line suffices to restore
 *    it to the halo.
 *
 * An unknown rank (type a title would publish without our knowing it) keeps the SUBTLE
 * HALO: never the effect of a neighboring type.
 */
export type GrenadeRestKind = 'explosion' | 'nappe' | 'halo'

export function restKindOf(rank: number): GrenadeRestKind {
  if (rank === DYNAMO_RANK) return 'nappe'
  return rank === 0 || rank === 1 || rank === 3 ? 'explosion' : 'halo'
}

/**
 * explosionTintOf — the NATURE of the blast of a type, in the vocabulary of tints
 * (fxInk.ts): a fragmentation grenade is a chemical blast, a plasma grenade
 * a cold energy discharge, a Spike a spray of crystal. Same logic as the shots:
 * the color says what explodes, never who threw it.
 */
export function explosionTintOf(rank: number): FxTint {
  if (rank === 1) return 'plasma_cool'
  if (rank === 3) return 'needle'
  return 'blast'
}

/**
 * Remanences at the rest point, in real time: the electric pond persists, and the window
 * of the three types that detonate equals EXACTLY the timeline of their explosion.
 *
 * THE POND'S WINDOW GOES FROM 2.5 TO 3.0 s ON 2026-08-18 (A4: « the pond must persist for at
 * least 2.5 s on the ground »). The declared window ALREADY said 2.5 s; what the screen showed, for its part,
 * lasted 2.10 s — the opacity descended linearly and passed below the readability
 * threshold before the end of the window (measurement of batch R3, item R3.2). So it is TWO things that
 * change together and only hold together: the window rises to 3.0 s, and the opacity
 * curve becomes a plateau followed by a drop (`dynamoAlpha`, grenadeRestLayer.ts). Measurement
 * after: 2.60 s visible. THE SOUND IS NOT TOUCHED — it is dated by the end of flight, not by
 * this window.
 *
 * IT IS ALIGNED ON `EXPLOSION_MS`, AND THAT IS AN INVARIANT, not a coincidence: this
 * window BOUNDS the drawing (`drawGrenadeRestLayer` exits as soon as `age > hold`). Left at 1.4 s
 * while the timeline was passing to 2.4 s, it would have cut each explosion at 58% of its
 * run — exactly the defect the 16/08 board reported (« too brief »), moved
 * up one notch. The test of `grenadeFx` replays the equality.
 */
export const DYNAMO_REST_HOLD_MS = 3_000
export const GRENADE_REST_HOLD_MS = EXPLOSION_MS

/** Remanence of the throw badge on the CARD (the `.gic` of the POC): that of the throws. */
export const GRENADE_THROW_HOLD_MS = 1_400

/** An end-of-flight effect, precomputed in world coordinates. */
export interface GrenadeRestFx {
  /** Frame of the EXPLOSION published by the server (`Projectile.detoT`): that of the
   *  READ detonation/impact message when `detoLue` is true, that of the last step of the linked projectile
   *  otherwise (named fallback on the Go side). */
  frame: number
  x: number
  y: number
  /** Rank of the grenade type (index in grenadeLabels), `-1` when the film does not publish it.
   *  NO FALLBACK TO 0: `restKindOf` then returns the subtle halo — exactly what its
   *  own doctrine promises — and the SOUND falls silent (EXPLOSION_SOUND_STEMS, grenadeSound.ts).
   *  Falling back to 0 would make a frag detonate, and sound ITS explosion, for a grenade whose
   *  type is not established: the effect of a neighbor, which this file refuses everywhere. */
  rank: number
  /** CERTIFIED end of flight (`projectile-at-rest-state`). MEASUREMENT on the witness 000d5950:
   *  the component appears ONLY on Spike flights (15/21 linked) — never frag, plasma nor
   *  Dynamo (0/44), whose object DETONATES instead of coming to rest. Conditioning the effect on
   *  this certification would therefore extinguish three types out of four — the effect is placed at
   *  the last replicated point, and the screen says what it is. */
  rest: boolean
  /** Stable seed for the shattered geometry: going back gives the same shape again. */
  seed: number
  /** Present = explosion of a SHOT PROJECTILE (`buildShotImpactFx`), not of a grenade: the
   *  layer draws it as an explosion whatever `rank` is, in this nature of discharge. */
  tint?: FxTint
  /** Stem of the sound of the detonation of a shot projectile (register of the weapon). Absent on a
   *  shot projectile = silent explosion; a grenade (without `tint`) sounds by its rank. */
  impactStem?: string
}

/** Seed of the geometry of an explosion, function of its frame alone: the same explosion
 *  replays the same shape, grenade or shot projectile (a single formula). */
export function explosionSeedOf(frame: number): number {
  return (frame * 2654435761) % 100003
}

/** The active throw of a player: its rank, and the age of the gesture (in frames). */
export interface ThrowReading {
  rank: number
  age: number
}

/**
 * grenadeThrowActive — the LAST throw of a player in the remanence window.
 *
 * THE AUTHOR IS WRITTEN IN THE FILM (Grenade.i = film player index): it is not
 * guessed, unlike the shooter of a shot — that is what allows a badge on the CARD.
 * The join goes through the film index of the roster, never through a supposed order.
 */
export function grenadeThrowActive(
  doc: ReplayDocumentReady,
  filmIndex: number,
  frame: number,
  holdFrames: number,
): ThrowReading | null {
  let best: ThrowReading | null = null
  for (const g of doc.grenades) {
    if (g.i !== filmIndex) continue
    const age = frame - g.t
    if (age < 0 || age > holdFrames) continue
    if (!best || age < best.age) best = { rank: g.rank ?? 0, age }
  }
  return best
}

/**
 * buildGrenadeRestFx links each throw to the EXPLOSION of ITS projectile.
 *
 * THE INSTANT AND THE POSITION COME FROM THE SERVER (`Projectile.detoT/detoX/detoY`, fixed on
 * 2026-10-22): the READ detonation/impact message in view A when it is within reach of the
 * track, or, failing that, the LAST REPLICATED POSITION — a named and counted fallback on the Go side
 * (`fallback.NomDetonationDernierePositionConnue`), never an asserted detonation without a read.
 * This layer recomputes nothing from `P`: it reads the decision already taken.
 *
 * The effect is NOT conditioned on the `at-rest` certification: measured by type, it
 * exists only on the Spike (cf. GrenadeRestFx.rest) — demanding it would extinguish the others.
 * An out-of-bounds link (artifact of another version) is ignored — never an effect placed
 * at random.
 *
 * SINCE 2026-08-18, IT ALSO DATES THE SOUND (batch R2-G): the explosion of each grenade
 * starts at `frame`, the same as the on-screen effect (grenadeSound.ts). This is deliberately the
 * SAME function and not a parallel rule — two datings that would diverge would make
 * the explosion sound next to its image, without anything saying so.
 */
export function buildGrenadeRestFx(doc: ReplayDocumentReady): GrenadeRestFx[] {
  const out: GrenadeRestFx[] = []
  for (const g of doc.grenades) {
    if (g.proj === undefined || g.proj === null) continue
    const pr = doc.projectiles[g.proj]
    if (!pr) continue
    const frame = pr.detoT
    out.push({
      frame,
      x: pr.detoX,
      y: pr.detoY,
      rank: g.rank ?? -1,
      rest: !!pr.rest,
      seed: explosionSeedOf(frame),
    })
  }
  return out
}
