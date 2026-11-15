/**
 * useReplayWeaponPads — ALL THE WIRING OF THE PADS LAYER, in one single point.
 *
 * WHY A HOOK AND NOT FOUR PIECES IN `ReplayCanvas`. The canvas of the replay carries a size
 * debt FROZEN by a ratchet (cf. placementFamily.guard.test.ts): any addition to it is done by
 * extraction, never by stacking. This hook therefore gathers the four concerns of the layer —
 * the cooking of the vignettes, the per-frame tracing, the hover and the tooltip — and only
 * returns to the canvas three useful lines: `paint`, the two pointer handlers, and the
 * current hover. Same stance as `usePlacementHover` and `useSlotIdentity` before it.
 *
 * THE VIGNETTES ARE COOKED ONCE PER THEME, not per frame. They are the SAME icons as the
 * player cards — those of the document (`weaponLabels[id].img`, 168 PNGs extracted from the
 * game) — and most are MASKS to tint: a canvas does not know the `mask-image` of CSS, the
 * tinting is therefore done offscreen by composition (`tintedIconCanvas`, the same utility
 * as the grenade vignettes). A family without visual borrows none: the layer draws it a
 * neutral glyph.
 *
 * A PAD IS NOT ALWAYS A WEAPON (schema 17, 2026-08-19). A POWER-UP pad publishes an
 * EQUIPMENT family (`powerup_overshield`) and not the hexadecimal of a weapon: it is in NO
 * table of the document, neither for the size, nor for the name, nor for the vignette. The
 * three resolutions therefore go through pure functions (`padScaleFor`, `padNameFor`,
 * `padIconRefFor`) which first query the table of the non-weapon families — a written table,
 * never a prefix test — before falling back on the weapon catalog. Without them, the center
 * pad of Catalyst remained small, without image, and its tooltip displayed its raw key.
 *
 * THE CURRENT FRAME IS READ IN A REFERENCE, never in a React state (same rule and same
 * accepted consequence as `usePlacementHover`): if the state of a pad changes UNDER a
 * motionless pointer, its tooltip waits for the next movement. At rest — the case where one
 * inspects — the reading is exact.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from 'react'

import { staticAssetURL } from '@/lib/staticAssets'
import { useTitleSlug } from '@/lib/title-routing'

import { catalogText } from '../i18n/catalogLabel'
import { REPLAY_TEXT, type ReplayLocale } from '../i18n/i18n'
import { applyPadPickupDating } from '../model/padPickupDating'
import { refinePadPresence } from '../model/padPresenceRefine'
import type { ReplayText } from '../i18n/i18nContract'
import type { PlacementView } from './placementShapes'
import { withLoadedImage } from './loadedImage'
import { tintedIconCanvas } from './replayDraw'
import { weaponFullIcon } from '../model/weaponFullIcon'
import { frameToMs, type XY } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady, ReplayWeaponPadReady } from '../../../lib/replay/replayNormalize'
import {
  PAD_EQUIPMENT_FAMILIES,
  displayKeyOf,
  padEquipmentFamilyOf,
  padFamilyOf,
  padScaleOf,
  type PadFamily,
  type PadScale,
} from '../model/weaponPadFamilies'
import {
  padRespawnAt,
  padStateAt,
  type PadRespawn,
  type PadState,
} from '../model/weaponPadTime'
import { drawWeaponPadsLayer, padAt, type PadIcon } from './weaponPadsLayer'

/** The WEAPON catalog of the document, as it arrives: a table per identifier, or nothing. */
type PadLabels = ReplayDocumentReady['weaponLabels']

/**
 * weaponLabelKeyOf — THE CANONICAL KEY of a weapon family in `weaponLabels`, whatever the
 * shape of the IDENTIFIER RECEIVED.
 *
 * TWO WRITINGS COEXIST IN THE ALREADY-COOKED ARTIFACTS, AND THAT IS A DEFECT, NOT A CHOICE.
 * `weaponPads[].weapon` and the keys of `weaponLabels` are written `0x%08X` (uppercase,
 * prefixed); `groundWeapons[].w` (and `weaponChanges[].w`, not read here) are written
 * `%08x` (lowercase, without prefix) — a Go artifact `fmt.Sprintf("%08x", ...)` never
 * aligned on the other writing. Verified on the 64 local artifacts: zero lowercase key in
 * `weaponLabels`. Measured result on the join side: `groundWeapons` NEVER found its label —
 * `labels?.[weapon]` returned `undefined` on 100% of the objects.
 *
 * THE DECISION OF THE LOT (2026-09-10) is to normalize HERE, AT THE READING, rather than to
 * re-cook the artifacts to align `W` on `0x%08X`: the 64 local artifacts and all production
 * keep their lowercase writing, and nothing makes them less readable for this lot. Aligning
 * the Go writing would have required a complete re-cooking — excluded from the scope of this
 * lot — for a null gain (no OTHER Go or web reader depends on the case of `W`, cf. `git
 * grep` on `groundWeapons\[\].w` and `\.w\b` of the layer: the only readers are this module
 * and `groundWeaponsLayer.ts`, which already receives the RAW identifier and passes it as is
 * to `iconOf`).
 *
 * IDEMPOTENT ON THE CANONICAL SHAPE, AND THAT IS WHAT MAKES THE FUNCTION SAFE TO PLACE AT
 * BOTH PLACES: an already `0x%08X` key (the pads, which already worked) crosses it UNCHANGED.
 * Applying `weaponLabelKeyOf` to `padScaleFor`/`padNameFor`/`padIconRefFor` — the three
 * resolutions already SHARED by the pads AND the ground weapons (cf. `useReplayGroundWeapons`
 * which reuses `padIconRefFor`) — therefore corrects the second layer without any risk of
 * regressing the first.
 *
 * An entry that does not have the shape of a short hexadecimal (the equipment key of a
 * power-up, e.g. `powerup_overshield`, already intercepted before this call by
 * `padEquipmentFamilyOf`) crosses it UNCHANGED as well: it is not its concern.
 */
export function weaponLabelKeyOf(w: string): string {
  const hex = w.startsWith('0x') || w.startsWith('0X') ? w.slice(2) : w
  if (!/^[0-9a-fA-F]{1,8}$/.test(hex)) return w
  return `0x${hex.toUpperCase().padStart(8, '0')}`
}

/**
 * padScaleFor — the SIZE of a pad, whatever the nature of what it carries.
 *
 * TWO VOCABULARIES, ONE SINGLE RULE. A WEAPON pad publishes the hexadecimal of a family: its
 * canonical key is read in `weaponLabels[id].key` (placed at the request by the service). A
 * POWER-UP pad publishes DIRECTLY its equipment family, which IS already the key — looking
 * for it in `weaponLabels`, a weapon table, returned nothing and left the pad small.
 * `POWER_PAD_KEYS` carries the two vocabularies, so the size rule does not double.
 */
export function padScaleFor(weapon: string, labels: PadLabels): PadScale {
  return padScaleOf(padEquipmentFamilyOf(weapon) ?? labels?.[weaponLabelKeyOf(weapon)]?.key)
}

/**
 * padNameFor — WHAT THE TOOLTIP WRITES, and the order is a rule.
 *
 * 1. a known equipment family returns its local bilingual label (`padEquipmentFamily`);
 * 2. otherwise the bilingual label of the document, if it names this identifier;
 * 3. otherwise the IDENTIFIER ITSELF — and that is INTENDED for a weapon off the catalog of
 *    the title: the hexadecimal is then the only true thing one can write.
 *    THE EXAMPLE CITED HERE UNTIL 2026-09-13 WAS FALSE. The family `0xD7915565` (Mutilator)
 *    was not an "off-catalog" weapon: it had been named since April, and only its identifier
 *    was missing from the replay register — a defect, corrected on the server side, and not
 *    an accepted case. The fallback remains unchanged, but it is no longer justified by it:
 *    a game weapon that falls to step 3 is a shortage to handle, not a fatality.
 *    An equipment family, for its part, can never fall in this case: it is named at step 1
 *    or it is not in the table.
 *
 * 4. A NON-HEX IDENTIFIER that none of the steps above named (an equipment key the
 *    table does not carry yet) is not served RAW: the raw key is a defect marker, and the
 *    tooltip shows its readable writing instead (`displayKeyOf`: underscores become
 *    spaces, words title-cased). The hexadecimal keeps its exact form: it is the identity
 *    of the weapon, and dressing it would lose information.
 */
export function padNameFor(
  weapon: string,
  labels: PadLabels,
  t: ReplayText,
  locale: ReplayLocale,
): string {
  const family = padEquipmentFamilyOf(weapon)
  if (family) return t.padEquipmentFamily[family]
  const named = catalogText(labels?.[weaponLabelKeyOf(weapon)], locale)
  if (named) return named
  return isWeaponHexIdentifier(weapon) ? weapon : displayKeyOf(weapon)
}

/**
 * isWeaponHexIdentifier — the IDENTIFIER OF A WEAPON as the film writes it: an optional
 * `0x` prefix over one to eight hexadecimal digits. These identifiers fall through to the
 * RAW form in step 3 of `padNameFor`; everything else is a family-style key, which takes
 * the readable writing of step 4.
 */
export function isWeaponHexIdentifier(w: string): boolean {
  const hex = w.startsWith('0x') || w.startsWith('0X') ? w.slice(2) : w
  return /^[0-9a-fA-F]{1,8}$/.test(hex)
}

/** A vignette to load: its URL, its mode (mask to tint or finished image), its orientation. */
export interface PadIconRef {
  url: string
  tinted: boolean
  /** True = atlas image, to turn for the sense of the kill feed of the game (cf.
   * weaponFullIcon). */
  mirrored: boolean
}

/**
 * padIconRefFor — WHICH IMAGE for this pad, or null (the layer then places a neutral glyph).
 *
 * A WEAPON TAKES ITS FULL VERSION, THE SAME AS THE CARDS AND THE KILL FEED (user return of
 * 2026-08-28: "pour les armes il faut utiliser les icônes comme pour les fiches de joueurs et
 * le kill feed" (for the weapons one should use the icons like for the player cards and the
 * kill feed)). The document cooks the `contour` atlas — an empty weapon stroke, which is
 * lost on a grayscale map background already edged in black; the `silhouette` is a FULL
 * shape, readable at 8 px. The exchange is done on the client side (`weaponFullIcon`), for
 * the same reason as on the cards: the URL is frozen in the artifact at the build. And as
 * on the cards, the atlas image is rendered TURNED — the two atlases point left, the game
 * right.
 *
 * THE POWER-UPS RESOLVE ON THE CLIENT SIDE, like the full version of the weapon icons of the
 * cards (cf. `weaponFullIcon.ts`): their family does not enter ANY catalog of the document —
 * the title manifest declares an icon only on its grenades and its capabilities, never on
 * its `[[equipment_objects]]`. The HUD mask exists nevertheless, delivered under
 * `static/weapons-assets/{slug}/hud/`, and it is that very one the manifest names for the
 * capability of the same name. A guard replays the link; nothing is guessed at execution.
 */
export function padIconRefFor(weapon: string, labels: PadLabels, titleSlug: string): PadIconRef | null {
  const family = padEquipmentFamilyOf(weapon)
  if (family) {
    const url = staticAssetURL('weapon', `hud/${PAD_EQUIPMENT_FAMILIES[family].icon}`, '.png', titleSlug)
    // The HUD mask of a power-up is not an atlas image: it keeps its orientation.
    return url ? { url, tinted: true, mirrored: false } : null
  }
  const label = labels?.[weaponLabelKeyOf(weapon)]
  if (!label?.img) return null
  const full = weaponFullIcon(label.img)
  return { url: full.url, tinted: !!label.tinted, mirrored: full.mirrored }
}

/**
 * SPECIAL_WEAPON_ROLES — THE THREE ROLES OF THE "SPECIAL WEAPONS" FILTER of the ground
 * weapons layer.
 *
 * THE DEFINITION RETAINED IS THE COMBAT FUNCTION DIMENSION (`WeaponLabel.role`, placed at
 * the request from the canonical register — never a hard-coded weapon table on the web
 * side), NOT THE HANDLING (`class`): it isolates exactly what a pad distributes and what an
 * opponent has an interest in picking up (S7 Sniper, Shock Rifle, SPNKr, Skewer, Cindershot,
 * Hydra, Épée, Marteau, Needler, Sentinel Beam) and leaves out the CQS48 Bulldog
 * (`shotgun`) and the starting arsenal. Measured: 17.4% of the published objects, but 65.3%
 * of the OBSERVED pickups — a picked-up weapon is almost two times out of three a weapon
 * that counts.
 */
export const SPECIAL_WEAPON_ROLES: ReadonlySet<string> = new Set(['sniper', 'power', 'special'])

/**
 * isSpecialWeaponRole — the predicate of the filter, and ITS GUARD against ABSENT roles.
 *
 * A MISSING ROLE (label off the register, or an artifact of a title that does not publish
 * one) IS NEVER SPECIAL — that is the explicit rule of the lot: the object remains visible
 * toggle OFF, and disappears toggle ON, exactly like a weapon of which one knows nothing
 * never asserts itself off-catalog. Guessing "special" on a data absence would be the same
 * lie as an icon borrowed from a neighboring weapon.
 */
export function isSpecialWeaponRole(role: string | undefined): boolean {
  return role !== undefined && role !== '' && SPECIAL_WEAPON_ROLES.has(role)
}

/**
 * weaponRoleOf — THE ROLE of a weapon, whatever the shape of its identifier (cf.
 * `weaponLabelKeyOf`). `undefined` when the document does not publish it — never a guessed
 * empty string: `isSpecialWeaponRole` already distinguishes "absent" from "known and
 * neutral".
 */
export function weaponRoleOf(weapon: string, labels: PadLabels): string | undefined {
  return labels?.[weaponLabelKeyOf(weapon)]?.role
}

/**
 * crossedWeaponPads — THE PADS TO DRAW, once the catalog of the map is crossed.
 *
 * WHAT THE CROSSING BRINGS, and it brings only that: the POSITION. The server serves only
 * the locations that a pad of the match CONFIRMS (less than a meter), and it serves them at
 * the position of the SPAWNER as the map file places it — to the centimeter, known from the
 * first frame. The film, for its part, only gives the centroid of the spawns it saw, so
 * nothing before the first.
 *
 * WHAT THE CROSSING DOES NOT TOUCH: the PRESENCE. The spawns, the intervals, the cycle, the
 * weapon family and therefore the full / uncertain / empty states and the countdown remain
 * EXACTLY those of the match. The catalog does not know what appears on a pad (the same
 * object carries the sword or the hammer depending on the match), nor when.
 *
 * A PAD OF THE FILM THAT THE CATALOG IGNORES REMAINS DRAWN, at its original position: the
 * film is authoritative, the catalog complements. And a location of the catalog that the
 * film does not confirm never arrives here — the server does not send it, and nothing of
 * what follows could invent it, since everything starts from `weaponPads`.
 *
 * WITHOUT CROSSING (map off-catalog, artifact of another title, answer of an earlier
 * version): the list of the film, unchanged. It is the fallback, and it is the behavior of
 * before 2026-08-19.
 */
export function crossedWeaponPads(
  pads: readonly ReplayWeaponPadReady[],
  cross: ReplayDocumentReady['mapWeaponPads'],
): readonly ReplayWeaponPadReady[] {
  const spots = cross?.pads ?? []
  if (spots.length === 0) return pads
  // FIRST CITATION WINS: two locations cannot move the same pad to two places. The server
  // does not do it, the client does not rely on it.
  const parSocle = new Map<number, (typeof spots)[number]>()
  for (const spot of spots) {
    if (!parSocle.has(spot.pad)) parSocle.set(spot.pad, spot)
  }
  return pads.map((pad, i) => {
    const spot = parSocle.get(i)
    if (!spot) return pad
    return { ...pad, x: spot.x, y: spot.y, z: spot.z ?? pad.z }
  })
}

/** What is hovered: the pad, its state READ AT THIS INSTANT, and where to place the
 * tooltip. */
export interface WeaponPadHover {
  pad: ReplayWeaponPadReady
  at: XY
  /** Name of the weapon in the language of the reader, or its identifier when nothing
   * names it. */
  name: string
  state: PadState
  /**
   * The countdown AND ITS PROVENANCE, or null (non-empty pad, or no source).
   *
   * THE OBJECT RATHER THAN A NUMBER since D3 (2026-08-27): the tooltip must distinguish the
   * next spawn SEEN in the film from the one the cycle PREDICTS. The number alone confused
   * the two and made a prediction read as a measurement.
   */
  respawn: PadRespawn | null
}

export interface WeaponPadsInput {
  doc: ReplayDocumentReady
  view: PlacementView
  /** The current frame, as the reading loop holds it. */
  frameRef: RefObject<number>
  /** False when the layer is off: nothing is drawn, nothing is hovered. */
  enabled: boolean
  /**
   * The inks of the layer: the NEUTRAL of the field (the point) and the FILL / RIM pair of
   * the marking (the vignette and the countdown). They all come from the canvas.
   */
  ink: {
    neutral: string
    fill: string
    outline: string
    /** Ink by NATURE of pad (A13): power-up, power weapon, ordinary rack. */
    family: Readonly<Record<PadFamily, string>>
  }
  locale: ReplayLocale
  /** Repaint the scene: the vignettes arrive after the fact (asynchronous loading). */
  redraw: () => void
}

export interface WeaponPads {
  /** Does the film carry pads? A toggle that commands nothing is not displayed. */
  available: boolean
  /**
   * THE NAME OF THE LAYER, carried by the layer and not by the binding table of the canvas
   * (2026-09-06, review R1 finding C2): that is what makes it impossible to paint this
   * gesture under the identity of another layer.
   */
  id: 'socles-armes'
  /** Trace the layer at the requested frame; does nothing when it is off. */
  paint: (ctx: CanvasRenderingContext2D, frame: number, k: number) => void
  hover: WeaponPadHover | null
  onPointerMove: (event: PointerEvent<HTMLCanvasElement>) => void
  onPointerLeave: () => void
}

export function useReplayWeaponPads({
  doc,
  view,
  frameRef,
  enabled,
  ink,
  locale,
  redraw,
}: WeaponPadsInput): WeaponPads {
  // THE PADS OF THE MATCH, PLACED AT THE LOCATIONS OF THE MAP when the server crossed them
  // (cf. crossedWeaponPads), THEN DATED BY THE NATIVE PICKUP WHEN THE FILM SAYS SO (cf.
  // applyPadPickupDating, detonations lot of 2026-10-22), THEN, for what remains uncertain,
  // their uncertainty brought back to what a player could have done (cf. refinePadPresence,
  // user decision of 2026-08-27).
  //
  // THE ORDER OF THE THREE IS THE RULE (D-10: the grammar prevails over the heuristic). The
  // dating by the native event passes FIRST: it collapses the window of an occupation to
  // the exact instant when the film says so, and the proximity refinement that follows has
  // nothing more to do on it (its window is already quasi-null). The refinement, for its
  // part, measures DISTANCES to the pad, it must therefore work on the FINAL position — the
  // crossing only moves it by less than a meter by construction, but that is exactly the
  // scale of the approach radius, and the inversion would be paid at the edges.
  //
  // ONE SINGLE PASS PER DOCUMENT, never per frame: the refinement walks the segments of
  // track of each window of uncertainty, which is too expensive to redo sixty times per
  // second. Memoized on the four sources, like the table it returns.
  const pads = useMemo(
    () =>
      refinePadPresence(
        applyPadPickupDating(crossedWeaponPads(doc.weaponPads, doc.mapWeaponPads), doc.padPickups),
        doc.tracks,
      ),
    [doc.weaponPads, doc.mapWeaponPads, doc.padPickups, doc.tracks],
  )
  const [hover, setHover] = useState<WeaponPadHover | null>(null)
  const iconsRef = useRef<Map<string, PadIcon>>(new Map())
  const titleSlug = useTitleSlug()
  const t = REPLAY_TEXT[locale]

  // THE SIZE AND THE NAME follow the CANONICAL KEY of what the pad carries — never its
  // hexadecimal, never a label. The three resolutions live above, in pure functions: they
  // are the same for a weapon and for a pad power-up, and that is where it is written which
  // of the two vocabularies applies.
  const labels = doc.weaponLabels
  const scaleOf = useCallback((weapon: string) => padScaleFor(weapon, labels), [labels])
  // THE INK OF THE NATURE (A13): the family is resolved from the same canonical key as the
  // size, and the caller has already resolved the three tokens — this hook only pairs them.
  const inkOf = useCallback(
    (weapon: string) => ink.family[padFamilyOf(weapon, labels?.[weapon]?.key)],
    [labels, ink.family],
  )
  const nameOf = useCallback(
    (weapon: string) => padNameFor(weapon, labels, t, locale),
    [labels, t, locale],
  )

  // THE VIGNETTES, cooked once per document AND per ink: a mask is tinted offscreen, a
  // finished image is placed as is (same `tinted` contract as WeaponIcon).
  //
  // TWO TINTINGS PER VIGNETTE since 2026-08-18: the BODY in the ink of the text, the RIM in
  // that of the background. A canvas does not know how to edge an image; the layer therefore
  // replays the same shape all around, and it needs the two.
  //
  // THE RIM IS NO LONGER BLACK (user return of 2026-08-28: "pour les contours des armes et
  // power-up, le noir ça va pas — les dessins de carte sont en niveaux de gris avec contours
  // noirs, c'est difficile de distinguer les armes" (for the outlines of the weapons and
  // power-ups, black does not work — the map drawings are in grayscale with black outlines,
  // it is difficult to distinguish the weapons)). It takes the ink of the NATURE of the pad,
  // that very one that its diamond carries: a colored halo around a light silhouette
  // stands out from a gray background, where black on black was confused. The ink of the
  // background (`ink.outline`) remains that of the COUNTDOWN, which is text and not a shape.
  //
  // THE RIM IS SERVED FOR ALL THE IMAGES since 2026-08-27, FINISHED images included (user
  // return: "icône AVEC contour" (icon WITH outline)). It was refused to the non-masks on
  // the ground that one cannot re-tint them — true for the BODY, false for the rim: edging
  // only asks for the SILHOUETTE, and `tintedIconCanvas` returns it from any image with
  // alpha (composition `source-in`, which keeps only the alpha and fills it with the ink).
  // Only the body still distinguishes the two cases.
  useEffect(() => {
    const map = new Map<string, PadIcon>()
    iconsRef.current = map
    const seen = new Set<string>()
    for (const pad of pads) {
      const ref = padIconRefFor(pad.weapon, labels, titleSlug)
      if (!ref || seen.has(pad.weapon)) continue
      seen.add(pad.weapon)
      const weapon = pad.weapon
      const tinted = ref.tinted
      const mirrored = ref.mirrored
      const outlineInk = inkOf(weapon)
      withLoadedImage(ref.url, (im) => {
        map.set(weapon, {
          fill: tinted || mirrored ? tintedIconCanvas(im, ink.fill, { mirrored, tinted }) : im,
          outline: tintedIconCanvas(im, outlineInk, { mirrored }),
        })
        redraw()
      })
    }
  }, [pads, labels, titleSlug, ink.fill, inkOf, redraw])

  const frameMs = useMemo(() => frameToMs(1, doc), [doc])

  const paint = useCallback(
    (ctx: CanvasRenderingContext2D, frame: number, k: number) => {
      if (!enabled || pads.length === 0) return
      drawWeaponPadsLayer(
        ctx,
        pads,
        view,
        { frame, frameMs, k },
        {
          ink: ink.neutral,
          fill: ink.fill,
          outline: ink.outline,
          iconOf: (weapon) => iconsRef.current.get(weapon) ?? null,
          scaleOf,
          inkOf,
          countdownLabel: t.padCountdownFmt,
        },
      )
    },
    [enabled, pads, view, frameMs, ink.neutral, ink.fill, ink.outline, scaleOf, inkOf, t.padCountdownFmt],
  )

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (!enabled || pads.length === 0 || view.width === 0) {
        setHover((prev) => (prev === null ? prev : null))
        return
      }
      const rect = event.currentTarget.getBoundingClientRect()
      // The context draws in CSS pixels; the ratio is worth 1 only if the layout does not
      // rescale the canvas — one computes it rather than supposing it (same reasoning as the
      // hover of the placements).
      const kx = rect.width > 0 ? view.width / rect.width : 1
      const ky = rect.height > 0 ? view.height / rect.height : 1
      const at = { x: (event.clientX - rect.left) * kx, y: (event.clientY - rect.top) * ky }
      const style = {
        ink: ink.neutral,
        fill: ink.fill,
        outline: ink.outline,
        iconOf: () => null,
        scaleOf,
        inkOf,
        countdownLabel: t.padCountdownFmt,
      }
      const found = padAt(pads, view, style, window.devicePixelRatio || 1, at)
      setHover((prev) => {
        if (!found) return prev === null ? prev : null
        const frame = frameRef.current
        const next: WeaponPadHover = {
          pad: found,
          at,
          name: nameOf(found.weapon),
          state: padStateAt(found, frame),
          respawn: padRespawnAt(found, frame, frameMs),
        }
        // THE COUNT IS COMPARED FIELD BY FIELD since it is an object: `padRespawnAt` builds
        // a new one at each call, and an identity comparison would ALWAYS return a
        // different state — the tooltip would be recreated at each pointer movement.
        if (
          prev &&
          prev.pad === next.pad &&
          prev.state === next.state &&
          prev.respawn?.seconds === next.respawn?.seconds &&
          prev.respawn?.measured === next.respawn?.measured &&
          prev.at.x === at.x &&
          prev.at.y === at.y
        ) {
          return prev
        }
        return next
      })
    },
    [enabled, pads, view, ink.neutral, ink.fill, ink.outline, scaleOf, inkOf, t.padCountdownFmt, frameRef, frameMs, nameOf],
  )

  const onPointerLeave = useCallback(() => {
    setHover((prev) => (prev === null ? prev : null))
  }, [])

  return { id: 'socles-armes', available: pads.length > 0, paint, hover, onPointerMove, onPointerLeave }
}
