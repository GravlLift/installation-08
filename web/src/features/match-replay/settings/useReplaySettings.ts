// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useReplaySettings — DISPLAY preferences of the replay: layers (aim, zones, names, heat
 * map), event effects (shots, deaths) and playback speed. Persisted like the sound
 * (replayPreferences.ts, pattern born in useReplaySound), from the settings drawer
 * (user decision of 08/16).
 *
 * DELIBERATELY SEPARATE FROM useReplaySound: this hook knows NOTHING about sound (neither
 * the track nor Web Audio) — same separation of concerns as the neighboring modules. It only
 * carries the state of the layers and the speed; ReplayCanvas consumes them without knowing
 * they survive the page, ReplaySettingsDrawer displays them without knowing where they live.
 */
import { useCallback, useEffect, useState } from 'react'

/**
 * Standalone port note: `HeatmapMode`/`HeatmapSpan` live in `lib/replay/heatPaint`, the
 * 2D tactical heatmap painter (shared by the 2D replay canvas and the tactical feature) —
 * out of scope for this 3D-only viewer (it is never painted here). Inlined rather than
 * lifting that module and its own dependency chain.
 */
type HeatmapMode = 'presence' | 'kills'
type HeatmapSpan = 'match' | 'live'
import {
  persistPreference,
  readStoredChoice,
  readStoredFlag,
  readStoredNumber,
  subscribePreference,
} from './replayPreferences'

const SHOW_AIM_KEY = 'replay-show-aim'
const SHOW_ZONES_KEY = 'replay-show-zones'
const SHOW_TRAIL_KEY = 'replay-show-trail'
const SPEED_KEY = 'replay-speed'
const SHOW_HEATMAP_KEY = 'replay-show-heatmap'
const HEATMAP_MODE_KEY = 'replay-heatmap-mode'
const HEATMAP_SPAN_KEY = 'replay-heatmap-span'
const SHOW_SHOT_FX_KEY = 'replay-show-shot-fx'
const SHOW_KILL_FX_KEY = 'replay-show-kill-fx'
const SHOW_PLACEMENTS_KEY = 'replay-show-placements'
const SHOW_UNNAMED_PLACEMENTS_KEY = 'replay-show-unnamed-placements'
const SHOW_DROPPED_PLACEMENTS_KEY = 'replay-show-dropped-placements'
const SHOW_WEAPON_PADS_KEY = 'replay-show-weapon-pads'
const SHOW_GROUND_WEAPONS_KEY = 'replay-show-ground-weapons'
const SHOW_GROUND_WEAPONS_SPECIAL_ONLY_KEY = 'replay-show-ground-weapons-special-only'
const SHOW_GROUND_WEAPONS_STARTING_KEY = 'replay-show-ground-weapons-starting'
const SHOW_MODE_OBJECTIVES_KEY = 'replay-show-mode-objectives'
const SHOW_FLAG_CARRIES_KEY = 'replay-show-flag-carries'
const SHOW_VIP_CROWN_KEY = 'replay-show-vip-crown'
const SHOW_SKULL_CARRIER_KEY = 'replay-show-skull-carrier'
const SHOW_BOMB_CARRIER_KEY = 'replay-show-bomb-carrier'
const SHOW_VEHICLES_KEY = 'replay-show-vehicles'
const MARKER_COLORS_KEY = 'replay-marker-colors'

/**
 * IS THE TIMELINE EXPANDED? A setting of the PLAYER, not of a layer: it therefore does not go
 * through the drawer, but through a chevron on the timeline itself (user feedback of
 * 2026-08-28) — collapsed, only the progress bar and its clocks remain. The key lives
 * with the other replay preferences: this is their registry, and `useReplayTimeline` reads it.
 */
export const TIMELINE_EXPANDED_KEY = 'replay-timeline-expanded'

/** Speed multipliers offered (carried over from the POC, tuned on screen). */
export const SPEED_MULTIPLIERS: readonly number[] = [0.5, 1, 1.5, 2, 4]

const SPEED_DEFAULT = 1

/** The two heat map readings, in the order the drawer offers them. */
export const HEATMAP_MODES: readonly HeatmapMode[] = ['presence', 'kills']

/** The two time spans, in the order the drawer offers them (V2, 2026-08-18). */
export const HEATMAP_SPANS: readonly HeatmapSpan[] = ['match', 'live']

/**
 * The heat map is OFF by default. This is not a half-shipped feature: it is a synthesis
 * layer that covers the terrain, and the replay opens on what moves — the players. Same
 * rule as the sound, turned on by the user when they want it.
 */
const SHOW_HEATMAP_DEFAULT = false
const HEATMAP_MODE_DEFAULT: HeatmapMode = 'presence'

/**
 * ALL OF THE DEFAULT PART, and this is the behavior unchanged since 08/16: the replay's map was
 * ALREADY the one for the whole match (measured before coding — `accumulatePresence` knew no
 * bound). The `live` span is what this batch ADDS; making it the default would change under the
 * user's feet the only reading they had validated.
 */
const HEATMAP_SPAN_DEFAULT: HeatmapSpan = 'match'

/**
 * BOTH EVENT EFFECTS ARE ON BY DEFAULT.
 *
 *  - MUZZLE FLASHES have been since 08/16: they say where the match is being played, frame
 *    after frame, and it is the layer the user validated without reservation;
 *  - DEATH EFFECTS join them on 2026-08-20. They were off as of 08/16 ("optional, off by
 *    default"), and it is that reservation that backfired: the user was LOOKING for them
 *    without finding them, since you had to already know they existed to go turn them on. A
 *    killer -> victim streak at the moment of the elimination is exactly what one comes to read
 *    on a replay.
 *
 * This is NOT a half-shipped feature in the sense of CLAUDE.md #11 ("no flag that leaves a
 * feature OFF for later"): both effects are shipped, complete, and the switch is a DISPLAY
 * SETTING offered to the viewer — not a work-in-progress switch.
 */
const SHOW_SHOT_FX_DEFAULT = true
const SHOW_KILL_FX_DEFAULT = true

/**
 * THE TWO EQUIPMENT PLACEMENT TOGGLES, and their OPPOSITE defaults too (user decision of
 * 08/18):
 *
 *  - PLACEMENTS are ON: the wall and the sensor are terrain objects that change the reading
 *    of an exchange, just like a capture zone;
 *  - UNIDENTIFIED OBJECTS are OFF, and this is not modesty: on a Big Team Battle film, NO
 *    placement is named today (the naming threshold of 08/18 leaves the "family A" palette
 *    unnamed) — turning them on would place hundreds of neutral points. The toggle exists
 *    exactly for that: seeing what the measurement found without being able to name it, when
 *    asked for.
 *
 * Neither one is a half-shipped feature (CLAUDE.md #11): both renders are shipped and
 * complete, the switch is a DISPLAY SETTING offered to the viewer.
 */
const SHOW_PLACEMENTS_DEFAULT = true
const SHOW_UNNAMED_PLACEMENTS_DEFAULT = false

/**
 * DROPPED POWER OBJECTS ARE ON BY DEFAULT (user decision of 2026-08-18: "outside Fiesta it's
 * tactically interesting"). An overshield or a sensor on the ground is PICKABLE UP: knowing it
 * is there changes the reading of the next exchange, exactly like knowing a weapon is still on
 * its stand.
 *
 * THE TOGGLE APPLIES IN ALL MODES since 2026-08-20. A mode guard used to cancel it in Fiesta in
 * the name of the same 08/18 decision; it was actually hiding 26 real drops on the Fiesta
 * witness film `000d5950`, and the user wants to see them. The drawer therefore shows the
 * control as soon as the film carries something to control — same rule as the Zones button.
 *
 * This is not a half-shipped feature (CLAUDE.md #11): the layer is complete, the switch is a
 * DISPLAY SETTING offered to the viewer.
 */
const SHOW_DROPPED_PLACEMENTS_DEFAULT = true

/**
 * WEAPON STANDS ARE ON BY DEFAULT (user decision of 08/18, W4: "the info is interesting to
 * have"). They are terrain locations, not events: knowing the sniper rifle is still on its
 * stand changes the reading of an exchange, exactly like a capture zone. A film that carries
 * none shows neither layer nor toggle.
 */
const SHOW_WEAPON_PADS_DEFAULT = true

/**
 * GROUND WEAPONS ARE ON BY DEFAULT (schema 27). Same reasoning as the dropped power objects,
 * decided on 2026-08-18: a weapon pickable off the ground changes the reading of the next
 * exchange, just like a weapon still on its stand. A film that carries none shows neither
 * layer nor toggle.
 *
 * This is not a half-shipped feature (CLAUDE.md #11): the layer is complete, the switch is a
 * DISPLAY SETTING offered to the viewer — a Big Team Battle map stays dense.
 */
const SHOW_GROUND_WEAPONS_DEFAULT = true

/**
 * THE "SPECIAL WEAPONS ONLY" FILTER IS OFF BY DEFAULT. It is a NARROWING of the ground
 * weapons layer, not its replacement: the behavior before this batch (show everything) stays
 * the default, and the user chooses to refine on dense matches (204 objects/film on average,
 * 82% without tactical interest).
 */
const SHOW_GROUND_WEAPONS_SPECIAL_ONLY_DEFAULT = false

/**
 * DROPPED STARTING WEAPONS ARE HIDDEN BY DEFAULT (user decision of 2026-10-15): everyone
 * carries the same ones, they add nothing. The option shows them again; the weapons placed by
 * the map, on the other hand, always stay visible (`model/startingWeaponsOnGround.ts`).
 */
const SHOW_GROUND_WEAPONS_STARTING_DEFAULT = false

/**
 * FLAGS ARE ON BY DEFAULT. This is the STAKE of the match in capture the flag: knowing where
 * the flag is, who carries it and since when is the very reading of the mode — a CTF replay
 * that opened without it would show eight points running around for no reason. A film that
 * carries none (any mode that is not capture) shows neither layer nor toggle.
 *
 * This is not a half-shipped feature (CLAUDE.md #11): the layer is complete, the switch is a
 * DISPLAY SETTING offered to the viewer — a capture BTB stays dense.
 */
const SHOW_FLAG_CARRIES_DEFAULT = true
const SHOW_VIP_CROWN_DEFAULT = true
const SHOW_SKULL_CARRIER_DEFAULT = true
const SHOW_BOMB_CARRIER_DEFAULT = true

/**
 * VEHICLES ARE ON BY DEFAULT (schema 39, 2026-09-02 batch): this is the very goal of the
 * project ("replay a match ... with vehicles visible"), same as the stands or the flags — a
 * terrain object that changes the reading of the match, not a style effect. A film that
 * carries none (`coverage.vehicles`) shows neither layer nor toggle.
 *
 * This is not a half-shipped feature (CLAUDE.md #11): the layer is complete, the switch is a
 * DISPLAY SETTING offered to the viewer — a Big Team Battle map stays dense.
 */
const SHOW_VEHICLES_DEFAULT = true

/**
 * MODE OBJECTIVES ARE ON BY DEFAULT (2026-09-18): hills, bases, capture zones, stands and
 * delivery points are the TERRAIN of the stake — a King of the Hill without a hill would show
 * players fighting for nothing. A film that carries none (Assassin) shows neither layer nor
 * toggle. Like the flags: a display setting, not a half-shipped feature.
 */
const SHOW_MODE_OBJECTIVES_DEFAULT = true

/** The two marker color readings, in the order the drawer offers them. */
export type MarkerColorsMode = 'team' | 'player'
export const MARKER_COLORS_MODES: readonly MarkerColorsMode[] = ['team', 'player']

/**
 * MARKER COLOR SAYS THE TEAM BY DEFAULT (doctrine D1 of 2026-08-16: the color says the
 * side). The "distinct per player" option (user proposal of 2026-08-24) gives each player a
 * stable series color — to follow SOMEONE in the brawl — and the side still reads from the
 * cards, the feed and the banner. This is not a half-shipped feature (CLAUDE.md #11): both
 * readings are complete, the option is a display setting.
 */
const MARKER_COLORS_DEFAULT: MarkerColorsMode = 'team'

// THE "COMPACT CARDS" SETTING IS REMOVED (user decision of 2026-08-24: "compact cards is going
// to become the one and only option so we're going to drop the setting"): the compact card
// became THE card, the long variant left with its key.

export interface ReplaySettings {
  /** Aim layer (look direction). On by default, as today. */
  showAim: boolean
  toggleAim: () => void
  /** Named zones layer. On by default; the caller makes it conditional on the presence of
   *  zones on the map (same rule as the original button). */
  showZones: boolean
  toggleZones: () => void
  /**
   * NAMES layer under the markers (decision D4, 2026-08-16). On by default: the name is what
   * distinguishes one teammate from another, color only says the side. A 24-player BTB must
   * still be able to turn it off.
   */
  /**
   * TRAIL layer (V1, user feedback of 2026-08-18: "have the trail as an option"). ON by
   * default, as today: it is part of the marker validated on 08/16, and it is what says the
   * DIRECTION of a movement. This is not a half-shipped feature (CLAUDE.md #11): the layer is
   * complete, the switch is a display setting.
   */
  showTrail: boolean
  toggleTrail: () => void
  /** Heat map layer. OFF by default (cf. SHOW_HEATMAP_DEFAULT). */
  showHeatmap: boolean
  toggleHeatmap: () => void
  /** What the heat map measures — always a value of HEATMAP_MODES. */
  heatmapMode: HeatmapMode
  setHeatmapMode: (mode: HeatmapMode) => void
  /** Over WHICH SPAN it measures it — always a value of HEATMAP_SPANS. */
  heatmapSpan: HeatmapSpan
  setHeatmapSpan: (span: HeatmapSpan) => void
  /** Muzzle flashes on ALL decoded shots. On by default. */
  showShotFx: boolean
  toggleShotFx: () => void
  /** Killer -> victim oriented streak on eliminations. ON by default. */
  showKillFx: boolean
  toggleKillFx: () => void
  /** Equipment PLACEMENTS layer (wall, sensor). On by default. */
  showPlacements: boolean
  togglePlacements: () => void
  /** Placements whose nature is not established (family `other`). OFF by default. */
  showUnnamedPlacements: boolean
  toggleUnnamedPlacements: () => void
  /**
   * POWER objects dropped on death (power-ups, deployable equipment). ON by default, and
   * effective in ALL modes (cf. SHOW_DROPPED_PLACEMENTS_DEFAULT).
   */
  showDroppedPlacements: boolean
  toggleDroppedPlacements: () => void
  /** WEAPON STANDS layer (schema 11). On by default (cf. SHOW_WEAPON_PADS_DEFAULT). */
  showWeaponPads: boolean
  toggleWeaponPads: () => void
  /**
   * GROUND WEAPONS layer (schema 27) — abandoned weapons, distinct from the stands.
   * On by default (cf. SHOW_GROUND_WEAPONS_DEFAULT).
   */
  showGroundWeapons: boolean
  toggleGroundWeapons: () => void
  /**
   * "SPECIAL WEAPONS ONLY" filter of the ground weapons layer (batch 6.5, 2026-09-10):
   * sniper/power/special only. OFF by default (cf.
   * SHOW_GROUND_WEAPONS_SPECIAL_ONLY_DEFAULT).
   */
  showGroundWeaponsSpecialOnly: boolean
  toggleGroundWeaponsSpecialOnly: () => void
  /** "Also show starting weapons on the ground" option (cf. SHOW_GROUND_WEAPONS_STARTING_DEFAULT). */
  showGroundWeaponsStarting: boolean
  toggleGroundWeaponsStarting: () => void
  /**
   * MODE OBJECTIVES layer (2026-09-18): the baked geometry, the live state of the zones and
   * the action pulses — three layers for one object, a single toggle (cf.
   * `SceneToggles.modeObjectives`). On by default (cf. SHOW_MODE_OBJECTIVES_DEFAULT).
   */
  showModeObjectives: boolean
  toggleModeObjectives: () => void
  /**
   * Capture FLAGS layer (schema 15). On by default: it is the stake of the mode
   * (cf. SHOW_FLAG_CARRIES_DEFAULT). A non-capture film publishes none.
   */
  showFlagCarries: boolean
  toggleFlagCarries: () => void
  /**
   * VIP CROWN layer (schema 22). On by default: it is the stake of the mode
   * (cf. SHOW_VIP_CROWN_DEFAULT). A non-VIP film publishes none.
   */
  showVipCrown: boolean
  toggleVipCrown: () => void
  /**
   * Oddball SKULL CARRIER layer (schema 23). On by default: it is the stake of the mode
   * (cf. SHOW_SKULL_CARRIER_DEFAULT). A non-Oddball film publishes none.
   */
  showSkullCarrier: boolean
  toggleSkullCarrier: () => void
  /**
   * Assault BOMB layer (schema 30): carried on its bearer, placed on the ground. On by
   * default: it is the stake of the mode (cf. SHOW_BOMB_CARRIER_DEFAULT). A non-Assault film
   * publishes none.
   */
  showBombCarrier: boolean
  toggleBombCarrier: () => void
  /** VEHICLES layer (schema 39). On by default (cf. SHOW_VEHICLES_DEFAULT). */
  showVehicles: boolean
  toggleVehicles: () => void
  /** Player marker color: by team (default) or distinct per player. */
  markerColors: MarkerColorsMode
  setMarkerColors: (mode: MarkerColorsMode) => void
  /** Current speed multiplier — always a value of SPEED_MULTIPLIERS. */
  speed: number
  setSpeed: (speed: number) => void
}

/**
 * usePersistedFlag — ONE persisted toggle: its state, and the switch that writes it.
 *
 * CENTRALIZED HERE (CLAUDE.md #6, "centralize on the 3rd copy"): the aim, zones, names,
 * heat map, shot effects and death effects layers share EXACTLY the same body — initial state
 * read from storage, switch that persists the new value. Six copies of six lines would have
 * started to diverge (one forgetting the persistence, another the functional form of
 * setState).
 *
 * THE WRITE NEVER HAPPENS FROM `setValue`'S UPDATER, and this is an invariant, not a style
 * choice. `persistPreference` SYNCHRONOUSLY notifies all subscribers of the key, who in turn
 * call `setValue`: doing it from the updater triggers a state update in the middle of a render
 * phase, re-entrant on this hook — and on the OTHER instance of the same key when it lives on
 * an ancestor (bug experienced on the compact cards key, now removed: the drawer and the page
 * were reading the same key). React responded to this by keeping the old value half the time:
 * the switch "reverted" on its own, and StrictMode, which invokes updaters twice to flush out
 * exactly this kind of impurity, doubled the symptom.
 *
 * So: `next` is computed HERE, outside the updater, from the rendered value; `setValue`
 * receives a plain value; the persistence comes AFTER, from the event handler. `value` is
 * therefore a dependency of the switch — that is the price, and it is fair: a switch that does
 * not know the value it is flipping does not exist.
 *
 * EXPORTED since 2026-08-28: the timeline collapse is a persisted preference like the others,
 * but it does not go through the drawer (`useReplayTimeline` reads it directly). Making a
 * second copy of the body for this one reason would have reopened exactly the divergence this
 * centralization closed.
 */
export function usePersistedFlag(key: string, fallback: boolean): [boolean, () => void] {
  const [value, setValue] = useState(() => readStoredFlag(key, fallback))
  // THE SUBSCRIPTION MAKES THE KEY SHAREABLE: two components reading the same preference move
  // together (cf. the note on `subscribePreference`). Without it, the drawer's switch would
  // only touch its own copy of the state.
  useEffect(() => subscribePreference(key, (raw) => setValue(raw === 'true')), [key])
  const toggle = useCallback(() => {
    const next = !value
    setValue(next)
    persistPreference(key, String(next))
  }, [key, value])
  return [value, toggle]
}

export function useReplaySettings(): ReplaySettings {
  const [showAim, toggleAim] = usePersistedFlag(SHOW_AIM_KEY, true)
  const [showZones, toggleZones] = usePersistedFlag(SHOW_ZONES_KEY, true)
  const [showTrail, toggleTrail] = usePersistedFlag(SHOW_TRAIL_KEY, true)
  const [showHeatmap, toggleHeatmap] = usePersistedFlag(SHOW_HEATMAP_KEY, SHOW_HEATMAP_DEFAULT)
  const [showShotFx, toggleShotFx] = usePersistedFlag(SHOW_SHOT_FX_KEY, SHOW_SHOT_FX_DEFAULT)
  const [showKillFx, toggleKillFx] = usePersistedFlag(SHOW_KILL_FX_KEY, SHOW_KILL_FX_DEFAULT)
  const [showPlacements, togglePlacements] = usePersistedFlag(
    SHOW_PLACEMENTS_KEY,
    SHOW_PLACEMENTS_DEFAULT,
  )
  const [showUnnamedPlacements, toggleUnnamedPlacements] = usePersistedFlag(
    SHOW_UNNAMED_PLACEMENTS_KEY,
    SHOW_UNNAMED_PLACEMENTS_DEFAULT,
  )
  const [showDroppedPlacements, toggleDroppedPlacements] = usePersistedFlag(
    SHOW_DROPPED_PLACEMENTS_KEY,
    SHOW_DROPPED_PLACEMENTS_DEFAULT,
  )
  const [showWeaponPads, toggleWeaponPads] = usePersistedFlag(
    SHOW_WEAPON_PADS_KEY,
    SHOW_WEAPON_PADS_DEFAULT,
  )
  const [showGroundWeapons, toggleGroundWeapons] = usePersistedFlag(
    SHOW_GROUND_WEAPONS_KEY,
    SHOW_GROUND_WEAPONS_DEFAULT,
  )
  const [showGroundWeaponsSpecialOnly, toggleGroundWeaponsSpecialOnly] = usePersistedFlag(
    SHOW_GROUND_WEAPONS_SPECIAL_ONLY_KEY,
    SHOW_GROUND_WEAPONS_SPECIAL_ONLY_DEFAULT,
  )
  const [showGroundWeaponsStarting, toggleGroundWeaponsStarting] = usePersistedFlag(
    SHOW_GROUND_WEAPONS_STARTING_KEY,
    SHOW_GROUND_WEAPONS_STARTING_DEFAULT,
  )
  const [showModeObjectives, toggleModeObjectives] = usePersistedFlag(
    SHOW_MODE_OBJECTIVES_KEY,
    SHOW_MODE_OBJECTIVES_DEFAULT,
  )
  const [showFlagCarries, toggleFlagCarries] = usePersistedFlag(
    SHOW_FLAG_CARRIES_KEY,
    SHOW_FLAG_CARRIES_DEFAULT,
  )
  const [showVipCrown, toggleVipCrown] = usePersistedFlag(
    SHOW_VIP_CROWN_KEY,
    SHOW_VIP_CROWN_DEFAULT,
  )
  const [showSkullCarrier, toggleSkullCarrier] = usePersistedFlag(
    SHOW_SKULL_CARRIER_KEY,
    SHOW_SKULL_CARRIER_DEFAULT,
  )
  const [showBombCarrier, toggleBombCarrier] = usePersistedFlag(
    SHOW_BOMB_CARRIER_KEY,
    SHOW_BOMB_CARRIER_DEFAULT,
  )
  const [showVehicles, toggleVehicles] = usePersistedFlag(SHOW_VEHICLES_KEY, SHOW_VEHICLES_DEFAULT)
  const [heatmapMode, setHeatmapModeState] = useState(() =>
    readStoredChoice(HEATMAP_MODE_KEY, HEATMAP_MODE_DEFAULT, HEATMAP_MODES),
  )
  const [heatmapSpan, setHeatmapSpanState] = useState(() =>
    readStoredChoice(HEATMAP_SPAN_KEY, HEATMAP_SPAN_DEFAULT, HEATMAP_SPANS),
  )
  const [markerColors, setMarkerColorsState] = useState(() =>
    readStoredChoice(MARKER_COLORS_KEY, MARKER_COLORS_DEFAULT, MARKER_COLORS_MODES),
  )
  const [speed, setSpeedState] = useState(() =>
    readStoredNumber(SPEED_KEY, SPEED_DEFAULT, (v) => SPEED_MULTIPLIERS.includes(v)),
  )

  const setHeatmapMode = useCallback((next: HeatmapMode) => {
    setHeatmapModeState(next)
    persistPreference(HEATMAP_MODE_KEY, next)
  }, [])

  const setHeatmapSpan = useCallback((next: HeatmapSpan) => {
    setHeatmapSpanState(next)
    persistPreference(HEATMAP_SPAN_KEY, next)
  }, [])

  const setSpeed = useCallback((next: number) => {
    setSpeedState(next)
    persistPreference(SPEED_KEY, String(next))
  }, [])

  const setMarkerColors = useCallback((next: MarkerColorsMode) => {
    setMarkerColorsState(next)
    persistPreference(MARKER_COLORS_KEY, next)
  }, [])

  return {
    showAim,
    toggleAim,
    showZones,
    toggleZones,
    showTrail,
    toggleTrail,
    showHeatmap,
    toggleHeatmap,
    heatmapMode,
    setHeatmapMode,
    heatmapSpan,
    setHeatmapSpan,
    showShotFx,
    toggleShotFx,
    showKillFx,
    toggleKillFx,
    showPlacements,
    togglePlacements,
    showUnnamedPlacements,
    toggleUnnamedPlacements,
    showDroppedPlacements,
    toggleDroppedPlacements,
    showWeaponPads,
    toggleWeaponPads,
    showGroundWeapons,
    toggleGroundWeapons,
    showGroundWeaponsSpecialOnly,
    toggleGroundWeaponsSpecialOnly,
    showGroundWeaponsStarting,
    toggleGroundWeaponsStarting,
    showModeObjectives,
    toggleModeObjectives,
    showFlagCarries,
    toggleFlagCarries,
    showVipCrown,
    toggleVipCrown,
    showSkullCarrier,
    toggleSkullCarrier,
    showBombCarrier,
    toggleBombCarrier,
    showVehicles,
    toggleVehicles,
    markerColors,
    setMarkerColors,
    speed,
    setSpeed,
  }
}
