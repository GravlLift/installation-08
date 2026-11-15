/**
 * useReplaySound — THE WIRING of the replay sound: user preference, lifecycle
 * of the Web Audio player, and the beat that makes sound what the cursor just crossed.
 *
 * There is here NEITHER sound rule (replaySound.ts: what sounds, when, and the cursor that
 * never replays anything twice) NOR playback (replayAudio.ts: context, envelope, voices) —
 * this file is only the React seam between the two, so that the canvas component does not
 * have to know Web Audio (anti-pattern "logic in the component").
 *
 * TWO STATES, NOT ONE — AND THAT IS THE LESSON OF THE FIX OF 2026-08-27. The PREFERENCE ("I want
 * sound", persisted) and the PLAYER (the AudioContext, which can only be born in a gesture)
 * are two distinct things, and a page reload necessarily desyncs them: the
 * preference comes back from local storage, the player does not. During this window the panel
 * displayed "sound enabled" while nothing could sound, and the next click — the gesture that
 * could have fixed everything — toggled the preference to "off". It therefore took TWO clicks
 * to hear anything, which looked like a failure.
 *
 * THE DESYNC IS RESOLVED AT THE FIRST GESTURE, whatever it is, and never before (item 12, 2026-09-27):
 *  - the sound button ACTIVES when nothing plays, instead of cutting (`toggle`);
 *  - "Play" and "Restart" wake the player (`wake`, via `useReplayPlayback`);
 *  - any other click or key on the page too, and a document that HAS ALREADY received a
 *    gesture (another replay without reload) opens it at display (`useAudioUnlock`).
 * Never any sound without a prior gesture: it is the list of gestures that grows.
 *
 * THREE SILENCES ARE INTENDED, and none is a bug:
 *  - OFF BY DEFAULT: nothing sounds, nothing is downloaded even, until the user
 *    has clicked. The AudioContext is born IN that click (autoplay policy: a context
 *    created outside a gesture starts suspended);
 *  - PLAYER IN PAUSE OR TAB IN BACKGROUND: the animation loop no longer beats, so
 *    `tick` is no longer called. On return, the time jump reseeds the cursor in silence
 *    (SOUND_RESYNC_JUMP_MS): what was crossed is not replayed;
 *  - FAST FORWARD: beyond SOUND_MAX_SPEED, the cursor follows without playing.
 *
 * THE END OF MATCH SOUND (lot C) DOES NOT COME FROM THE TRACK, like the intro (`introSound.ts`).
 * It has no moment on the film's clock: it is the PLAYBACK that calls it on arriving at the
 * end bound (`useReplayPlayback.onEnded`), once per arrival. It goes through the same
 * player, therefore through the same preference and the same volume — sound off, nothing; and
 * it obeys the fast-forward silence too, otherwise the panel would announce "sound cut by speed"
 * while a fanfare plays. Its takes are PRELOADED with the track: the drawing takes
 * place at the arrival at the end, and a file requested at that moment would arrive too late.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'

import type { ReplayKill } from '../model/killFeedLogic'
import { soundUrlOf } from './replayAudioMix'

import { persistPreference, readStoredFlag, readStoredNumber } from '../settings/replayPreferences'
import { endMatchSoundsOf, endMatchSoundStems, type EndMatchSoundSpec } from './endMatchSound'
import type { AnnouncerContext } from './useAnnouncerTrack'
import { useSoundTimeline } from './useSoundTimeline'
import { useSoundCategoryFilter } from './useSoundCategoryFilter'
import { endMatchSoundsFor, soundFamiliesFor } from './exportSoundFamilies'
import { INTRO_MUSIC_STEM, playIntroAligned } from './introSound'
import { COUNTDOWN_TICK_STEM } from './countdownSound'
import { ReplayAudioPlayer, soundShapeOf } from './replayAudio'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { distanceChain, drawVariation, withEventGain } from './weaponSoundLogic'
import { WEAPON_SOUND_VARIATIONS } from './weaponSoundVariations'
import type { SoundCategory, SoundCategoryFilter } from './replaySound'
import { objectiveSideResolver } from './objectiveSound'
import type { FilmAllegiance } from '../../../lib/replay/filmAllegiance'
import { pickVariantStem, stemsOf, type ReplaySoundEvent } from './replaySoundVariants'
import { placeOf, type SoundListener } from './soundSpatial'
import {
  advanceSoundCursor,
  resyncSoundCursor,
  soundPlaysAtSpeed,
  type SoundCursor,
} from './replaySoundCursor'
import { useReplayEngineSound } from './useReplayEngineSound'
import { useAudioUnlock } from './useAudioUnlock'
import type { EnginePlan } from './vehicleEngineSound'

/** Persisted preferences — shared pattern (replayPreferences.ts), born here. */
const SOUND_ON_KEY = 'replay-sound-on'
const SOUND_VOLUME_KEY = 'replay-sound-volume'

/** Opening volume: present enough to be heard, low enough not to startle. */
export const SOUND_VOLUME_DEFAULT = 0.7

/** What the component receives: a state to display, commands, a beat. */
/** What the out-of-real-time export mixes: the track the page plays, as is. */
export interface ReplayExportTrack {
  timeline: readonly ReplaySoundEvent[]
  /** The END OF MATCH takes: they have no moment on the track. */
  endMatchStems: readonly string[]
  /**
   * WHICH STEMS ARE VOICE, AND WHICH ARE MUSIC — for the separated tracks of the
   * exported clip. Everything that does not appear there is a SOUND EFFECT: that is by far
   * the most common case, and the safest default (a misclassified sound stays in the full mix).
   *
   * The VOICE is not limited to the end of match: the announcer also announces the end of ROUND,
   * and that sound lives in the track, mixed with the sound effects.
   */
  families: { voice: readonly string[]; music: readonly string[] }
  /**
   * THE ENGINE PLAN OF THE VEHICLES (cf. `vehicleEngineSound.ts`): not events but
   * continuous STATES — the export places them by segments (`vehicleEngineMix.ts`), the page
   * by its dedicated player. Same plan on both sides: the clip cannot invent or miss an engine.
   */
  engines: readonly EnginePlan[]
  /** Instance setting of weapon variation, read at call (admin page). */
  variationPercent: number
  /**
   * Instance setting of DISTANCE (admin page). The export places the same attenuation chain +
   * low-pass as the player: without it, the clip would sound louder and brighter than the
   * page, which contradicts "the faithful track".
   */
  distancePercent: number
}

export interface ReplaySound {
  /** WHO LISTENS: the 3D view writes its camera there at each frame; `null` (2D view) = no sound placed. */
  listener: RefObject<SoundListener | null>
  /** The track carries at least one sound: otherwise, no command to offer. INDEPENDENT of
   * the category filter — unchecking all must not make the panel disappear. */
  available: boolean
  on: boolean
  toggle: () => void
  /**
   * To call in a TRANSPORT GESTURE (play, restart): restores its player to a replay
   * whose preference stayed "enabled" from one session to the next. No effect if the sound
   * is off or if the player is already alive.
   */
  wake: () => void
  volume: number
  setVolume: (v: number) => void
  /** The sound is enabled but muted by the playback speed (to say, not to hide). */
  mutedBySpeed: boolean
  /** Category filter (settings drawer, phase 2): `true` = category audible. */
  categories: SoundCategoryFilter
  toggleCategory: (category: SoundCategory) => void
  /** To call at each animation step with the current moment of the replay, in ms. */
  tick: (ms: number) => void
  /**
   * seek — A JUMP, NOT A PLAYBACK: the cursor is PLACED at this moment without playing anything.
   *
   * WHY IT IS A SEPARATE COMMAND (lot 5.8.7). `tick` is the beat of the PLAYBACK: it
   * plays everything that falls between the previous moment and this one, and only reseeds in silence
   * beyond `SOUND_RESYNC_JUMP_MS`. Served after a TIMELINE DRAG, it therefore does one of two
   * wrong things: a burst (jump under the second) or a reseeding that depends on the amplitude
   * of the gesture. A jump has no amplitude that counts — we did not listen to what we
   * crossed, whatever its duration.
   */
  seek: (ms: number) => void
  /**
   * THE PLAYBACK JUST STOPPED OR RESTARTED. The event sounds do not need it
   * (without a beat, nothing goes out) — the VEHICLE ENGINES do: a loop in flight does
   * not turn off by itself, the pause must cut it (20 ms ramp, decision n° 6).
   */
  setTransportPlaying: (playing: boolean) => void
  /**
   * THE CONCLUSION: announcer voice + fanfare, to call ONCE when the playback reaches
   * the end bound of the match. Nothing sounds if the sound is off, if the end is not readable
   * (cf. `endMatchSoundSpec`) or if the speed exceeds SOUND_MAX_SPEED.
   */
  endMatch: () => void
  /** THE INTRO MUSIC (item 7, `introSound.ts`): at the departure from the preamble, by the
   * ordinary route — sound off or speed beyond SOUND_MAX_SPEED, silence. Never in the export. */
  intro: () => void
  /** THE PRE-GAME COUNTDOWN TICK (`countdownSound.ts`), played on the number `n` (3, 2, 1) the
   * countdown shows. Sound off, player not born yet, or tick not extracted: silence. */
  countdownTick: (n: number) => void
  /**
   * THE AUDIO TRACK TO JOIN TO A RECORDED VIDEO, or `null`.
   *
   * `null` in two cases that make only one from the user's point of view: the sound is
   * off, or the player has not been born (it is only born in the gesture that activates the sound). The
   * clip then comes out silent, and that is decision 6 of the plan — the track is wired AT THE START
   * of the recording, so activating the sound afterwards does not add it to the clip in progress. The
   * reason is not technical but of readability: a file whose sound would start
   * partway through would be mistaken for a damaged file.
   */
  recordingTrack: () => MediaStreamTrack | null
  /**
   * WHAT THE OUT-OF-REAL-TIME EXPORT MIXES (`replayAudioMix.ts`). The track is NOT rebuilt
   * there: it is the one the page plays, so the clip cannot invent a sound or
   * miss one. `endMatchStems` carries the end-of-match takes, which have no moment on
   * the track — they are placed on the end bound.
   */
  exportTrack: () => ReplayExportTrack
}

/** The URLs of the sounds EFFECTIVELY present in a track: we never preload the full
 * pack (58 files) for a match that only plays five of them. `extra` carries the stems that
 * have no moment on the clock — the end-of-match takes, whose drawing will
 * only take place at the arrival at the end. */
function soundURLsFor(
  timeline: readonly { stem: string; variants?: readonly string[] }[],
  extra: readonly string[],
): Map<string, string> {
  const urls = new Map<string, string>()
  for (const e of timeline) {
    // ALL variants are preloaded, not only the one that will come out of the drawing: the
    // drawing takes place at playback, and a file not yet decoded there would be a silence.
    for (const stem of stemsOf(e)) {
      if (!urls.has(stem)) urls.set(stem, soundUrlOf(stem))
    }
  }
  for (const stem of extra) {
    if (!urls.has(stem)) urls.set(stem, soundUrlOf(stem))
  }
  return urls
}

/**
 * Sub-hook: the INSTANCE SETTINGS of the weapon sounds (admin page — variation RANGED and
 * distance), extracted for the same reason as the category filter: keep the main hook
 * under the readability threshold. The variation is read at the DRAWING (ref, not a
 * dependency of the beat); the distance is PLACED on the player as soon as it changes — and
 * `apply` also places it at the creation of the player, which is born after the first setting.
 */
function useInstanceSoundTuning(playerRef: { current: ReplayAudioPlayer | null }): {
  variationPercentRef: { current: number }
  /** SAME NATURE AS THE VARIATION: a REF, because the export reads it at its launch and not
   * during a render (reading a ref at render gives an arbitrary value). */
  distancePercentRef: { current: number }
  apply: (player: ReplayAudioPlayer) => void
} {
  const variationPercent = 100
  const distancePercent = 0
  const variationPercentRef = useRef(variationPercent)
  const distancePercentRef = useRef(distancePercent)
  const apply = useCallback(
    (player: ReplayAudioPlayer) => player.setDistance(distanceChain(distancePercent)),
    [distancePercent],
  )
  useEffect(() => {
    variationPercentRef.current = variationPercent
    distancePercentRef.current = distancePercent
    if (playerRef.current) apply(playerRef.current)
  }, [variationPercent, distancePercent, apply, playerRef])
  return { variationPercentRef, distancePercentRef, apply }
}

/**
 * ReplaySoundContext — the entries of `useReplaySound` that depend on the CONTEXT of the page
 * (allegiance seen from the viewpoint, end of match, language), rather than on the track itself
 * (`doc`/`kills`/`speed`, kept positional).
 *
 * Grouped into an object on 2026-09-10:
 * the hook had 7 positional parameters (threshold of the repository CLAUDE.md n°5: 5), a commented
 * exemption waiting for this lot, which touches the 8 calls of the hook — including 7 tests.
 *
 * THE THREE FIELDS ARE REQUIRED (`null`/`undefined` explicit). The allegiance carries the VIEWPOINT
 * (decision 11 of 2026-09-06: "ally" / "opposing" are said with respect to the player
 * viewed; only the end of match, `endMatch`, remains anchored on the player of the page): a
 * caller who would omit it would leave the zone ticks and the objective voice on another side
 * than that of the map, and the tests would stay green — required, the forget does not compile.
 */
export interface ReplaySoundContext extends AnnouncerContext {
  /** The allegiance read in the film, seen from the viewpoint (`model.allegiance`): the side
   * of the author of an objective action (`objectiveSideResolver`) and the allied side of the
   * zone sounds. Without allegiance, the actions that have two team variants stay MUTED — the
   * replay never guesses a side, same rule as the ink of the layers. */
  allegiance: FilmAllegiance
  endMatch: EndMatchSoundSpec | null
}

export function useReplaySound(
  doc: ReplayDocumentReady,
  // The kills OF THE FILM, already realigned (`killsOfFeed`): the track no longer replays the realignment.
  kills: readonly ReplayKill[],
  speed: number,
  context: ReplaySoundContext,
): ReplaySound {
  const { allegiance, locale } = context
  const listener = useRef<SoundListener | null>(null)
  const sideOfXuid = useMemo(() => objectiveSideResolver(allegiance), [allegiance])
  // The allied side AS A NUMBER: the zone state sounds join on the owner of a zone,
  // not on the xuid of a player. Same film allegiance as the resolver above.
  const allyTeam = allegiance.allyTeam
  const [on, setOn] = useState(() => readStoredFlag(SOUND_ON_KEY, false))
  const [volume, setVolumeState] = useState(() =>
    readStoredNumber(SOUND_VOLUME_KEY, SOUND_VOLUME_DEFAULT, (v) => v > 0 && v <= 1),
  )
  const { categories, toggleCategory } = useSoundCategoryFilter()
  const playerRef = useRef<ReplayAudioPlayer | null>(null)
  const tuning = useInstanceSoundTuning(playerRef)
  // THE VEHICLE ENGINES (dedicated sub-hook, same size reason as the other two):
  // continuous states, not events — they go neither through the track nor through the cursor.
  const engine = useReplayEngineSound(doc)

  // Track PLAYED, categories cut removed AT THE CONSTRUCTION (never downstream, in the
  // player); AVAILABILITY OF THE PANEL independent of this filter (hasSoundEvents above).
  const { timeline, announcer } = useSoundTimeline(doc, kills, { categories, sideOfXuid, allyTeam, announcer: context, on })
  // The END-OF-MATCH VOICE is the announcer's too: cutting the category keeps the fanfare alone.
  const endMatch = useMemo(
    () => (context.endMatch && !categories.announcer ? { ...context.endMatch, voiced: false as const } : context.endMatch),
    [context.endMatch, categories.announcer],
  )
  // The ENGINES count in the availability: a match without sound event but with a
  // occupied vehicle does have something to make hear, therefore a button to offer.

  // The takes of the END enter the preload with the track: the drawing only takes place
  // at the arrival at the end, and a file requested at that moment would sound after the silence.
  const urls = useMemo(
    () => soundURLsFor(timeline, [...endMatchSoundStems(endMatch), INTRO_MUSIC_STEM, COUNTDOWN_TICK_STEM, ...engine.stems]),
    [timeline, endMatch, engine.stems],
  )

  const cursorRef = useRef<SoundCursor>({ ms: 0, idx: 0 })
  // The next beat PLACES the cursor without playing anything. True at activation and at any
  // change of track: without that, activating the sound at 500 ms would send out all at once
  // everything that precedes (the gap to the cursor, stayed at 0, would pass for continuous playback).
  const resyncRef = useRef(true)
  // Is the playback running? Presumed true until the page says otherwise
  // (`setTransportPlaying`, published at each play/pause change, including at mount).
  const playingRef = useRef(true)
  // Read by the beat without being dependencies of it: cutting the sound or changing the speed
  // must not recreate the animation loop of the canvas.
  const onRef = useRef(on)
  // The LEVEL set, read by the gestures that open the player: making it a dependency of
  // their callbacks would recreate them at each step of the volume cursor. It is written in
  // `setVolume`, its only entry point.
  const volumeRef = useRef(volume)
  const speedRef = useRef(speed)
  const timelineRef = useRef(timeline)
  const urlsRef = useRef(urls)
  // The end playback follows the same rule: `onEnded` must remain STABLE, otherwise the
  // animation loop would be recreated the day the match header arrives.
  const endMatchRef = useRef(endMatch)

  useEffect(() => { onRef.current = on }, [on])
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => { endMatchRef.current = endMatch }, [endMatch])
  useEffect(() => {
    timelineRef.current = timeline
    urlsRef.current = urls
    resyncRef.current = true
    // A match that changes while the sound is running: the new sounds load, the
    // old ones stay in cache (same player, same URLs where applicable).
    if (onRef.current) playerRef.current?.preload(urls.values())
  }, [timeline, urls])

  // The player dies WITH the component: an AudioContext left open survives the page.
  useEffect(() => () => {
    playerRef.current?.dispose()
    playerRef.current = null
  }, [])

  /**
   * openPlayer — THE PLAYER COMES TO LIFE. TO CALL ONLY IN A USER GESTURE: it is the
   * only window where an AudioContext starts in operation (autoplay policy).
   *
   * It reads the volume in a REF and not in the state: this function is called by
   * stable callbacks (button toggle, transport gestures), and making it a dependency of
   * the volume would recreate them at each movement of the cursor.
   */
  const openPlayer = useCallback(() => {
    const level = volumeRef.current
    let player = playerRef.current
    if (!player) {
      player = new ReplayAudioPlayer(level)
      playerRef.current = player
      tuning.apply(player)
    }
    engine.attach(player)
    player.resume()
    player.setVolume(level)
    player.preload(urlsRef.current.values())
    resyncRef.current = true
  }, [tuning, engine.attach])

  /**
   * wake — WHAT A TRANSPORT GESTURE DOES WHEN THE PREFERENCE IS ALREADY AT "ENABLED".
   *
   * Nothing at all in the nominal case: the player already exists, or the sound is off. It only
   * serves the situation described above — preference restored to `true` by the local storage,
   * no player, therefore no sound. The first "Play" or "Restart" is a user gesture; it
   * therefore counts for the autoplay policy, and it restores to the replay the sound that
   * the user never cut.
   */
  const wake = useCallback(() => {
    if (!onRef.current || playerRef.current) return
    openPlayer()
  }, [openPlayer])
  useAudioUnlock(on, wake)

  const toggle = useCallback(() => {
    // NOTHING TO COMMAND, NOTHING MOVES (fix of 2026-08-28, review R1). The sound button does
    // not render when the match has no sound — but the KEYBOARD SHORTCUT, it, has no
    // render to respect: "M" on such a match toggled the preference, PERSISTED
    // it (`SOUND_ON_KEY`) and opened a player, without a single pixel changing on screen. The
    // next replay would then start in the opposite state of the one we thought we left.
    // The guard lives HERE, at the owner of the state, and not in the keyboard: it is the only
    // place that makes it true for ALL callers, present and to come.

    // THE FIRST CLICK AFTER A RELOAD ACTIVES, IT DOES NOT CUT (fix of 2026-08-27).
    // The preference is "enabled" but no player exists: the displayed state and the real
    // state contradict each other, and toggling the preference to "off" would make the user
    // pay for an inconsistency he did not author — it would take TWO clicks to hear something.
    // This click reconciles the two: the sound starts playing, the preference does not move.
    if (onRef.current && !playerRef.current) {
      openPlayer()
      return
    }
    const next = !onRef.current
    onRef.current = next
    persistPreference(SOUND_ON_KEY, String(next))
    // IN THE GESTURE, always. IMMEDIATE CUT in the other direction (master ramp): what
    // is in flight is turned off with it, rather than lingering a second after the click.
    if (next) openPlayer()
    else {
      playerRef.current?.setVolume(0)
      // The master ramp turns off what is IN FLIGHT; an engine loop, by contrast, would
      // keep turning in silence and restart at the next volume setting — we cut it. The
      // held bursts too.
      engine.stop()
      playerRef.current?.stopHeld()
    }
    setOn(next)
  }, [openPlayer, engine.stop])

  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(Math.max(v, 0), 1)
    volumeRef.current = clamped
    setVolumeState(clamped)
    persistPreference(SOUND_VOLUME_KEY, String(clamped))
    if (onRef.current) playerRef.current?.setVolume(clamped)
  }, [])

  // The recording track is read on the REFS (`onRef`, `playerRef`) and not on the state:
  // it is requested at the moment of a click on "Record", never during a render, and
  // this function must remain stable so as not to recreate the capture object at each sound.
  const recordingTrack = useCallback((): MediaStreamTrack | null => {
    if (!onRef.current) return null
    return playerRef.current?.recordingTrack() ?? null
  }, [])

  const tick = useCallback((ms: number) => {
    const tl = timelineRef.current
    const player = playerRef.current
    // The cursor ALWAYS follows the playback, even muted: on returning to 1x, we restart
    // from the current moment and not from a crossed past.
    if (!onRef.current || !player || !soundPlaysAtSpeed(speedRef.current)) {
      cursorRef.current = resyncSoundCursor(tl, ms)
      // The ENGINES stay silent with the rest: beyond SOUND_MAX_SPEED, the panel says
      // "sound cut by speed", and an engine that would continue would make it lie. The
      // held bursts too (schema 71).
      engine.stop()
      player?.stopHeld()
      return
    }
    // The engines follow the moment BEFORE the drawing of the events: a jump is reconciled
    // in silence by the engine player itself (resuming directly on the loop).
    // THE ENGINES ONLY FOLLOW THE PLAYBACK. A jump (timeline drag, frame step, jump
    // to a landmark) also beats at the stop: reconciling the engines there would start loops
    // that nothing would turn off (the pause already happened), a vehicle idling on a fixed frame.
    if (playingRef.current) engine.sync(ms)
    else engine.stop()
    if (resyncRef.current) {
      resyncRef.current = false
      cursorRef.current = resyncSoundCursor(tl, ms)
      // A JUMP turns off the held burst: it belonged to the moment left.
      player.stopHeld()
      return
    }
    const { cursor, fire } = advanceSoundCursor(tl, cursorRef.current, ms)
    cursorRef.current = cursor
    for (const e of fire) {
      // THE VARIANT DRAWING TAKES PLACE HERE, not at the construction of the track: a track is
      // built once for the whole match, drawing there would make replay the same file at each
      // occurrence of the gesture — exactly what the variant avoids (`replaySoundVariants.ts`).
      const stem = pickVariantStem(e)
      const url = urlsRef.current.get(stem)
      if (!url) continue
      const shape = soundShapeOf(e)
      // At the stop (no frame, jump to a landmark), a short sound lands with the frame, but
      // a held burst (up to ten seconds) would pull on a frame that no longer moves.
      if (!playingRef.current && shape?.holdS !== undefined) continue
      // AN ANNOUNCER VOICE passes out of ceiling, without variation (rule `soundOccupiesVoice`), and
      // the pause turns it off like any sound in flight (rule `soundSurvivesPause`): two distinct questions.
      if (e.announcer) {
        player.playAnnouncer(url)
        continue
      }
      // The variation drawing only concerns WEAPONS: the table is keyed by weapon
      // stem, any other stem plays as is (drawVariation returns the exact neutral). The SHAPE
      // (held sound or cut shot of a continuous fire burst, schema 71) travels with the event.
      player.play(
        url,
        withEventGain(drawVariation(WEAPON_SOUND_VARIATIONS[stem], tuning.variationPercentRef.current), e),
        shape,
        placeOf(listener.current, e),
      )
    }
  }, [tuning.variationPercentRef, engine.stop, engine.sync])

  /**
   * seek — THE PATH OF THE JUMPS: it raises the reseeding flag then beats once.
   *
   * IT REUSES THE SAME FLAG AS THE ACTIVATION AND THE TRACK CHANGE (`resyncRef`), and
   * that is what makes it safe: this path "places the cursor without playing anything" exists since
   * the first day and it is already the only one that also knows how to reconcile the ENGINES (`engine.sync`
   * passes before the guard). A second writing of the cursor, here, would have forgotten the engines.
   */
  const seek = useCallback(
    (ms: number) => {
      resyncRef.current = true
      tick(ms)
    },
    [tick],
  )

  // THE CONCLUSION. It does NOT pass through the cursor: it has no moment on the track, and
  // the cursor exists to not replay what we crossed — a question that makes no sense
  // for an event that only arrives at the end. The caller guarantees uniqueness (the
  // playback reaches its bound only once per passage, cf. `useReplayPlayback`).
  //
  // NO RANGED VARIATION HERE: these ranges are those of the game engine for the WEAPONS
  // (weaponSoundVariations.ts). An announcer line and a fanfare play as they are.
  const playEndMatch = useCallback(() => {
    const spec = endMatchRef.current
    const player = playerRef.current
    if (!spec || !onRef.current || !player || !soundPlaysAtSpeed(speedRef.current)) return
    for (const stem of endMatchSoundsOf(spec)) {
      const url = urlsRef.current.get(stem)
      if (url) player.playConclusion(url) // out of voice ceiling (item 11, `soundOccupiesVoice`)
    }
  }, [])

  // THE INTRO: ordinary route, aligned on the kickoff even decoded late (`introSound.ts`).
  const playIntro = useCallback(() => {
    const [url, player, speed] = [urlsRef.current.get(INTRO_MUSIC_STEM), playerRef.current, speedRef.current]
    if (url && player && onRef.current && soundPlaysAtSpeed(speed)) void playIntroAligned(player, url, speed)
  }, [])

  // THE COUNTDOWN TICK: the same beep on each number (no per-number take exists in the game).
  const countdownTick = useCallback((n: number) => {
    void n
    const [url, player] = [urlsRef.current.get(COUNTDOWN_TICK_STEM), playerRef.current]
    if (url && player && onRef.current) player.playConclusion(url)
  }, [])

  // THE TRACK FOR THE EXPORT IS READ AT THE CALL, NEVER AT THE RENDER — same pattern as
  // `recordingTrack` just above, and for the same reason: `variationPercentRef` is a
  // REF (instance setting of the admin page). Reading it during the render would give an arbitrary
  // value and break the memoization, which the React compiler lint signals.
  const exportTrack = useCallback(
    (): ReplayExportTrack => ({
      timeline: timelineRef.current,
      // `endMatchSounds` and NOT `endMatchSoundStems`: the second is the list of
      // PRELOAD (all possible takes), the first what ACTUALLY PLAYS — one
      // drawn voice, plus the music. Confusing them made play the two takes at once.
      // The drawing is SEEDED so that two exports of the same match sound the same (decision D7).
      endMatchStems: endMatchSoundsFor(endMatchRef.current),
      families: soundFamiliesFor(endMatchRef.current, locale, announcer?.voice),
      engines: engine.plansForExport(),
      variationPercent: tuning.variationPercentRef.current,
      distancePercent: tuning.distancePercentRef.current,
    }),
    [tuning, engine.plansForExport, locale, announcer],
  )

  // THE PAUSE CUTS THE ENGINES (20 ms ramp): without a beat, a loop in flight
  // would never turn off. The resume has nothing to do — the next `tick` reseeds everything.
  const setTransportPlaying = useCallback(
    (playing: boolean) => {
      playingRef.current = playing
      if (playing) return
      engine.stop()
      // EVERYTHING that is in flight is turned off with it: held bursts, explosions, lines — a stopped frame
      // no longer pulls and no longer resonates (the match conclusion, by contrast, is spared).
      playerRef.current?.stopAll()
    },
    [engine.stop],
  )

  return {
    available: true,
    on,
    toggle,
    wake,
    volume,
    setVolume,
    mutedBySpeed: on && !soundPlaysAtSpeed(speed),
    categories,
    toggleCategory,
    tick,
    seek,
    setTransportPlaying,
    endMatch: playEndMatch,
    intro: playIntro,
    countdownTick,
    recordingTrack,
    exportTrack,
    listener,
  }
}
