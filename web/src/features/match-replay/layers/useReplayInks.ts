/**
 * useReplayInks — THE INKS OF THE REPLAY, resolved once per palette.
 *
 * WHY THIS FILE EXISTS. Eight color values of the canvas shared EXACTLY the same body —
 * `void paletteVersion` then a `resolveToken` or a `readInk`, memoized on the palette
 * version — re-copied eight times in `ReplayCanvas.tsx`. It is the 3rd copy of the rule
 * CLAUDE.md #6 far exceeded, and it is also what made the canvas grow to its size threshold
 * (`max-lines` eslint, R5): the extraction is the prescribed way to add a layer to it, not
 * raising the ceiling.
 *
 * ONE SINGLE MEMO FOR THE EIGHT, AND THAT IS BETTER THAN EIGHT: they all depended on the
 * same thing, so they all change at the same time. The consumers gain stable references
 * between two renders — what the dependency arrays of the canvas need.
 *
 * TWO SOURCES OF COLOR, AND THEIR DIFFERENCE IS MEANING. `resolveToken` serves the colors
 * that SAY something (a team, a throw, a death): they are semantic tokens, and they follow
 * the accessibility palette the user set. `readInk` serves the layout (edge of a step,
 * outline of a label): they are the variables of the design system, never a literal (cf.
 * canvasInk.ts). No hard-coded value here.
 */
import { useMemo } from 'react'

import { resolveToken } from '@/lib/accessibility/resolveToken'
import { shiftLightness } from '@/lib/accessibility/scales'
import type { SemanticToken } from '@/lib/accessibility/semantic-tokens'

import { readInk } from './canvasInk'
import { useExportActive } from '../export/exportLayoutStore'
import { readFxInk, type FxInk } from './fxInk'
import type { RiftInk } from './placementRift'
import type { ShroudInk } from './placementShroud'
import type { PadFamily } from '../model/weaponPadFamilies'

/** Map background: neutral token, without directional connotation (the subject = the
 * players). */
const GEOMETRY_TOKEN: SemanticToken = 'divergent-neutral'
/**
 * THE INK OF "NO SIDE", and that is a TOKEN because it SAYS something.
 *
 * The replay until now served `floor.edge` — that is to say `--muted-foreground` via
 * `readInk` — everywhere there was no side. That was the breach that `canvasInk.ts`
 * forbids to itself in plain letters: "toute couleur qui DIT quelque chose (une équipe, un
 * tir, une mort) passe par un token" (any color that SAYS something (a team, a shot, a
 * death) goes through a token). "No one holds this zone" says something — it is even a
 * MEASUREMENT of the film (neutral value of the ownership channel), not a layout.
 *
 * `divergent-neutral` IS ALREADY the semantic neutral of the feature: the thread of
 * eliminations uses it for a death no one claims. The sideless objectives therefore speak
 * now the same language as the thread, and follow the accessibility palette of the user —
 * what `readInk` does not do.
 *
 * SAME TOKEN AS `GEOMETRY_TOKEN`, AND TWO CONSTANTS ANYWAY: the map background is neutral
 * because it is not the subject, a zone is neutral because no one holds it. Two distinct
 * reasons, which must be able to diverge without us having to untangle which one we change.
 */
const NEUTRAL_TOKEN: SemanticToken = 'divergent-neutral'
/**
 * The ink of a SIDELESS OBJECTIVE on the map — distinct from `NEUTRAL_TOKEN` since
 * 2026-09-08, cf. `ReplayInks.zone`. Achromatic in all the palettes.
 */
const ZONE_NEUTRAL_TOKEN: SemanticToken = 'zone-neutral'
/**
 * Point events. The FLIGHT of a grenade and the halo of its end of flight borrow a token of
 * information (no mark at the throw point); the SHOT, for its part, no longer takes any data
 * token: its color says the NATURE OF THE DISCHARGE and comes from the diegetic tints of the
 * theme (fxInk.ts, user decision of 2026-08-15). The alert token remains used by the DEATH
 * effects, which have not changed.
 */
const SHOT_TOKEN: SemanticToken = 'destructive'
const GRENADE_TOKEN: SemanticToken = 'info'

/**
 * THE MARKER OF THE PLAYER OF THE PAGE (lot R2-V, user return of 2026-08-18: "avoir l'icône
 * du joueur actif qui se démarque de tous les autres" (have the icon of the active player
 * that stands out from all the others)).
 *
 * `success` IS THE GREEN OF THE REPOSITORY, and that is the green that was asked for —
 * "j'aurais bien aimé du vert, mais pour l'accessibilité je sais pas si ça peut le faire"
 * (I would have liked green, but for accessibility I don't know if it can be done). The
 * answer is: yes, on condition that the color is NEVER ALONE. It here tints only the DOUBLE
 * OUTLINE and the halo, two signs of SHAPE that read without it; the core keeps the TEAM
 * color, which says the side. A reader who does not distinguish this green still sees the
 * only marker of the map that carries two rings.
 */
const SELF_TOKEN: SemanticToken = 'success'

/**
 * THE PROTECTION WALL (W1/R2-5, verdict of 2026-08-18: "je préférerais un orange doré" (I
 * would rather a golden orange)).
 *
 * TWO TOKENS WERE CANDIDATES and the board showed them side by side: `legendary` (the gold,
 * already carried by the frame of the overshield) and `warning` (the alert orange).
 * `warning` is retained. What is LOST is written: the TEAM color of the planter — the wall
 * no longer says WHO placed it. What is gained: it says WHAT, and a field object that keeps
 * its tint whatever the side is recognized at a glance in the middle of eight colored
 * trajectories.
 */
const WALL_TOKEN: SemanticToken = 'warning'

/**
 * THE RIFT OF THE TRANSLOCATOR (2026-08-27: "fais en sorte que ça ressemble plus à un
 * portail interdimensionnel au niveau des couleurs" (make it resemble more an
 * interdimensional portal in terms of colors)).
 *
 * SAME REASONING AS THE WALL above, pushed one notch further: the rift is not a game object
 * that would belong to a side, it is a TEAR. Giving it the team tint of the planter would
 * make it read as one more tactical marker. The side remains readable in the tooltip; what
 * is gained is that it resembles NOTHING else on the map.
 *
 * TWO TOKENS, because a portal has an edge and a light coming out of it:
 *  - `extreme` (fuchsia) for the LIPS — it is the most saturated token of the palette, and
 *    the only one of which no data of the replay uses: it does not conflict with any
 *    reading;
 *  - `bonus` (violet, lighter) for the CORE and the halo — lighter than the lips, which
 *    makes the center read as a lit opening rather than a full stroke.
 *
 * The two are neighbors in tint (271° and 292°), so the object remains ONE color seen from
 * afar, and separates into edge + light when approaching.
 */
const RIFT_RIM_TOKEN: SemanticToken = 'extreme'
const RIFT_CORE_TOKEN: SemanticToken = 'bonus'
/**
 * The FIXED ink of the blackout screen (user decision of 2026-10-30): the ELECTRIC BLUE of
 * the edge and the bolts, that of the bolts of the card (`replay-zone-bolt`, globals.css),
 * so that the map and the card speak of the same electricity. The NIGHT BLUE of the core is
 * the same tint darkened (`SHROUD_CORE_DARKEN`): one single token, so the bubble follows the
 * palette chosen.
 */
const SHROUD_GLOW_TOKEN: SemanticToken = 'info'
const SHROUD_CORE_DARKEN = -0.6

/**
 * THE OVERSHIELD ON THE BODY (3D view): the green shell of the game, that the 3D pales with
 * white. `success` is the green of the palette; it distinguishes itself from the glow of
 * the ordinary shield, at the color of the side (`teamColorOf`), which it covers.
 */
const OVERSHIELD_TOKEN: SemanticToken = 'success'


/**
 * THE INKS OF THE NATURES OF PAD. Two tokens already in service in the replay, none new —
 * the accessibility palette of the user (and its colorblind variants) continues to hold
 * without re-calibration:
 *   - `warning` for a HIGH-STAKES pad, POWER-UP as POWER WEAPON: it is the code of the
 *     special weapons (white vignette edged with this ink on a furnished pad, diamond of
 *     this ink when the location is empty), and the power-up shares it (control #3 of the
 *     controls of the v8, 2026-10-21, which replaces the gold `legendary` of 2026-08-26 on
 *     this point);
 *   - `divergent-neutral` for an ordinary RACK: the semantic neutral of the replay, the
 *     one that recedes — a classic pad must not compete with the two others.
 *
 * THE NATURE REMAINS DISTINCT IN THE MODEL (`PadFamily`): the label, the vignette and the
 * tooltip still say "overshield" or "Sniper"; only the ink is common to the two stakes.
 */
const PAD_FAMILY_TOKENS: Readonly<Record<PadFamily, SemanticToken>> = {
  powerup: 'warning',
  power: 'warning',
  classic: 'divergent-neutral',
}

/** The layout inks of the reconstructed floor: its flat fill and the edge of its steps. */
export interface ReplayFloorInk {
  fill: string
  edge: string
}

export interface ReplayInks {
  /** The TWO team colors as the user set them (decision D1). */
  teamColorOf: (isAlly: boolean) => string
  /** Props Forge of the map background, when no reconstructed floor is available. */
  geometry: string
  /** DEATH effects (the shot, for its part, takes its tint from the discharge: cf. `fx`). */
  shot: string
  /** Flight of the grenades and halo of their end of flight. */
  grenade: string
  /** Reconstructed floor; `edge` also serves as a layout ink for what has no role. */
  floor: ReplayFloorInk
  /** SEMANTIC ink of "no side": neutral objectives, zone that no one holds. */
  neutral: string
  /**
   * The ink of a ZONE, a BASE or a PAD that no one holds — the fill and its rim
   * (2026-09-08).
   *
   * WHY IT CANNOT BE `neutral` (user return: "sur les bases, quand elles sont neutres, on a
   * toujours un bleu neutre, il faut du blanc/gris avec un contour noir ou blanc" (on the
   * bases, when they are neutral, we always have a neutral blue, we need white/gray with a
   * black or white outline)). `neutral` is worth `divergent-neutral`, that the DEFAULT
   * palette renders `#60A5FA` — a blue. On a signed gauge it is good; on a MAP where
   * "ally" is already said in blue, it no longer distinguishes itself from the team. The
   * new token `zone-neutral` is ACHROMATIC in all the palettes: "no side" has no direction
   * to carry.
   *
   * THE RIM IS THE INK OF THE BACKGROUND, and that is the technique already used by the
   * marks and by the flag glyph (`mark.outline`): in dark the fill is light and the rim
   * dark, in light the reverse. A white and a black written in hard would not have done
   * that.
   */
  zone: { fill: string; outline: string }
  /** Ink by NATURE of pad (cf. PAD_FAMILY_TOKENS): power-up, power weapon, rack. */
  pad: Readonly<Record<PadFamily, string>>
  /** Tints of the muzzle flashes, read once per theme (never per frame). */
  fx: FxInk
  /** Grapple line: the lightest ink of the theme (`--foreground`), never a hex. */
  grapple: string
  /** Outline of the labels: DARK in both themes (cf. globals.css). */
  labelStroke: string
  /** Double outline and halo of the player of the page (cf. SELF_TOKEN). */
  self: string
  /** Arc of the protection wall: a FIXED token, plus the team color (cf. WALL_TOKEN). */
  wall: string
  /** The two FIXED inks of the rift of the translocator (cf. RIFT_RIM_TOKEN). */
  rift: RiftInk
  /** The two FIXED inks of the blackout screen (cf. SHROUD_GLOW_TOKEN). */
  shroud: ShroudInk
  /**
   * The energy carried by the body of the Spartan in 3D: the overshield (cf.
   * OVERSHIELD_TOKEN); the ordinary shield takes the color of the side.
   */
  body: { overshield: string }
  /**
   * THE MARKING OF THE PADS: what is FILLED, and what CIRCLES it. They are the two inks of
   * the THEME, not data tokens: in dark the fill is light and the rim dark, in light the
   * reverse — what a white and a black written in hard would not have done.
   *
   * `outline` NO LONGER CIRCLES THE VIGNETTES since 2026-08-28, only the COUNTDOWN: a dark
   * rim around a weapon was confused with the black outlines of the grayscale map
   * backgrounds (user return). The vignettes are circled with the ink of their NATURE
   * (`pad`), the same as their diamond.
   */
  mark: { fill: string; outline: string }
}

/** shroudInk — the electric blue, and the night blue that is the same tint darkened. */
function shroudInk(glow: string): ShroudInk {
  return { core: shiftLightness(glow, SHROUD_CORE_DARKEN), glow }
}

/**
 * useReplayInks resolves all the inks of the replay for the current palette.
 *
 * `paletteVersion` comes from `useColorPaletteVersion()` in the caller — it already
 * observes it for its own series colors. Passing it rather than re-reading it here keeps
 * ONE style observer for the page, and makes the dependency visible at reading.
 */
export function useReplayInks(paletteVersion: number): ReplayInks {
  // THE EXPORT PAINTS IN THE DARK THEME (decision D9): `readInk` and `readFxInk` know it,
  // but this memo must be RECALCULATED at the entry and the exit of the export — and, with
  // it, everything that depends on an ink (cooked layers, tinted vignettes).
  const exporting = useExportActive()
  return useMemo(() => {
    void paletteVersion
    void exporting
    const ally = resolveToken('team-ally')
    const enemy = resolveToken('team-enemy')
    return {
      teamColorOf: (isAlly: boolean) => (isAlly ? ally : enemy),
      geometry: resolveToken(GEOMETRY_TOKEN),
      shot: resolveToken(SHOT_TOKEN),
      grenade: resolveToken(GRENADE_TOKEN),
      floor: { fill: resolveToken(GEOMETRY_TOKEN), edge: readInk('--muted-foreground') },
      neutral: resolveToken(NEUTRAL_TOKEN),
      zone: { fill: resolveToken(ZONE_NEUTRAL_TOKEN), outline: readInk('--background') },
      pad: {
        powerup: resolveToken(PAD_FAMILY_TOKENS.powerup),
        power: resolveToken(PAD_FAMILY_TOKENS.power),
        classic: resolveToken(PAD_FAMILY_TOKENS.classic),
      },
      fx: readFxInk(),
      grapple: readInk('--foreground'),
      labelStroke: readInk('--replay-label-stroke'),
      self: resolveToken(SELF_TOKEN),
      wall: resolveToken(WALL_TOKEN),
      rift: { rim: resolveToken(RIFT_RIM_TOKEN), core: resolveToken(RIFT_CORE_TOKEN) },
      shroud: shroudInk(resolveToken(SHROUD_GLOW_TOKEN)),
      body: { overshield: resolveToken(OVERSHIELD_TOKEN) },
      mark: { fill: readInk('--foreground'), outline: readInk('--background') },
    }
  }, [paletteVersion, exporting])
}
