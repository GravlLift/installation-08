/**
 * playerCardFx.ts — ALL THE VISUAL EFFECTS OF A PLAYER CARD, composed in one single place.
 *
 * EXTRACTED FROM `ReplayTeams.tsx` ON 2026-08-27, when the ZONE effects (repair field,
 * shroud screen, enemy sensor) and the TRANSLOCATION glint joined the four
 * existing ones (death, two event glints, camouflage glass, over-shield frame):
 * the composition exceeded the mold of a component function. Here it is PURE —
 * CSS strings and class names, no React — therefore tested directly
 * (playerCardFx.test.ts), and the card keeps only the render.
 *
 * THE EFFECTS LIVE ON A LAYER UNDER THE CONTENT, SET ON THE BORDER OF THE TILE
 * (option 2a of the handoff 2026-08-27): since each card is a self-contained tile
 * (border, rounded corners), the absolute layer is `inset-0` AT THE RADIUS OF THE TILE
 * (`rounded-lg` in normal, `rounded-md` in compact — `ReplayPlayerCard.TILE_LAYOUT.layerRadius`,
 * 2026-09-07) — frames and veils follow the tile instead of drawing a second ring set back.
 * It is she who receives `underStyle` and the glint class; the INSET above
 * (cloud and lightning of the screen, crosses of the field, ring of the sensor, sleeve of
 * translocation) lives in ReplayTeams.ZoneFxOverlay, at the same geometry.
 *
 * THE GRAMMAR OF THE EFFECTS, as it settled batch after batch:
 *  - a CONTINUOUS state is carried by the BACKGROUND (death, glass, dark veil) or by a FRAME
 *    (over-shield, repair field) — it lasts as long as the measurement lasts;
 *  - an EVENT is carried by a BRIEF GLINT with negative delay (fatal blow, respawn,
 *    translocation): the animation resumes at its real progress, so it stays right after a
 *    jump in the reading time (cf. globals.css);
 *  - the shadows ACCUMULATE (box-shadow accepts several layers), never crush each other;
 *    the background, it, COMPOSES (the veil of the screen darkens the glass of the camouflage);
 *  - no color literal: semantic tokens and theme variables only.
 */
import type { CSSProperties } from 'react'

import { tokenCssVar } from '@/lib/accessibility/semantic-tokens'

import type { ActiveEquipment } from './equipmentFx'
import type { ObjectiveMarkKind } from './objectiveMark'
import type { ZonePresence } from './equipmentZones'
import type { ReplayText } from '../i18n/i18nContract'

/**
 * CSS durations of the glint animations (cf. globals.css) — the negative delay relates to them.
 * THESE NUMBERS ARE THE MIRROR OF THE STYLE SHEET: changing them here without changing
 * them there misaligns the negative delay, and the glint resumes in the wrong place.
 *
 * THE RESPAWN GLINT WENT FROM 0.55 s TO 1.2 s on 2026-08-17 (« slower the glint »,
 * board of 08/16): at 0.55 s the green had disappeared before one had finished reading the name of
 * the card. The SLEEVE of translocation takes up this duration: same kind of event, same
 * reading time.
 */
const DEATH_FLASH_TOTAL_S = 1.86
const RESPAWN_FLASH_S = 1.2
/**
 * Duration of the glint of a translocation, in seconds: the card (sleeve) and the map (two
 * rifts, `placementRift.ts`) share it, so that the two signs of a same jump extinguish
 * together.
 */
export const TRANSLOCATION_FLASH_S = 1.2

/**
 * THE DARK-OF-BOTH-THEMES INK: `--replay-label-stroke`, defined for the outline of the names
 * on the map (globals.css) — a dark calibrated to stay readable on both backgrounds, where
 * a « black » written in hard would shout in light theme. DEATH and the SHROUD SCREEN both use
 * it to « extinguish » the card.
 */
const DARK_INK = 'var(--replay-label-stroke)'

/**
 * THE CHROME OF THE TILE — the background and the border that the card carries ITSELF, apart from the
 * effect layer (option 2a of the handoff 2026-08-27: « each card is a self-contained
 * tile »). The percentages APPROXIMATE the values of the mockup through the tokens of the
 * theme (never a literal, color-tokens rule):
 *  - alive: a very short gradient AROUND `card` — a breath of `foreground` on top
 *    (~oklch 0.225), a point of dark ink on the bottom (~oklch 0.20);
 *  - dead: `card` tinted `destructive` on a slightly dimmed base (~oklch 0.19 0.012 25),
 *    border to the same weakened red. Death has LEFT the effect layer (the old
 *    veil + wash of 2026-08-27): it is the tile that says it, plus the frame « Eliminated »
 *    (ReplayVitality) — the layer keeps only the glint of the fatal blow.
 */
const TILE_TOP_LIFT_PCT = 3
const TILE_BOTTOM_DIP_PCT = 8
const DEAD_TINT_PCT = 6
const DEAD_DIM_PCT = 10
const DEAD_BORDER_PCT = 28

/**
 * TEMPERED GLASS effect of the card during an episode of active CAMOUFLAGE (Notion
 * specification, item 21.1; densified « tempered glass » on reference boards on
 * 2026-08-27): translucency + slight blur + DIAGONAL REFLECTIONS, NOT a reduced opacity over
 * the whole card — the text and the icons stay readable, only the BACKGROUND gets fogged.
 *
 * `BLUR_PX` is the blur of the glass (`backdrop-filter`, with no visible effect as long as nothing
 * textured passes below — the column of cards is never set on the map — but the
 * canonical technique of a CSS « glass » stays correct and cheap if that context changes).
 * `VEIL_PCT` mixes `--foreground` (NOT `--card`) into the ambient background: tinting the background with ITS
 * OWN color would be invisible (0 contrast), `--foreground` is precisely the token designed
 * to contrast on `--card` in the TWO themes — the veil lightens in dark,
 * darkens in light, always visible. `SHEEN_PCT` carries the TWO REFLECTION BANDS
 * diagonal (115°, the slope of the reference boards) in the same ink: that is what
 * makes it read « glass plate » rather than « grayed background ». The edging takes back `--border` at
 * full force, and the TOP EDGE receives a lighter pinstripe — the light on the edge of the
 * glass, the detail the two reference images have in common. No animation: a
 * glass plate does not pulse, and nothing in the film pulses to the rhythm of the camouflage.
 */
const CAMO_GLASS_BLUR_PX = 6
const CAMO_GLASS_VEIL_PCT = 12
const CAMO_GLASS_SHEEN_PCT = 9
const CAMO_GLASS_EDGE_PCT = 28

/**
 * GOLD FRAME of the card during an episode of OVER-SHIELD (Notion specification,
 * item 21.1): a FRAME, not a tinted background — `FRAME_PX` (2 px) is the thinnest that
 * reads as a framing rather than a simple selection outline; `GLOW_PCT` a discreet
 * external halo. Token `legendary` (color-tokens skill): an over-shield is a game state
 * rare and precious, the same semantic family as the « legendary » of the Battlepass —
 * NOT the token `info` of the shield gauge (which, it, stays blue: cf. VitalityBar).
 * No background of its own: composed with the glass of the camouflage, the gold frame must not
 * crush the translucency of the other effect.
 */
const OVERSHIELD_FRAME_PX = 2
const OVERSHIELD_GLOW_PCT = 60

/**
 * GREEN OUTLINE of the REPAIR FIELD (user request of 2026-08-27: « a green outline
 * with mini pharmacy crosses that float on the card »): same grammar of FRAME as
 * the over-shield — a protective state is framed — at the token `success`, that of the
 * HEALTH gauge (cf. VitalityBar): the object heals, the color says the same thing on both sides of the
 * card. The crosses, they, live in the zone inset (ReplayTeams.ZoneFxOverlay).
 */
const REPAIR_FRAME_PX = 2
const REPAIR_GLOW_PCT = 45

/**
 * THE SHROUD SCREEN on the card (request of 2026-08-27, iterated twice the same day):
 * a BLACK CLOUD passes ABOVE the content, slightly — it is the inset that carries it
 * (ReplayTeams.ZoneFxOverlay, class `replay-zone-cloud`; the streaks of the first attempt were
 * confused with the reflections of the glass) — and the effect layer keeps only the discreet side: a LIGHT dark veil (the cloud and it
 * add up), a softer blur than
 * that of the glass (the screen hides, it does not fog), and the dark outline. The two effects
 * COMPOSE: cloud and dark veil on glass.
 */
const SHROUD_CARD_BLUR_PX = 3
const SHROUD_CARD_VEIL_PCT = 14
const SHROUD_FRAME_PX = 2

/** What the composition needs to know of a card at this frame. */
export interface CardFxInput {
  alive: boolean
  /** Frames elapsed since the death (-1 alive) — cf. PlayerState.sinceDeath. */
  deathAge: number
  /** Frames elapsed since the start of the current life (-1: initial life or dead). */
  lifeAge: number
  /** Frames elapsed since the last rift pass of this life (-1: none). */
  teleportAge: number
  /** This moment is the POSE of the rift (and not a pass): the tooltip says so. */
  teleportPose?: boolean
  /** Window of the glints, in frames (FLASH_MS converted by the caller). */
  flashFrames: number
  /** Active equipment state of the current life (null: dead, or no life). */
  equipment: ActiveEquipment | null
  /** Equipment zones under the player (NO_ZONES for a dead card). */
  zones: ZonePresence
  /**
   * THE OBJECTIVE CARRIED at this frame (null: none, or dead card). The WATERMARK, it, renders
   * in `ReplayObjectiveMark` — this field enters here only for the TOOLTIP: a single function
   * composes the sentence of the card, otherwise two enumeration orders diverge at the first addition.
   */
  objective: ObjectiveMarkKind | null
  /** i18n table of the current locale: the tooltip is composed here. */
  text: ReplayText
}

/** What the card renders as is, spread over its two effect layers. */
export interface CardFx {
  /** Glint class of the EFFECT LAYER under the content (death, respawn); '' otherwise. */
  flashClass: string
  /** Style of the effect layer under the content: backgrounds, veils, blur, frames. */
  underStyle: CSSProperties
  /**
   * Negative delay of the SLEEVE of translocation (the light that runs along the border,
   * inset) — null outside the window of the glint.
   */
  translocationDelay: string | null
  title: string | undefined
}

/** Does the effect layer have anything to paint? (the card renders it only if yes). */
export function hasUnderLayer(fx: CardFx): boolean {
  return fx.flashClass !== '' || Object.keys(fx.underStyle).length > 0
}

/**
 * cardChrome — the background and the border of the TILE according to the vital state (cf. TILE_* / DEAD_*).
 * Rendered by the card on its container (`borderColor` + `background`), not by the layer
 * of effects: the chrome is a PERMANENT state of the tile, it does not stack nor animate.
 */
export function cardChrome(alive: boolean): CSSProperties {
  if (alive) {
    return {
      borderColor: 'var(--border)',
      background:
        `linear-gradient(180deg, color-mix(in srgb, var(--foreground) ${TILE_TOP_LIFT_PCT}%, var(--card)), ` +
        `color-mix(in srgb, ${DARK_INK} ${TILE_BOTTOM_DIP_PCT}%, var(--card)))`,
    }
  }
  const rouge = tokenCssVar('destructive')
  return {
    borderColor: `color-mix(in srgb, ${rouge} ${DEAD_BORDER_PCT}%, transparent)`,
    background:
      `color-mix(in srgb, ${rouge} ${DEAD_TINT_PCT}%, ` +
      `color-mix(in srgb, ${DARK_INK} ${DEAD_DIM_PCT}%, var(--card)))`,
  }
}

/**
 * SEAT_WAITING_CHROME — the chrome of a tile WITHOUT CARD (free seat, player not yet appeared):
 * DASHED border at the token `border`, background `card`. The BOX is that of a card, except the class
 * (`ReplayPlayerCard`, shared skeleton); only this dress says that no player plays there at
 * the instant read. Rendered on the container, like `cardChrome`: a permanent state of the tile.
 */
export const SEAT_WAITING_CHROME: CSSProperties = Object.freeze({
  borderStyle: 'dashed',
  borderColor: 'var(--border)',
  background: 'var(--card)',
})

/** The negative delay of a glint: the animation resumes at its real progress. */
function negativeDelay(age: number, flashFrames: number, totalS: number): string {
  return `${(-(age / flashFrames) * totalS).toFixed(3)}s`
}

/**
 * THE GLINT of the effect layer, if there is one — and the style receives its negative delay.
 * Death and respawn exclude each other by the vital state; the translocation, it, lives on the
 * INSET (border sleeve), therefore does not contend here.
 */
function flashOf(i: CardFxInput, style: CSSProperties): string {
  if (!i.alive) {
    if (i.deathAge < 0 || i.deathAge > i.flashFrames) return ''
    style.animationDelay = negativeDelay(i.deathAge, i.flashFrames, DEATH_FLASH_TOTAL_S)
    return 'replay-flash-death'
  }
  if (i.lifeAge < 0 || i.lifeAge > i.flashFrames) return ''
  style.animationDelay = negativeDelay(i.lifeAge, i.flashFrames, RESPAWN_FLASH_S)
  return 'replay-flash-respawn'
}

/**
 * THE BACKGROUND AND THE BLUR of a living card: glass of the camouflage, veil of the screen, or the
 * two composed — the dark veil then tints the glass, as the screen of the game darkens what
 * one sees through. The reflections of the glass go to `backgroundImage` (a LAYER, not
 * a color); the veil to `backgroundColor`: two longhands, so that each reads and
 * tests alone.
 */
function glassAndVeilOf(i: CardFxInput, style: CSSProperties, shadows: string[]): void {
  const camo = i.equipment?.camo === true
  const shroud = i.zones.shroudSinceMs !== null
  if (!camo && !shroud) return
  const blur = Math.max(camo ? CAMO_GLASS_BLUR_PX : 0, shroud ? SHROUD_CARD_BLUR_PX : 0)
  style.backdropFilter = `blur(${blur}px)`
  style.WebkitBackdropFilter = style.backdropFilter
  let veil = 'var(--card)'
  if (camo) veil = `color-mix(in srgb, var(--foreground) ${CAMO_GLASS_VEIL_PCT}%, ${veil})`
  if (shroud) veil = `color-mix(in srgb, ${DARK_INK} ${SHROUD_CARD_VEIL_PCT}%, ${veil})`
  style.backgroundColor = veil
  if (camo) {
    const sheen = `color-mix(in srgb, var(--foreground) ${CAMO_GLASS_SHEEN_PCT}%, transparent)`
    style.backgroundImage =
      `linear-gradient(115deg, transparent 30%, ${sheen} 30%, ${sheen} 46%, ` +
      `transparent 46%, transparent 58%, ${sheen} 58%, ${sheen} 64%, transparent 64%)`
    shadows.push('inset 0 0 0 1px var(--border)')
    shadows.push(
      `inset 0 1px 0 color-mix(in srgb, var(--foreground) ${CAMO_GLASS_EDGE_PCT}%, transparent)`,
    )
  }
  if (shroud) shadows.push(`inset 0 0 0 ${SHROUD_FRAME_PX}px ${DARK_INK}`)
}

/** The tooltip: each active state says its sentence, in a stable order. */
function titleOf(i: CardFxInput): string | undefined {
  const parts = [
    // THE OBJECTIVE FIRST: it is the state that decides the round, it is read before the equipment.
    i.objective ? i.text.objectiveCarry[i.objective] : null,
    i.equipment?.camo ? i.text.equipmentActive.camo : null,
    i.equipment?.overshield ? i.text.equipmentActive.overshield : null,
    i.teleportAge >= 0 && i.teleportAge <= i.flashFrames
      ? (i.teleportPose ? i.text.translocationPose : i.text.translocationFlash)
      : null,
    i.zones.repair ? i.text.zonePresence.field : null,
    i.zones.shroudSinceMs !== null ? i.text.zonePresence.shroud : null,
    i.zones.sensorSincePingMs !== null ? i.text.zonePresence.sensor : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/**
 * playerCardFx — the complete composition of the effects of a card at a frame.
 *
 * A DEAD CARD CARRIES NO EFFECT, apart from the glint of the fatal blow in its window: the
 * continuing death is said by the chrome of the tile (`cardChrome`) and the frame « Eliminated »,
 * not by this layer. The equipment and zone effects, they, exist only on a
 * living card (the episodes close at the death at the latest, and the zones are
 * computed on the current life).
 */
export function playerCardFx(i: CardFxInput): CardFx {
  const underStyle: CSSProperties = {}
  const flashClass = flashOf(i, underStyle)
  if (!i.alive) {
    return { flashClass, underStyle, translocationDelay: null, title: undefined }
  }
  const shadows: string[] = []
  glassAndVeilOf(i, underStyle, shadows)
  if (i.equipment?.overshield) {
    shadows.push(`inset 0 0 0 ${OVERSHIELD_FRAME_PX}px ${tokenCssVar('legendary')}`)
    shadows.push(
      `0 0 10px color-mix(in srgb, ${tokenCssVar('legendary')} ${OVERSHIELD_GLOW_PCT}%, transparent)`,
    )
  }
  if (i.zones.repair) {
    shadows.push(`inset 0 0 0 ${REPAIR_FRAME_PX}px ${tokenCssVar('success')}`)
    shadows.push(
      `0 0 8px color-mix(in srgb, ${tokenCssVar('success')} ${REPAIR_GLOW_PCT}%, transparent)`,
    )
  }
  if (shadows.length > 0) underStyle.boxShadow = shadows.join(', ')
  const translocationDelay =
    i.teleportAge >= 0 && i.teleportAge <= i.flashFrames
      ? negativeDelay(i.teleportAge, i.flashFrames, TRANSLOCATION_FLASH_S)
      : null
  return { flashClass, underStyle, translocationDelay, title: titleOf(i) }
}
