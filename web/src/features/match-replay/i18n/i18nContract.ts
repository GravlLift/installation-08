// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * i18nContract.ts — THE TEXT CONTRACT for the 2D replay: one field per displayed string, and
 * the reason each one exists, in a comment.
 *
 * EXTRACTED FROM `i18n.ts` ON 2026-08-18 (batch R2-V): that file used to carry the contract AND
 * both translation tables, and it had crossed the repo's size threshold (CLAUDE.md #5, 505
 * lines). The split falls on a line that can be said in one sentence — on one side what the UI
 * PROMISES to display, on the other what each language SAYS.
 *
 * FR/EN PARITY IS STILL ENFORCED BY TYPING: `Record<ReplayLocale, ReplayText>` in `i18n.ts`
 * rejects any language missing a field.
 */
import type { PadEquipmentFamilyKey } from '../model/weaponPadFamilies'

/**
 * Ammo for the WEAPON IN HAND as the compact tile states it in a tooltip (I9 of the compact
 * cards plan): a `mag / res` count (magazine weapons), a remaining charge in percent (plasma /
 * melee / energy families), or "full" (the slot is never written — differential stream, full is
 * the default value). The same three shapes as `AmmoCell`.
 */
export type AmmoHint =
  | { kind: 'count'; mag: number; res?: number }
  | { kind: 'charge'; pct: number }
  | { kind: 'full' }

/**
 * "Equipment usage, per player" (Match view, "Weapons and terrain" tab): the grid counts, over
 * the whole match, what the replay only shows frame by frame.
 *
 * `infoByPlayer` states what the grid counts; the REPULSOR has no column (an empty column would
 * read as "zero usage"), and no text states what the grid does NOT count (no "unknown" shown on
 * screen, enforced by `lib/i18n/noUnknownMentions.guard.test.ts`).
 *
 * THE FAMILY NAMES ARE NOT HERE, and that is intentional: they already live in `placementFamily`
 * (render rules) and `padEquipmentFamily` (weapon pad bases). A third name table would drift the
 * first time the manifest adds an entry.
 */
export interface EquipmentUsageText {
  title: string
  /** Card title: the grid of players, one column per equipment family. */
  viewByPlayer: string
  /** Title tooltip: what the grid counts and over what scope (one or two sentences). */
  infoByPlayer: string
  /** Legend: the three outcomes of a pickup, then grapple pulls. */
  legendUsed: string
  legendKept: string
  legendDropped: string
  legendGrapple: string
  /** Tooltip for a grid bar: player, measure, value ALREADY FORMATTED. */
  gridTipFmt: (player: string, column: string, value: string) => string
  /** Header for the grapple-pulls column (the only ability ACTIVATION counted). */
  groupGrapple: string
  /**
   * THE THREE OUTCOMES OF A PICKUP (P1), formatted for the tooltip of ONE segment — not for a
   * column header (that stays `equipmentFamilyLabel`). The cell total reads "N items taken",
   * NEVER "picked up" (P12): `outcomeTotalTakenFmt`.
   */
  outcomeUsedFmt: (count: number) => string
  outcomeKeptFmt: (count: number) => string
  outcomeDroppedFmt: (count: number) => string
  outcomeTotalTakenFmt: (count: number) => string
  /**
   * THE "HIGHLIGHT" BADGE (`features/match-view/equipmentKillBadges.ts`, BATCH F.3): "N kills
   * under camo" / "N kills under overshield", the REAL number from the match's best episode —
   * never rounded, never a per-player sum. Lives here (not in `match-view/i18n`) for the same
   * reason as the rest of the equipment vocabulary: family names belong to the replay
   * dictionary, and `match-view` imports them (same meaning as `MatchEquipmentUsageSection`,
   * reused as-is by `MatchViewTabChronology`).
   */
  killBadgeFmt: Record<'camo' | 'overshield', (kills: number) => string>
  /** Badge tooltip: the active state's remaining amount (source not distinguished, bounds at
   * broadcast precision, camo alone below the measurement threshold on a wide reading). */
  killBadgeHint: string
}

export interface ReplayText {
  title: string
  back: string
  play: string
  pause: string
  restart: string
  loading: string
  empty: string
  /**
   * THE REPLAY COULD NOT BE LOADED (an error other than a 404, cf. `model/replayLoadState`): the
   * match has a replay, the server just didn't serve it. Title, explanation, and a retry button.
   */
  loadErrorTitle: string
  loadErrorDescription: string
  loadErrorRetry: string
  /**
   * THE ADMIN "schema version" BADGE (batch A, 2026-09-11): visible ONLY when
   * `useAppShellStore((s) => s.isAdmin)` is true (product rule — a non-admin sees nothing, not
   * even an empty badge). Five shapes, one per state of `ReplaySchemaStatus`
   * (`model/replaySchemaStatusLogic.ts`):
   *  - `schemaBadgeUpToDateFmt`: the artifact already carries the version the producer would
   *    write today;
   *  - `schemaBadgeStaleFmt`: the artifact is behind — the second number is the producer's
   *    CURRENT version, to be rebaked;
   *  - `schemaBadgeStalePublicationFmt` (2026-09-18, batch 4.4.2, schema 62): the artifact is
   *    behind AND the module PROVES that only the PUBLICATION layer changed — its revision is
   *    `publication-<schemaVersion>`, so comparing the two numbers is enough. The four decoding
   *    layers are NOT nameable: their current revisions are not carried (§4 of the plan, not
   *    adopted). JUST ONE MORE KEY, and NO fifth state: it is the same `stale`, said more
   *    precisely;
   *  - `schemaBadgeStaleNoTargetFmt` (2026-09-13, batch 0.B): the artifact is BELOW the minimum
   *    version this client declares it can display, and no producer version is known (header
   *    absent). It needs rebaking, but no target can be named: writing one anyway would make a
   *    compatibility floor look like today's version;
   *  - `schemaBadgeUnknownFmt`: no comparison is possible (the `X-Replay-Latest-
   *    Schema-Version` header is absent — artifact predates this batch, or a cached response):
   *    the badge says the one thing it knows, the READ version, never asserting a status;
   *  - `schemaBadgeInvalidFmt` (2026-09-13, batch 0.B): the document does not satisfy the
   *    contract (`lib/replay/replayDocumentSchema.ts`, validated at the transport boundary). The
   *    second argument is the FIRST violation, including its path — a badge that only said
   *    "invalid" would force reopening devtools just to find out what. The DETAIL itself is said
   *    by the three `contract*` entries below, one per kind of violation (`ReplayContractIssue`):
   *    the schema module returns DATA, never a sentence — a sentence built there would not pass
   *    through any language table, and that is exactly the defect round 2 of review found
   *    (an FR fragment in the middle of an EN sentence). `contractInvalidFieldFmt` receives
   *    zod's own text, in English and NOT translated: it is an admin-facing technical
   *    diagnostic, not a product sentence.
   */
  schemaBadgeUpToDateFmt: (schemaVersion: number) => string
  schemaBadgeStaleFmt: (schemaVersion: number, latestSchemaVersion: number) => string
  schemaBadgeStaleNoTargetFmt: (schemaVersion: number) => string
  schemaBadgeStalePublicationFmt: (schemaVersion: number, latestSchemaVersion: number) => string
  schemaBadgeUnknownFmt: (schemaVersion: number) => string
  schemaBadgeInvalidFmt: (schemaVersion: number, detail: string) => string
  contractUnknownKeysFmt: (keys: string) => string
  contractInvalidFieldFmt: (path: string, detail: string) => string
  contractMalformed: string
  /**
   * THE OFF-SCREEN ARROW LABEL (off-screen squad marker plan, workstream B, decision D2,
   * 2026-09-10): the player's name (or the objective carrier's) AND the distance to their real
   * position, off the visible frame at a tight zoom (2x/3x). The meter symbol ("m") is
   * IDENTICAL in French and English — it is not an anglicism to translate — but the
   * composition still goes through this contract to keep type parity (CLAUDE.md rule #1: every
   * UI string in both FR AND EN).
   */
  offscreenMarkerFmt: (name: string, meters: number) => string
  /**
   * THE SAME LABEL, FOR SEVERAL OCCUPANTS WITH NO NAMED DRIVER (batch 4.4, off-screen vehicle,
   * 2026-09-10): a multi-occupant vehicle where no single name can carry the label alone (cf.
   * `vehiclesPaint.vehicleOffscreenText`) shows a COUNT instead of a name.
   */
  offscreenGroupMarkerFmt: (count: number, meters: number) => string
  /**
   * "MOMENT NOT ANCHORED" NOTICE: a tactical link asked for a moment on the MATCH clock, but
   * this match's artifact has no film origin (`matchClock` returns `null`). The replay still
   * opens, at the START — never on an approximate jump presented as exact.
   * Cf. `lib/replay/replayLogic.resolveTacticalOpenAtFrame`.
   */
  openAtNoOriginTitle: string
  openAtNoOriginDescription: string
  speed: string
  time: string
  /**
   * THE SCRUB BAR'S SKIP BUTTONS (board 2a, 2026-08-28): the label CARRIES THE DURATION instead
   * of repeating it next to the button — the icon says the direction, the accessible name says
   * how much. The value comes from `SKIP_SECONDS` (replayCanvasConfig.ts): changing the
   * convention in one place changes both labels.
   */
  skipBackFmt: (seconds: number) => string
  skipForwardFmt: (seconds: number) => string
  /**
   * THE TWO NOTES IN THE SPEED MENU. `speedNormal` marks the reference speed (the question is
   * "how do I get back to normal?", not "what is 1x"). `speedMuted` marks the speeds where sound
   * goes silent — the menu only puts it on the speeds that `soundPlaysAtSpeed`
   * (replaySoundCursor.ts) rejects, so the threshold is not written anywhere in the text: it
   * shows up on the entries that carry the note.
   */
  speedNormal: string
  speedMuted: string
  /**
   * THE NAME OF THE SPACE BAR, and it is the ONLY player key that gets translated. The other
   * key hints — R, M, ←, → — are physical keys: their name is the glyph printed on them, the
   * same in both languages. "Space" is not; hardcoding it would have left a French word in an
   * English interface.
   */
  keySpace: string
  /** Kill feed synced to the replay clock. */
  killFeedTitle: string
  killFeedEmpty: string
  killFeedUnknownWeapon: string
  killFeedNoAssistHint: string
  killFeedAssistHint: string
  killFeedKillerShare: (pct: number) => string
  /**
   * ASSIST IS A PICTOGRAM, NOT A WORD (user decision from 8/16): the feed no longer writes
   * "assisted by", it places a mark then the name. This label is what the mark SAYS (tooltip +
   * screen reader) — it does not read on its own.
   */
  killFeedAssistMark: string
  /** The assister's share of participation, as the line writes it: "37%". */
  killFeedAssistShare: (pct: number) => string
  /** NEUTRAL death line (suicide, fall, out-of-bounds): the displayed word and its tooltip. */
  killFeedDeathLabel: string
  killFeedDeathHint: string
  /**
   * The TYPE of a neutral death, when the film establishes it. Keys = the stable identifiers
   * published by the document (`kind`) — an unknown type has no label and shows no icon, the
   * line keeps its neutral marker.
   */
  killFeedDeathKind: Record<'environment' | 'suicide', string>
  /**
   * JOIN/LEAVE lines in the feed (presenceFeed.ts, 2026-09-02). ONE SET of labels ("joined /
   * left the game"), two tooltips depending on the source: API PARTICIPATION (joined /
   * left_in_progress flags, precise) and the FALLBACK derived from the film's life-span bounds
   * (matches without those columns), whose tooltip carries the caveat: the film cannot tell a
   * departure from a final elimination in a round-based mode.
   */
  presenceJoined: string
  presenceLeft: string
  presenceJoinedHint: string
  presenceLeftHint: string
  presenceJoinedDerivedHint: string
  presenceLeftDerivedHint: string
  /** Replay sounds (batch 5 parity): OFF BY DEFAULT, the user turns it on. */
  sound: string
  soundHint: string
  soundVolume: string
  /**
   * THE VOLUME SLIDER WHEN SOUND IS MUTED (user request from 2026-08-25: "muting the sound
   * should no longer make the volume bar disappear"). The slider STAYS, at zero and inert; this
   * text is what keeps it from reading as a broken control — it states the state (zero) AND
   * what unmuting will do (the set level comes back, it is not lost).
   */
  soundVolumeMutedHint: string
  /** Sound is on but silenced by playback speed — say it, don't hide it. */
  soundFastHint: string
  /** Sound filter by category (settings drawer, phase 2, decision from 8/16). */
  soundCategoriesTitle: string
  soundCategory: Record<'weapon' | 'grenade' | 'melee' | 'equipment' | 'announcer', string>
  /**
   * THE SCREENSHOT BUTTON (2026-08-26): an icon button in the playback bar that downloads the
   * current scene as a PNG. The label states the ACTION, not the technique — "PNG", "export" or
   * "canvas" mean nothing to someone watching a match.
   *
   * NO SEPARATE TOOLTIP: what the command does fits in its name, and an explanatory sentence
   * under such an obvious button would be noise. The record button, by contrast, has one —
   * because ITS behavior is the one that surprises.
   */
  captureImage: string
  /**
   * VIDEO RECORDING (2026-08-26): a stateful button, like play/pause — the accessible name
   * states what the CLICK will do, not where things currently stand.
   */
  recordVideo: string
  stopRecording: string
  /**
   * THE BUTTON'S TOOLTIP, and it carries two facts that SURPRISE (decisions 3 and 4):
   *
   *  1. it films the screen exactly as it plays — changing speed or scrubbing the cursor
   *     during recording SHOWS UP in the file;
   *  2. pausing, or letting the film finish, stops the recording AND downloads it.
   *
   * Without this sentence, the second point gets discovered by losing a clip believed to still
   * be running. The button's own name stays in `recordVideo`/`stopRecording`: this tooltip
   * explains the BEHAVIOR, it does not duplicate the label (same split as `sound` / `soundHint`).
   */
  recordHint: string
  /**
   * THE OUTPUT CHIPS (board 2a, 2026-08-28): the three commands now carry a SHORT TEXT next to
   * their icon. It does not replace the accessible name — `captureImage`, `recordVideo` and
   * `stopRecording` stay as the aria-label, and those are what a screen reader announces. This
   * word is what the EYE reads without hovering: three silent icons side by side all look alike,
   * one word tells them apart instantly.
   */
  /** The settings drawer (user decision from 8/16): button and panel share the same title —
   *  opening it says what's behind it. */
  settingsButton: string
  settingsClose: string
  /**
   * FULLSCREEN MODE (playback bar button, key F): a stateful button, like play/pause — the
   * accessible name states what the CLICK will do. The tooltip adds the shortcut in
   * parentheses, like the bar's other commands.
   */
  fullscreenEnter: string
  fullscreenExit: string
  wideMode: string
  /** Layers the viewer can turn off. */
  layers: string
  layerAim: string
  layerAimHint: string
  /** Named zones (official callouts): layer + card label. */
  zoomGroup: string
  zoomIn: string
  zoomOut: string
  zoomReset: string
  /** "All" at 1x, otherwise the factor — cf. ReplayZoomControl. */
  zoomLevelFmt: (zoom: number) => string
  panUp: string
  panDown: string
  panLeft: string
  panRight: string
  layerGroupPlayers: string
  layerGroupTerrain: string
  layerGroupObjectives: string
  layerZones: string
  layerZonesHint: string
  /** Player names under their marker (a layer that can be turned off — a 24-player BTB). */
  /**
   * TRAIL behind each marker (V1, user feedback from 2026-08-18: "make the trail optional").
   * ON BY DEFAULT: it is what shows the DIRECTION of a movement, and the 8/16 verdict on the
   * marker counted it toward "Perfect".
   */
  layerTrail: string
  layerTrailHint: string
  /**
   * EVENT EFFECTS, toggleable separately (user decision from 8/16): the muzzle flash of EVERY
   * shot, and the killer-to-victim line for eliminations. The first one says what it draws
   * (a shot that deals damage), never what it does not draw.
   */
  effects: string
  layerShotFx: string
  layerShotFxHint: string
  layerShotFxCoverage: string
  layerKillFx: string
  layerKillFxHint: string
  /**
   * EQUIPMENT PLACEMENTS (schema 10): the layer, its toggle for unidentified objects, and the
   * NAMES of the families the layer can draw. The keys of `placementFamily` are RENDER RULES
   * (`PlacementKind`), not document families: two families that shared a drawing would share
   * its label, and a family the layer does not draw needs no name at all — it has no tooltip.
   *
   * The names of the three families added on 2026-08-18 come from the title's manifest
   * (`replay_labels.toml`, `[ability_palettes.ranks]`), the same source as the feed and the
   * cards: "threat seeker" (rank 12), "repair field" (rank 23), "quantum translocator"
   * (rank 11), whose BEACON is the placed object.
   *
   * THE `unnamed` RULE IS NOT IN THIS LIST: it is the server's default, drawn as a neutral dot
   * and named by `placementUnnamedLabel`. The `placementFamily.guard.test.ts` guard keeps this
   * list aligned with `PLACEMENT_RENDER` (layer) and `equipmentFamilies` (Go).
   */
  layerPlacements: string
  layerPlacementsHint: string
  /**
   * DROPPED POWER ITEMS (product decision from 2026-08-18). The command appears as soon as the
   * film carries any, in ALL modes — the "non-Fiesta only" restriction was lifted on 2026-08-20.
   * Its label therefore still doesn't need to mention Fiesta, and for an even simpler reason
   * now: the mode no longer enters into the rule at all.
   */
  layerPlacementsDropped: string
  layerPlacementsDroppedHint: string
  layerPlacementsUnnamed: string
  layerPlacementsUnnamedHint: string
  placementFamily: Record<'wall' | 'sensor' | 'rift' | 'shroud' | 'seeker' | 'field', string>
  /** What the neutral dot says for an object whose nature is not established. */
  placementUnnamedLabel: string
  /** "placed by <player>" tooltip line; the placer is a MEASUREMENT (proximity). */
  placementOwnerFmt: (name: string) => string
  /**
   * THE TOOLTIP OF A DROPPED ITEM: what it is, who dropped it, and at what moment of the replay.
   *
   * `placementDroppedOwnerFmt` replaces "placed by": the action is not the same, and writing
   * "placed" for an item that fell off a corpse would be wrong. `placementDroppedAtFmt` receives
   * an already-formatted clock (`m:ss`) — a MOMENT, never an elapsed duration.
   */
  placementDroppedLabel: string
  placementDroppedOwnerFmt: (name: string) => string
  placementDroppedAtFmt: (clock: string) => string
  /**
   * WEAPON PADS (schema 11): the layer, its three states, its countdown, and its cycle.
   *
   * THE THREE STATES ARE NOT EQUIVALENT, and the labels must say so: "Available" is a PROVEN
   * presence, "Taken" a PROVEN absence, "Uncertain" the ~20s window between the two that the
   * film cannot date. None of these labels names a player: the picker is not SHOWN
   * (`padPickups[].xuid` has been published since schema 30; this screen does not use it), and
   * no line on screen should imply it is known.
   *
   * NEITHER MEDIAN NOR SPREAD ON SCREEN (verdict from 2026-08-18): the measured cycle now only
   * serves to DATE the countdown, it is no longer displayed. `padCycleFmt` was therefore removed
   * along with its tooltip line — text no screen renders is dead code (CLAUDE.md #7).
   */
  layerWeaponPads: string
  layerWeaponPadsHint: string
  /**
   * CTF FLAGS (schema 15): the layer and its tooltip. Title in the PLURAL — a capture match
   * carries two, and it is their opposition that matters.
   *
   * THE SIDE IS SAID AS "ally" / "enemy", never by a color or team name: the page only knows the
   * viewed player's point of view (replay accessibility), and a film missing the "me" line has
   * NO ally side at all — hence the third key, which only names the object.
   *
   * THE "carried, end not dated" STATE CARRIES ITS CAVEAT IN ITS LABEL, and `flagOpenNote`
   * expands on it: the interval runs to the end of the film, it is an UPPER BOUND. A dimmed icon
   * alone would read as a style effect.
   */
  /**
   * MODE OBJECTIVES (2026-09-18): the static layer of the objective's terrain — hills, bases,
   * capture zones, pads and delivery points — and its help text, which explains the RINGS and
   * floor OUTLINES (the same language as the markers). First in the group.
   */
  layerModeObjectives: string
  layerModeObjectivesHint: string
  layerFlagCarries: string
  layerFlagCarriesHint: string
  flagSide: Record<'ally' | 'enemy' | 'unknown', string>
  flagState: Record<'carried' | 'carried_open' | 'dropped' | 'home', string>
  /** The carrier the dashboard does not name — never a raw identifier on screen. */
  flagCarrierUnknown: string
  /** How long the current state has lasted (tooltip). */
  flagSinceFmt: (seconds: number) => string
  /** The caveat for `carried_open`, spelled out. */
  flagOpenNote: string
  /**
   * THE RETURN GAUGE for a flag on the ground (schema 63), as a fraction [0, 1] — it is a
   * FILL, never a countdown: the rate follows a harmonic series and the gauge empties once
   * nobody is left in the zone.
   */
  flagReturnFmt: (progress: number) => string
  /** THE VIP CROWN (schema 22): the layer name and its caveat, identical in both FR/EN ("VIP"). */
  layerVipCrown: string
  layerVipCrownHint: string
  /** THE ODDBALL SKULL CARRIER (schema 23): the layer name and its caveat. */
  layerSkullCarrier: string
  layerSkullCarrierHint: string
  /**
   * THE ASSAULT BOMB (schema 30): the layer name and its caveat — carried it follows its
   * carrier, dropped it stays at the dropper's last point until it's picked up again or
   * explodes.
   */
  layerBombCarrier: string
  layerBombCarrierHint: string
  /**
   * GROUND WEAPONS (schema 27): the layer name and its caveat.
   *
   * THE CAVEAT IS THE POINT, not decoration: this layer shows items whose disappearance is NOT
   * always dated. The caveat must spell out what the fade-out means — otherwise it reads as a
   * style effect, exactly the flaw `flagOpenNote` fixes for open carries.
   */
  layerGroundWeapons: string
  layerGroundWeaponsHint: string
  /**
   * THE "SPECIAL WEAPONS ONLY" FILTER for the ground weapons layer. Sniper, power, special:
   * what a pad distributes and that an opponent has an incentive to pick up — 17.4% of items on
   * the ground, but 65.3% of OBSERVED pickups. A child toggle of the layer, like the unidentified
   * objects toggle for equipment placements: it only shows up with its layer.
   */
  layerGroundWeaponsSpecialOnly: string
  layerGroundWeaponsSpecialOnlyHint: string
  layerGroundWeaponsStarting: string
  layerGroundWeaponsStartingHint: string
  /**
   * THE TOOLTIP FOR A GROUND WEAPON (batch 6.5, 2026-09-10): ONE LINE, never two — the same
   * mechanic as the three nearby hoverable layers (placements, pads, flags). The action reads
   * "<weapon> · dropped by X", then "· picked up by Y" if a picker is measured.
   *
   * A `spawned` WEAPON (abandoned starting weapon, weapon ejected from a rack) has NO measured
   * dropper: the channel NEVER names one for this origin (measured over the dataset, report
   * §2.2: a known `dropper` is EXACTLY equivalent to `origin == "dropped"`, 9,794 = 9,794 over
   * 61 arena films) — it is said to have "appeared", with no invented dropper.
   *
   * "UNNAMED PLAYER" RATHER THAN SILENCE: 20.9% of `dropped` droppers do not resolve to a player
   * via `identity.bipedSlots` (measured, report §2.5) — the line SAYS so instead of vanishing,
   * which would suggest no weapon is ever dropped by anyone. Same caveat, separately, on the
   * picker side (0.3% unresolved).
   */
  groundWeaponSpawned: string
  groundWeaponDroppedByFmt: (name: string) => string
  groundWeaponDropperUnknown: string
  groundWeaponPickedByFmt: (name: string) => string
  groundWeaponPickerUnknown: string
  /**
   * AMMO FOR A DROPPED WEAPON (batch 6.6, 2026-09-10) — AND WHY IT IS DATED.
   *
   * The number is NOT the number at the moment it was dropped: ammo is not carried on the item
   * (measured for this batch: 0 matches out of 1,524 comparisons for the creation record's
   * magazine list, 10 out of 6,477 for the nearby R(7)). What is shown is the DROPPER's last
   * inventory read before the drop, taken at keyframes, lagging by a median of 9.0s and a 90th
   * percentile of 18.0s.
   *
   * BOTH STRINGS THEREFORE CARRY THE "≈" AND THE AGE, AND THAT IS NON-NEGOTIABLE: without them,
   * the reader would believe they're seeing the weapon's state at the moment it fell — exactly
   * the window during which the carrier was shooting. The second form is used when the film also
   * writes the reserve ammo; a missing reserve is not a zero (cf. `AmmoSlot`).
   */
  groundWeaponAmmoFmt: (mag: number, age: string) => string
  groundWeaponAmmoResFmt: (mag: number, res: number, age: string) => string
  /**
   * THE EXACT FORM (batch 6.10, 2026-09-11): the magazine and reserve as READ ON THE ITEM, in
   * its creation record — that is, at the exact moment of the drop.
   *
   * IT CARRIES NEITHER "≈" NOR AN AGE, AND THAT IS THE ONLY DIFFERENCE THAT MATTERS versus the
   * two forms above. Adding them here would pass off a measurement as an estimate; removing them
   * from the other two would pass off an estimate as a measurement. All three strings therefore
   * live together, and `groundWeaponAmmoLine` picks based on the nature of the reading, never on
   * the caller's preference.
   */
  groundWeaponAmmoExactFmt: (mag: number, res: number) => string
  /**
   * VEHICLES (schema 29): the layer name and its caveat.
   *
   * THE CAVEAT STATES THE END OF LIFE, and that is the easiest point to get wrong: a sprite
   * disappearing is NOT a destruction — the film does not date any destruction (measured and
   * disproved, `V3_DESTRUCTION_DATEE_2026-09-02.md`). The layer stops drawing a vehicle at its
   * last proof of presence, never at the moment it explodes.
   */
  layerVehicles: string
  layerVehiclesHint: string
  /**
   * THE NAME OF A PAD THAT DOES NOT HOLD A WEAPON (schema 17). The keys are the equipment
   * families published by the document (`weaponPads[].weapon`), enumerated one by one in
   * `weaponPadFamilies.ts` — hence the typing: a family added there with no label here fails to
   * compile, in EITHER language.
   *
   * WHY THESE LABELS ARE LOCAL AND NOT SERVED BY THE DOCUMENT: the title's manifest
   * (`replay_labels.toml`) only carries, on its `[[equipment_objects]]`, the identity (family,
   * origin, nature) — no bilingual label, no icon — and no channel in the document carries an
   * equipment label to the client (there is no `equipmentLabels`). The names of the DRAWN
   * families already live here, in `placementFamily`: these ones join them, with the same words
   * as the game.
   */
  padEquipmentFamily: Record<PadEquipmentFamilyKey, string>
  /** COMPACT countdown, the card's own ("12s") — it does not say its source. */
  padCountdownFmt: (seconds: number) => string
  /**
   * THE TWO TOOLTIP COUNTDOWNS, and their difference is the only thing that matters (D3,
   * 2026-08-27): `Measured` targets the next appearance SEEN in the film — the replay knows what
   * happens next, the number is EXACT and does not need to carry a "≈"; `Expected` targets what
   * the CYCLE predicts, for the last gap no appearance closes, and keeps its caveat.
   *
   * TWO KEYS RATHER THAN ONE FLAG IN A SINGLE SENTENCE: the two languages do not insert the
   * caveat at the same spot, and a fill-in-the-blank sentence would have frozen on French word
   * order.
   *
   * NO EXPLANATORY PARENTHESIS SINCE 2026-08-28 ("I don't want blah-blah inside it"): the
   * number's source already fits in the "≈", and the tooltip now carries only two lines.
   */
  padRespawnMeasuredFmt: (seconds: number) => string
  padRespawnExpectedFmt: (seconds: number) => string
  /**
   * THE TOOLTIP FOR A VEHICLE SPAWN SLOT (schema 63, batch 5.8).
   *
   * FOUR KEYS FOR THREE LINES, and the countdown is not one of them: it is the pads' own
   * (`padRespawnMeasuredFmt` / `padRespawnExpectedFmt`), because it is the SAME question with the
   * same caveat. A fifth label would have said the same sentence twice in two places, with two
   * translations to keep in sync.
   *
   * `vehicleCycleTitle` is the NAME fallback: the dominant family is published in the clear when
   * the chassis table names one (`vehicleLabels[family]`), and this generic title is used when
   * the slot only has its cycle. Never a neighboring family's name.
   *
   * `vehicleCycleFmt` states the median AND the deciles together: they are two numbers from the
   * same measurement, and splitting them into two lines would make the interval read as a
   * second quantity. `vehicleCycleGapsFmt` states HOW MANY cycles the measurement rests on —
   * that is the caveat, and it belongs here (a tooltip is the place for analysis readings), not
   * on the card.
   *
   * `vehicleCycleOccupied` answers the only question hovering an OCCUPIED slot raises: "why is
   * there no count". Because a vehicle is there, and the game clock for it only resumes once it
   * is destroyed.
   */
  vehicleCycleTitle: string
  vehicleCycleFmt: (medianS: number, p10S: number, p90S: number) => string
  vehicleCycleGapsFmt: (gaps: number) => string
  vehicleCycleOccupied: string
  /**
   * Heatmap: the layer, what it measures, and its legend. NEVER "heatmap" on screen (FR
   * no-anglicisms rule) — "carte de chaleur" everywhere [on the French side].
   */
  layerHeatmap: string
  layerHeatmapHint: string
  heatmapReading: string
  heatmapMode: Record<'presence' | 'kills', string>
  heatmapModeHint: Record<'presence' | 'kills', string>
  /**
   * TIME SPAN of the heatmap (V2, 2026-08-18): the whole match — the post-match analysis
   * reading, and the default — or up to the current frame, the heatmap filling in alongside the
   * replay.
   */
  heatmapSpanTitle: string
  heatmapSpan: Record<'match' | 'live', string>
  heatmapSpanHint: Record<'match' | 'live', string>
  /**
   * PLAYER DOT COLORS (drawer option, 2026-08-24): by team — the default, the color states the
   * side (D1) — or distinct per player, to track someone in the chaos. The hints state what each
   * reading keeps and what it changes.
   */
  markerColorsTitle: string
  markerColorsMode: Record<'team' | 'player', string>
  markerColorsHint: Record<'team' | 'player', string>
  /** Legend endpoints: they name the QUANTITY, the title says what it is about. */
  heatLegendLow: string
  heatLegendHigh: string
  heatLegendHint: string
  /** Player cards: what is read, and what is not. */
  rosterEmpty: string
  /**
   * The two tiles for a seat WITH NO CARD (seat rules, batch M2.4, 2026-09-23): `seatVacant` is
   * what a seat nobody holds shows (Q20 — it stays visible, empty, until the replacement
   * arrives; no name: a player who left is never shown); `seatNotSpawned` is what, under its
   * name, an occupant who holds their seat without having spawned yet shows (Q21). Both `*Hint`
   * are their accessible descriptions: what the tile SAYS, not what it shows.
   */
  seatVacant: string
  seatVacantHint: string
  seatNotSpawned: string
  seatNotSpawnedHint: string
  bridgeDiag: (named: number, total: number, collisions: number) => string
  /**
   * Team label (cascade `lib/halo/teamLabel.ts`, same texts as Match View). NO "unknown team"
   * here: on the Replay page, a side is always a film designator, and its floor is
   * `teamNumberedFmt` (`resolveKnownTeamLabel`, decision from 2026-10-06).
   */
  teamLabelFmt: (name: string) => string
  teamNumberedFmt: (n: number) => string
  /**
   * THE PERSONAL SCORE AT THE CURRENT READING (schema 12) — the one on the player's card. It is
   * NOT the final score: it ticks along with playback. The TEAM score, by contrast, only lives in
   * the banner now (the column-header numbers are gone since 2026-08-24).
   */
  playerScoreLive: string
  /** Kills / deaths / assists: two measures that are never conflated. */
  countersLive: string
  countersMatch: string
  /**
   * The FDA for the displayed triplet — the canonical net (kills + assists/3 − deaths, cf.
   * `lib/fda.ts`). The triplet's colored background states it at a glance; the tooltip states it
   * in full, because a color alone is not a measurement.
   */
  fdaTooltipFmt: (counters: string, fda: string) => string
  /**
   * THE SCORE BANNER above the map: two side bars framing the playback clock. Both sides are
   * named by their RELATION to the page's own player (ally / enemy), not by their team name,
   * which already heads the card columns — the banner states a matchup, the column states an
   * identity.
   *
   * `roundNumberFmt` is the round number alone, shown under the clock; `roundOfCountFmt` places
   * it within the match for the tooltip. Neither carries a value: between two bars, a number
   * with no side would not attach to anyone.
   */
  scoreBannerLabel: string
  scoreBannerAlly: string
  scoreBannerEnemy: string
  scoreBannerClock: string
  /**
   * THE 3D HUD'S ELIMINATION POPUP (first-person view): the line under the medals for the
   * watched player's kill, naming their victim. The register is the HUD's own, not the feed's —
   * "Eliminated:" rather than "Killed".
   */
  killPopupVictimFmt: (name: string) => string
  /**
   * Hill HOLD progress (KOTH): the label for a meter, not a number. It names the quantity —
   * without it, a screen reader would announce a second percentage without saying what it is,
   * next to the score's own.
   */
  hillHoldAlly: string
  hillHoldEnemy: string
  roundNumberFmt: (index: number) => string
  roundOfCountFmt: (index: number, count: number) => string
  /**
   * ROUND DOTS, above the score (Oddball and every multi-round mode). One SHARED row, one dot
   * per round played, tinted to the winning side once the round is decided — filled = won,
   * empty = in progress or yet to play. `roundDotsLabel` names the row for screen readers; the
   * three formatters state each dot's state (the eye reads the color, the screen reader reads
   * the word). The side is named by its RELATION to the page's own player (ally / enemy), like
   * the banner — never by a color or a team name.
   */
  roundDotsLabel: string
  /**
   * THE ROUND COUNT WRITTEN OUT, next to the round number under the clock (user call from
   * 2026-08-29). The dots already say it to the eye; this label says it to the screen reader and
   * to anyone who miscounts dots. Always "ally - enemy", the banner's own order. It reads AT THE
   * CURRENT FRAME, like the dots: it is a RUNNING count, not the match's final verdict (that one
   * comes from the API, on the end screen).
   */
  roundDotAllyFmt: (index: number) => string
  roundDotEnemyFmt: (index: number) => string
  roundDotPendingFmt: (index: number) => string
  /**
   * THE BETWEEN-ROUNDS MESSAGE: brief and non-blocking, it appears at the transition from one
   * round to the next and states the round that just ENDED. Derived from the playback position
   * like the end screen — visible in a short window around the transition, it replays if you
   * scrub back over it. It is also the trigger point for the "round over" sound.
   */
  roundOverFmt: (index: number) => string
  /**
   * THE BOMB COUNTDOWN (Assault, schema 29): the banner shown while the fuse is running, from
   * arming to detonation. `remaining` arrives already formatted (`formatSeconds`, "4.9s") — the
   * text only states the fact: the bomb is armed, this much time is left.
   */
  bombArmedFmt: (remaining: string) => string
  /**
   * THE MATCH-END SCREEN, at the moment playback reaches the declared end.
   *
   * THERE IS NO TITLE KEY HERE, AND THAT IS INTENTIONAL (user amendment from 2026-08-26): the
   * title is the outcome's canonical label, published by the title's own `outcomes.toml` via
   * `/field-mappings` and already localized ("Victory" / "Defeat" / "Tie"). Building it a second
   * time here would mean two words for the same verdict across two pages of the same match —
   * exactly what the reuse rule exists to prevent. Only the texts SPECIFIC to this screen remain
   * here.
   *
   * `victoryPanelLabel` names the region for screen readers. The panel appears WITHOUT a user
   * gesture (playback simply reaches the end): without a region name, the `aria-live` announcement
   * would fall on deaf ears.
   *
   * `victoryScoreLabel` names the FINAL score line — the one at the end of the match, not the
   * one at the current frame: the banner above already states the latter, and the two look too
   * similar to sit anonymously next to each other.
   */
  victoryPanelLabel: string
  victoryScoreLabel: string
  /**
   * THE FOUR TIMELINE TRACKS (board 2a, 2026-08-28). The first three name what's read under the
   * cursor: the watched player's kills and deaths, their teammates' kills, and who was leading at
   * that moment. These are ROW LABELS, not titles — hence single words, sized for a timeline only
   * a few pixels tall.
   *
   * `trackYou` ("You") WAS REMOVED ON 2026-09-07 (batch L3): the first row no longer carries a
   * label but the VIEWPOINT MENU, whose visible text is the chosen gamertag. The word "You" would
   * be wrong the moment you watch someone else, and the control is now named by `viewpointLabel`.
   * The key was removed rather than kept "just in case" (repo rule #7) — a string with no reader
   * is dead text that both tables would then have to keep in sync for no reason.
   *
   * `trackTeammates` replaces `trackAllies` on 2026-09-07 (decision 5 of the "timeline, viewpoint"
   * plan): the track used to show players marked as FRIENDS — including ones on the enemy team —
   * and now shows the viewpoint's own TEAMMATES. Two different populations, two different words;
   * keeping "Allies" would have left the screen's own text inverted from reality.
   *
   * `dominanceOfFmt` dates a dominance band in its tooltip: the team is named via the scoreboard's
   * own cascade (`labelOf`), the same one used by the columns and the banner. It states it IN
   * KILLS since 2026-08-28: the track no longer reads the mode's own counter (captures, ball
   * seconds) but each side's kill count — "leads" on its own would suggest the scoreboard's score.
   *
   * `dominanceTied` names the TIE band (the `outcome-draw` color), which is the state at kickoff
   * and at every return to parity: without it, the blue band would be the only one on the track
   * whose hover says nothing.
   */
  trackTeammates: string
  trackDominance: string
  /**
   * THE VIEWPOINT MENU (2026-09-07, batch L3), in place of the first track's label.
   *
   * `viewpointLabel` is the control's ACCESSIBLE NAME: "Followed player", not "You". The menu's
   * visible text is a gamertag, which does not say what it is the answer to — without this name,
   * a screen reader would announce an anonymous dropdown in the middle of a timeline.
   *
   * The menu's sections are the film's SIDES, named like the card columns: no "no team" section
   * (decision from 2026-10-06).
   *
   * `viewpointNoData` is the tooltip for INERT options (decision 7b): a player with no scoreboard
   * row stays on the side the film assigns them, but their track would be empty no matter what.
   * The menu says so instead of letting you click a choice with no effect.
   */
  viewpointLabel: string
  viewpointNoData: string
  dominanceOfFmt: (team: string) => string
  dominanceTied: string
  /**
   * THE SCORE TRACK (2026-08-28): the same reading as dominance, but on the MODE's own counter.
   * It does not appear in Slayer, where the score IS the kill count — hence three twin, separate
   * strings: "leads in kills" and "leads in score" are two different claims, and merging them
   * into one ("leads") would make the two rows indistinguishable on hover, exactly where they are
   * meant to be compared.
   *
   * This track's round separators reuse `roundOverFmt` — the same word as the between-rounds
   * screen, for the same thing.
   */
  trackScore: string
  scoreOfFmt: (team: string) => string
  scoreTied: string
  /**
   * THE MEDIA TRACK, its EMPTY state, and the lightbox that opens a piece of media.
   *
   * THE DATA ARRIVED on 2026-08-28 (phase 2: the match's media tab, aligned to the replay's own
   * axis): "no media" stays an honest state, but it is now a fact ABOUT THE MATCH rather than
   * waiting on a source. `mediaPausedHint` is the lightbox's own chip: opening a piece of media
   * pauses the replay, and without this word a reader closing it would not know why the film
   * didn't advance.
   *
   * THE TWO PLAYBACK FAILURES ARE DISTINCT, and the viewer cannot do the same thing about either:
   * a browser without HLS will NEVER play that clip (something has to change), while a stream in
   * error can be retried. A single message would conflate them.
   */
  mediaTrack: string
  mediaEmpty: string
  mediaOpen: string
  mediaClose: string
  mediaPausedHint: string
  mediaHlsUnsupported: string
  mediaHlsError: string
  /**
   * TIMELINE COLLAPSE (user feedback from 2026-08-28). Both labels carry the OFFERED ACTION, not
   * the current state: it is what clicking will trigger, following the usual naming convention
   * for accessible command names. The state itself is read from `aria-expanded`.
   */
  tracksCollapse: string
  tracksExpand: string
  unknownPlayer: string
  /**
   * `markMe` — the last textual remnant of the feed's identity glyphs. The active player's own
   * dot has not been drawn anywhere since 2026-08-24; the "friend" glyph that remained in the feed
   * (formerly `PlayerMark.tsx`) was removed in turn on 2026-09-02 (decision D5) — its key
   * `markFriend` went with it. `markMe` now only serves the screen-reader label for the page's own
   * player (removing a drawing should not remove information).
   */
  markMe: string
  healthLabel: string
  shieldLabel: string
  abilityLabel: string
  loadoutAge: string
  /**
   * SOURCE of a weapon reading taken at the body's CREATION (`loadouts[].src === 'birth'`,
   * schema 69): the tooltip states it before the age — a birth loadout is not a keyframe, and the
   * reader should know where what they're seeing came from.
   */
  loadoutBirth: string
  loadoutAhead: string
  weaponSecondaryHint: string
  /**
   * COMPACT TILE OVERFLOW (compact cards plan 2026-09-06, I9): what leaves the tile moves to the
   * tooltip WITH ITS VALUE. `weaponStowedFmt` names the stowed weapon (the second weapon cell no
   * longer exists); `playerScoreLiveFmt` carries the personal score at the current reading (the
   * score cell no longer exists); `ammoHintFmt` states the ammo in hand — count, remaining
   * charge, or full. Nothing is composed when nothing is in hand (D=2): the caller
   * (`model/handCellHint.ts`) simply does not call it.
   */
  weaponStowedFmt: (name: string) => string
  playerScoreLiveFmt: (score: number) => string
  ammoHintFmt: (ammo: AmmoHint) => string
  /** Throw badge on the card (the POC's `.gic`): the thrower is written in the film. */
  grenadeThrown: string
  /** The dead-card box (option 2a): the state word, then the countdown read from the film. */
  eliminatedLabel: string
  respawnIn: string
  goneLabel: string
  goneValue: string
  /** Inventory line: grenades, ability, ammo. */
  inventoryAge: string
  inventoryAhead: string
  grenadeSelected: string
  grenadeSelectedRead: string
  grenadeSelUnknown: string
  /**
   * AGE SPECIFIC TO THE GRENADE BOX (schema 20): the `grenadeReads` axis does not land on
   * inventory keyframes, so the box cannot borrow the row's own age. A negative age is a FUTURE
   * reading and is stated as such — never disguised as past.
   */
  grenadeAge: string
  grenadeAhead: string
  /**
   * Ability missing from the title's table: the card places a NEUTRAL GLYPH (not a character,
   * user decision from 8/16) and states in the tooltip what is not known — the RANK read stays
   * written, because it is the one true fact available here.
   */
  abilityUnidentified: (rank: number) => string
  abilityAge: string
  abilityAhead: string
  /**
   * CHARGES FOR THE CARRIED ABILITY (enriched schema 38, batch P6): the count from the most
   * recent reading for the same life and the same equipment — and a QUALITATIVE "FULL" before the
   * first reading (user decision from 9/4): the film transmits NOTHING at pickup, a number would
   * be invented. A family the channel does not measure shows nothing at all — neither a count nor
   * "full" (cf. `abilityChargeLogic.ts`).
   */
  abilityChargesFull: string
  abilityChargesFullHint: string
  abilityChargesCount: (n: number) => string
  abilityChargesAge: string
  /**
   * ACTIVE state of a piece of equipment, by measured FAMILY (never a free-text label): camo
   * makes the card glassy, overshield frames it in gold (Notion spec 21.1, rendered by
   * `ReplayTeams.tsx`). The key is the stable identifier published by the document (`fam`) — an
   * unknown family has no label and gets no effect.
   */
  equipmentActive: Record<'camo' | 'overshield', string>
  /**
   * TRANSLOCATOR TRAVEL (measured: two agreeing channels, cf. placementTeleport.ts) — the
   * sentence for the purple-then-orange-yellow flash the card briefly carries after the jump.
   * Outside `equipmentActive` BECAUSE the key is not a document episode family: it is an EVENT
   * reconstructed from the tracks, not a state measured by the episode channel.
   */
  translocationFlash: string
  /** The rift PLACEMENT (riftPoses): the same card flash, its own sentence. */
  translocationPose: string
  /**
   * THE PLAYER IN AN EQUIPMENT ZONE (cf. equipmentZones.ts): the three states the card can state
   * — repair field, shroud screen, enemy sensor. The keys are the layer's own RENDER RULES
   * (`PlacementKind`), the same convention as `placementFamily` above: the card's zone and the
   * map's disc are the same object.
   */
  zonePresence: Record<'field' | 'shroud' | 'sensor', string>
  /**
   * THE OBJECTIVE CARRIER (cf. objectiveMark.ts): the sentence the card's watermark states in
   * full in its tooltip. The keys are the KINDS OF MARK, never the modes — the same object
   * recurs across modes, and the card does not know the mode.
   *
   * TWO REGIMES IN THE SAME TABLE, AND THE LABELS MUST SAY SO: `flag`, `skull`, `vip` and `hill`
   * are ONGOING states — "carries", "is" — while `zone` and `bomb` are EVENTS held for a few
   * seconds — "just" — because the data only attributes a MOMENT to a player, never the duration
   * of a capture or of carrying the bomb.
   */
  objectiveCarry: Record<'flag' | 'skull' | 'vip' | 'hill' | 'zone' | 'bomb', string>
  /**
   * THE EQUIPMENT USAGE TABLE (match page, Chronology tab). Separate block because these texts
   * do NOT serve the replay itself: they serve its SUMMARY, a different surface.
   */
  equipmentUsage: EquipmentUsageText
  /** "Ammo full" icon (slot never written): product decision 4. */
  ammoFullLabel: string
  ammoDrawnHint: string
  drawnUnknown: string
  /**
   * EMPTY inventory reading (schema 19, `inventory[].empty`). The LABEL is read on screen, the
   * HINT carries the explanation and ends with the age of the EMPTY reading — its own, not the
   * one for the equipment shown next to it: the two readings are not from the same moment, and
   * conflating them would pass off a twenty-second-old state as fresh.
   *
   * TWO STATES, NOT ONE: `dead` is corroborated by the kill feed, `empty` is not. Merging them
   * under one word would assert a death that nothing actually establishes.
   *
   * THE SECOND HALF OF THE TOOLTIP STATES WHAT THE SCREEN SHOWS INSTEAD, and it has TWO forms
   * because there are two situations. `inventoryFallbackHint` (followed by the age of the FULL
   * reading) when an earlier full reading is actually substituted in;
   * `inventoryNoPriorHint` when there is NONE at all — the card then shows no equipment, and
   * promising "the last full reading" would be false.
   */
  inventoryDeadLabel: string
  inventoryDeadHint: string
  inventoryEmptyLabel: string
  inventoryEmptyHint: string
  inventoryFallbackHint: string
  inventoryNoPriorHint: string
  gaugeLabel: string
  /**
   * OFFLINE (NOT REAL-TIME) EXPORT — the command, its dialog, and what it announces while it
   * computes.
   *
   * `exportHint` states the ONE thing that distinguishes this command from the recording it
   * replaces: the file does not cost match playback time. `exportRunningHint` warns that the
   * terrain will scroll very fast on screen — without this, a user would think the replay was
   * running away.
   */
  exportVideo: string
  exportHint: string
  exportDialogTitle: string
  exportFrom: string
  exportTo: string
  exportWithSound: string
  /**
   * FILE FORMAT (2026-09-16): the choice's label, and each option — its short name followed by
   * its dimensions ("1080p (1920 × 1080)"), so you know what you're producing before you produce
   * it. The choice is remembered by the browser.
   */
  exportFormat: string
  exportFormatOptionFmt: (name: string, width: number, height: number) => string
  /**
   * CLIP FRAMING (2026-09-16, decision D6) — offered ONLY on a zoomed map: the whole map
   * (default), or the screen's own framing with its zoom level ("Current framing (2x)").
   */
  exportFraming: string
  exportFramingWhole: string
  exportFramingCurrentFmt: (zoom: number) => string
  exportStart: string
  exportCancel: string
  exportClose: string
  exportRunningHint: string
  /** "Frame 4,200 / 18,000": what the progress bar states in full. */
  exportProgressFmt: (done: number, total: number) => string
  /**
   * "Exported span: 4:32" — the requested MATCH duration, not the file's own: when the span runs
   * to the end, the clip holds its last frame a few extra seconds, long enough to read the
   * verdict and let the sound finish.
   */
  exportLengthFmt: (clock: string) => string
  /** The export FAILED: the dialog states it instead of going silently blank. */
  exportFailed: string
  /**
   * THE PREPARATION PHASE, before the first frame is encoded: fonts, logo, sound decoding,
   * offline mixing, track encoding. It lasts several seconds on a match heavy with sound, and
   * the bar would otherwise sit at zero with no explanation.
   */
  exportPreparing: string
  /** The preparation step while the sound track mixes, with its share done: "Mixing sound… 42%". */
  exportMixingFmt: (pct: number) => string
  /** The next step: the AAC encoding of the mixed tracks, "Encoding sound… 50%". */
  exportSoundEncodingFmt: (pct: number) => string
  /** "~1:20 remaining" — the estimate, absent while it would still be jumping around. */
  exportEtaFmt: (clock: string) => string
  /** "File ready: replay-....mp4" — the end is stated, with the filename, before it downloads. */
  exportDoneFmt: (filename: string) => string
  /** The button that delivers the clip: it starts from a click, not from code. */
  exportSaveVideo: string
  /** Sound was requested, the browser refused it: the clip is silent, and we SAY SO. */
  exportMutedFallback: string
  /** A 3D clip meant for 60 fps that the browser could only encode at `fps`: said, never silent. */
  exportFpsFallbackFmt: (fps: number) => string
  /**
   * THE CLIP'S SOUND TRACK NAMES. They are WRITTEN INTO THE FILE: it is what an editing tool
   * shows in its track list, and the only thing that tells "sfx" apart from "voice" for whoever
   * opens the clip six months later.
   *
   * `exportTrackMix` ALWAYS COMES FIRST: an ordinary player only plays the first track, and a
   * browser doesn't even expose the others.
   */
  exportTrackMix: string
  exportTrackSfx: string
  exportTrackVoice: string
  exportTrackMusic: string
  /**
   * The texture-quality setting (settings drawer, part 2): the VIEWER's choice — Standard
   * (the default) or High — which changes the map and variant files the server serves
   * (`?quality=` parameter), not a display layer. The High label carries the reserve: about
   * 4x graphics memory, and a larger map file built on first use.
   */
  textureQualityTitle: string
  textureQualityStandard: string
  textureQualityHigh: string
  textureQualityHighHint: string
  /**
   * THE MAP BUILD PROGRESS LINE (pre-game and in-viewer quality switch): the server's stage
   * key for each build step, the line the bar says under it (the stage with its percentage),
   * and the estimated time left (present only once the progress is past 5%, from
   * elapsed time over progress). The bar itself fills with the real fraction; nothing in
   * these strings invents a number the server did not report.
   */
  buildStage: Record<'geometry' | 'lighting' | 'writing' | 'textures' | 'compress' | 'weapons' | 'rigs', string>
  buildProgressFmt: (stage: string, pct: number) => string
  buildEtaFmt: (clock: string) => string
}
