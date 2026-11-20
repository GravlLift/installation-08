// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useReplayExport — THE LOOP THAT RECOMPUTES THE FILM, and the React wiring around it.
 *
 * # THE DIFFERENCE WITH RECORDING, IN ONE SENTENCE
 *
 * `useReplayCapture` FILMS the screen: it is subject to real time. This hook RECOMPUTES the
 * film — it sets a frame, paints it, encodes it, and moves to the next as fast as the machine
 * keeps up. A ten-minute match comes out in one minute instead of ten, and the file's duration
 * never depends on compute time (timestamps are set, see `replayVideoEncoder.ts`).
 *
 * What makes this possible is a property of the canvas, not a trick: `draw()` is a PURE
 * FUNCTION of `frameRef.current`. Setting the frame then calling `draw()` paints exactly that
 * frame, as many times as wanted, in any order.
 *
 * # THREE PITFALLS, ALL MEASURED RATHER THAN ASSUMED
 *
 * 1. NEVER YIELD VIA A TIMER. `setTimeout` and `requestAnimationFrame` are throttled in a
 *    hidden tab — 673 ms average latency for the former, never fired for the latter — and an
 *    export runs for minutes during which the user goes elsewhere. The answer is
 *    `yieldToEvents()` (see `eventLoopYield.ts`), and nothing else.
 * 2. COLORS MUST BE RESOLVED BEFORE THEY REACH THE CANVAS. A `fillStyle` given
 *    `var(--primary)` is SILENTLY IGNORED: the context keeps the previous color, no error, and
 *    the panel comes out in a random tint. Verified in the browser on 2026-08-28. Hence
 *    `resolveToken` / `readInk` here, and a painter that reads nothing itself.
 * 3. PLAYBACK MUST STOP. The animation loop writes `frameRef` too; the two running at once
 *    would fight over the cursor and the export would paint whatever was left.
 *
 * # THE SCREEN IS NOT SPARED, AND THAT IS DELIBERATE
 *
 * The loop paints into the VISIBLE CANVAS. The user therefore sees the match scroll by very
 * fast during export — not a flaw but the only visible proof that something is happening, and
 * it avoids a second canvas the size of the first. At the end, whatever happens, the
 * pre-export frame is restored and repainted.
 *
 * # THE CLIP ALWAYS LOOKS THE SAME (2026-09-16, decisions D8/D9)
 *
 * Pure black background, and ALL inks — map, baked layers, thumbnails, panels — read from the
 * DARK theme (`layers/themeInk.ts`), without touching the page's own theme. The VISIBLE canvas
 * therefore shows the dark render during export (even in light theme): that is accepted, and
 * everything returns to the page's own inks at the end, on every path.
 *
 * # THE FILE COMES OUT AT THE CHOSEN FORMAT, NOT AT SCREEN SIZE (2026-09-16)
 *
 * During export, the canvas LAYS OUT inside the format's 16:9 frame (`exportFormats.ts`,
 * `exportLayoutStore.ts`) and renders at its density: 1920x1080 or 1280x720, regardless of the
 * window and `devicePixelRatio`. On screen, the canvas box does not change size: the 16:9
 * image is fit into it without distortion (`object-fit: contain`, see `ReplayView.screen`),
 * and the page returns to its screen layout at the end, on every path.
 *
 * # IN 3D
 *
 * The page's loaded 3D view lends itself to export (`replay3dExportStore`): the scene renders
 * each frame at the file's size, with the chosen camera and followed player, and
 * `export3dFrame` composes it with player labels, the optional 2D minimap, and the same end
 * panels. The frame plan, timestamps, and sound are the same as the 2D export's, at 60 frames
 * per second of match instead of 30 (`EXPORT_FPS_3D`; 30 only when the browser refuses 60, and
 * then the dialog says so). Each 3D frame is rendered to completion before it is encoded:
 * visible ragdolls baked (`ActionScene3d.settle`), and any model the frame asked for loaded,
 * then the frame rendered again (`exportPendingLoads`).
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import { meXUIDOf } from '@/features/match-view/xuidMeta'
import { resolveToken } from '@/lib/accessibility/resolveToken'
import { teamLogoPath } from '@/lib/halo/teamNames'
import type { MatchScoreboardRow } from '@/lib/api/types'
import type { FilmAllegiance } from '@/lib/replay/filmAllegiance'
import type { ReplayScoreDocument } from '@/lib/replay/scoreTimeline'



import { readInk } from '../layers/canvasInk'
import { yieldToEvents } from './eventLoopYield'
import {
  buildOverlayPanelSource,
  type ExportOutcome,
  type OverlayPanelSource,
} from './exportOverlayPanels'
import { paintOverlayPanel, type OverlayFonts, type OverlayInk } from './overlayPaint'
import { mixReplayAudio, soundUrlOf, type MixedTracks, type SoundFamily } from '../sound/replayAudioMix'
import { followedShieldReader } from '../sound/shieldSound'
import type { RenderHooks } from '../sound/mixRender'
import { listenerAtOfPlayer } from '../sound/soundListenerOf'
import { formatClock, frameToMs, msToFrames } from '../../../lib/replay/replayLogic'
import { buildCaptureFilename, holdDownload, type PendingDownload } from './replayCapture'
import { tintedIconCanvas } from '../layers/replayDraw'
import {
  END_HOLD_MS,
  buildExportPlan,
  buildScriptExportPlan,
  defaultExportBounds,
  exportProgressPct,
  type ExportBounds,
  type ExportPlan,
} from './replayExportPlan'
import { scriptClockOf, type CameraScript, type ScriptClockView } from '../scene3d/cameraScript3d'
import {
  normalizeMotionBlur,
  planShutterSteps,
  scriptShutterSteps,
  type MotionBlur,
  type ShutterStep,
} from './exportShutter'
import { setScriptPlaybackTime, startScript, stopScript } from '../scene3d/cameraScriptStore'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import {
  EXPORT_FPS,
  EXPORT_FPS_3D,
  canExportVideo,
  openVideoExport,
  exportPresetNameFromRaw,
  type ExportVideoPresetName,
  type VideoExportSink,
} from './replayVideoEncoder'
import type { ReplayWindowBounds } from '../model/replayWindow'
import {
  exportFormatOf,
  exportLayoutFor,
  type ExportFormat,
  type ExportFormatId,
  type ExportFraming,
} from './exportFormats'
import { canvasPixelRatio, requestExportLayout, waitForExportLayout } from './exportLayoutStore'
import { REPLAY_TEXT, type ReplayLocale } from '../i18n/i18n'
import type { ReplaySoundEvent } from '../sound/replaySoundVariants'
import type { EnginePlan } from '../sound/vehicleEngineSound'
import { readVictory } from '../model/victoryLogic'
import { make3dPainter, type Export3dOptions } from './export3dFrame'
import { replay3DExportEntry, type ExportCamera3d, type ExportSubframe3d, type Replay3DExportSource } from './replay3dExportStore'
import { createExportHud } from './exportHud'
import { clipWarning, summarizeClipping, type ClipSummary } from './clipMetric'
import type { ReplayKill } from '../model/killFeedLogic'

declare global {
  interface Window {
    /**
     * The app window's Go close guard (`it3dExportBusy` binding): while an export is running
     * the window asks before it closes. Absent in a plain browser tab.
     */
    it3dExportBusy?: (busy: boolean) => void
  }
}

/** How often progress is published, in encoded frames. */
const PROGRESS_EVERY = 15

/**
 * readExportPresetOverride — the developer's preset choice, read from localStorage so a
 * quality comparison can be measured WITHOUT editing code. The key is developer-facing, not
 * user-facing; an unknown name (or a throwing localStorage, e.g. private mode) yields
 * `undefined`, which `openVideoExport` turns into the one-line default.
 */
function readExportPresetOverride(): ExportVideoPresetName | undefined {
  try {
    return exportPresetNameFromRaw(window.localStorage.getItem('it3d-export-preset'))
  } catch {
    return undefined
  }
}

export interface ReplayExportOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>
  /** The current frame, SHARED with drawing: the loop writes it, `draw()` reads it. */
  frameRef: RefObject<number>
  /** Drawing one frame, as the canvas publishes it. */
  redraw: () => void
  /** Pauses playback. Called BEFORE the loop (see pitfall 3 of the header). */
  pause: () => void
  doc: ReplayDocumentReady & ReplayScoreDocument
  playWindow: ReplayWindowBounds | null
  scoreboard: readonly MatchScoreboardRow[]
  kills?: readonly ReplayKill[]
  timeLimitMs?: number | null
  /** The allegiance read from the film, from the viewpoint (`model.allegiance`): the end panel. */
  allegiance: FilmAllegiance
  /**
   * The match verdict, ALREADY completed with the word the screen shows (`viewedLabel`,
   * resolved by `useReplayCapture` from the title's mappings). `null` = no end screen, matching
   * the DOM.
   */
  outcome: ExportOutcome | null
  /**
   * THE PAGE'S VIEWPOINT (2026-09-06): the export renders WHAT THE SCREEN SHOWS (decision 12 of
   * the "timeline, viewpoint" plan) — including the victory panel. The person exporting chose
   * what they are watching. `null`: the page's own player.
   *
   * MANDATORY SINCE 2026-09-07 (F4 review, the chain's last link): `useReplayCapture` already
   * relays it, but it being optional here meant forgetting that relay stayed silent — the clip
   * would come out at the page player's side while the screen followed the chosen player.
   * Required, the omission is now a compile error.
   */
  viewpoint: string | null
  titleSlug: string
  locale: ReplayLocale
  /**
   * THE REPLAY'S SOUND TRACK, as the page plays it (`useReplaySound.exportTrack`). Absent =
   * silent clip. It is NOT rebuilt by the export: that is what guarantees a clip neither
   * invents nor drops any sound.
   */
  soundTrack?: () => {
    timeline: readonly ReplaySoundEvent[]
    endMatchStems: readonly string[]
    variationPercent: number
    distancePercent: number
    /** Which stems are voice, which are music (see `useReplaySound.exportTrack`). */
    families: { voice: readonly string[]; music: readonly string[] }
    /** The vehicles' ENGINE plan — continuous states, mixed by `vehicleEngineMix.ts`. */
    engines: readonly EnginePlan[]
  }
  /** The volume set in the page. The mix follows it, even with speakers muted (decision D6). */
  soundVolume?: number
  /**
   * THE SCREEN'S ZOOM LEVEL (1 = whole map). Only used by the DIALOG, which only offers a
   * framing choice on a zoomed map (decision D6 of the "video formats" plan). Absent: 1.
   */
  zoomLevel?: number
}

/** What the caller chooses when launching. Sound is INCLUDED by default (decision D6). */
export interface ExportRunOptions {
  sound?: boolean
  /** The file's format; absent -> the catalog's default (1080p, decision D2). */
  format?: ExportFormatId
  /** The map's framing; absent -> "whole map" (decision D6). */
  framing?: ExportFraming
  /**
   * Export the 3D VIEW (the page's loaded scene, see `replay3dExportStore`) instead of the 2D
   * map; absent -> 2D. Sound, the range, and the end panels do not change.
   */
  view3d?: Export3dOptions | null
  /**
   * CLEAN FRAME: no HUD, name tags, minimap or panels, the bare 3D image — footage that
   * gets graphics composited over it later. Applies to 3D exports only; ignored in 2D.
   */
  clean?: boolean
  /**
   * Export a CAMERA SCRIPT: the video covers the script from script time 0 to its length,
   * each film frame is sampled by the script's clock, and the free camera (and any held
   * players) is posed by the script at that time. 3D export only; ignored without a
   * `view3d`.
   */
  script?: CameraScript | null
  /**
   * MOTION BLUR (3D export only): each file frame is the average of `subframes` poses spread
   * over a `shutterDeg` shutter centered on the frame's time (`exportShutter.ts`). Absent, or one
   * subframe: a single pose per frame, exactly as without it.
   */
  motionBlur?: MotionBlur | null
  /**
   * SUPERSAMPLING (3D export only): the 3D frame renders at this many times the file's size on
   * each side and is filtered down to it. Absent or 1: the file's size.
   */
  supersample?: 1 | 2
}

/** The state the dialog shows. `total` is 0 until an export has started. */
/**
 * THE FIVE STATES OF AN EXPORT, and why they do not reduce to "running / not running".
 *
 * `prepare` is the one that was missing and cost the user the most: between the click and the
 * first encoded frame, it must wait for fonts, load the logo, DECODE every sound file, RENDER
 * the offline mix, and ENCODE the AAC track. On a match heavy with sound, that is several
 * seconds during which the bar showed "Frame 0 / 18000" without moving — exactly the moment
 * where one wonders whether it crashed.
 *
 * `done` was also missing: the dialog went back to the form and the file dropped into
 * downloads without a word saying so.
 */
export type ExportPhase = 'idle' | 'prepare' | 'encode' | 'done' | 'failed'

/** The sound step of the preparation, with its share done (`ReplayExportState.prepareStep`). */
export interface PrepareStep {
  stage: 'mix' | 'audio'
  pct: number
}

/**
 * One file frame's camera, as it drew the encoded image: `i` the file frame, `frame` the film
 * frame shown, `scriptMs` the script time (camera-script export) or null. World coordinates.
 */
export interface CameraTrackSample extends ExportCamera3d {
  i: number
  frame: number
  scriptMs: number | null
  /** Percent of the frame clipped to white (`clipMetric.clippedPct`); absent when not measured. */
  clippedPct?: number
  /** The highlight ceiling the frame was drawn with, in stops (0 or less; `highlightCeiling3d`); null while off. */
  ceilingStops?: number | null
}

export interface ReplayExportState {
  phase: ExportPhase
  done: number
  total: number
  pct: number
  /**
   * ESTIMATED time remaining, in milliseconds, or `undefined` until any frame is encoded.
   * Reliable here because the cost per frame is very regular: same canvas, same encoder, and
   * drawing whose cost does not depend on the match's instant.
   */
  etaMs?: number
  /** The name of the file ready to download, in the `done` phase. */
  filename?: string
  /** The ready download: the clip, its URL, and the one-click `save`. Absent outside `done`. */
  save?: PendingDownload
  /** `done`, 3D export: the camera of every file frame, in file order (`CameraTrackSample`). */
  cameraTrack?: readonly CameraTrackSample[]
  /** `done`, 3D export: the clip's clipped-to-white summary (`clipMetric.summarizeClipping`). */
  clipping?: ClipSummary
  /**
   * `true` = sound was requested but the browser REFUSED the track: the clip is silent, and
   * that must be said. A silent clip believed to have sound is discovered only at editing time.
   */
  mutedFallback?: boolean
  /** The failure's technical message, for the console and for the knowledgeable user. */
  message?: string
  /** The rate the clip is encoded at, once the encoder is open (`encode` and `done`). */
  fps?: number
  /**
   * `true` = the 3D clip was meant for 60 fps and the browser refused that rate at this size: it
   * is encoded at 30, and the dialog SAYS so.
   */
  fpsFallback?: boolean
  /**
   * In `prepare`, once the sound work starts: which step runs (the offline MIX, then the AAC
   * ENCODING of its tracks) and its share done, 0..100. Kept apart from `pct`, which counts
   * encoded frames only.
   */
  prepareStep?: PrepareStep
}

export interface ReplayExport {
  /** `false` = no WebCodecs: real-time recording takes over instead. */
  supported: boolean
  state: ReplayExportState
  /** The default proposed range: the whole gameplay window. */
  defaultBounds: () => ExportBounds
  run: (bounds: ExportBounds, options?: ExportRunOptions) => Promise<void>
  /**
   * Drops the `done` phase's clip into the downloads folder. The CALLER must invoke it from a
   * click: a click on an anchor dropped by code, minutes after the user's last gesture, no
   * longer has a gesture behind it, and Chrome blocks a site's second unrequested file.
   * `no-op` outside `done` (nothing to save, nothing to revoke).
   */
  saveDone: () => void
  /**
   * Releases the clip without dropping it: revokes the object URL and returns to the idle
   * state. Called when the user closes the dialog without saving — a blob nobody can save
   * anymore must be returned to the collector, not kept in memory.
   */
  discardDone: () => void
  /** The screen's zoom level, relayed for the dialog (see `ReplayExportOptions.zoomLevel`). */
  zoomLevel: number
  cancel: () => void
  /**
   * The PLAYBACK time of a frame, ready to show: the same clock as the transport bar
   * (`PlayerTransport`, `ScrubBar`), counted from the film's first frame. Not the match clock:
   * the user picks a range against the bar they just scrubbed.
   */
  clockOf: (frame: number) => string
  /** The CLIP's duration for these bounds, formatted. Same reason, same place. */
  lengthClock: (bounds: ExportBounds) => string
}

const IDLE: ReplayExportState = { phase: 'idle', done: 0, total: 0, pct: 0 }

/** Number of encoded frames before an estimate is risked: below this, it would jitter. */
const ETA_MIN_FRAMES = 30

/** The theme's inks, resolved ONCE per export (see pitfall 2 of the header). */
function readOverlayInk(): OverlayInk {
  return {
    background: readInk('--background'),
    foreground: readInk('--foreground'),
    muted: readInk('--muted-foreground'),
    border: readInk('--border'),
    card: readInk('--card'),
  }
}

/** The page's font families. The fallback is only reached if the theme loses its vars. */
function readOverlayFonts(): OverlayFonts {
  const root = getComputedStyle(document.documentElement)
  const sans = root.getPropertyValue('--sans').trim()
  const mono = root.getPropertyValue('--mono').trim()
  return { sans: sans || 'system-ui, sans-serif', mono: mono || 'ui-monospace, monospace' }
}

/** Loads the watermark and TINTS it. `null` everywhere else: the panel stays complete. */
async function loadTeamLogo(
  titleSlug: string,
  teamID: number | null | undefined,
  color: string,
): Promise<HTMLCanvasElement | null> {
  const src = teamLogoPath(titleSlug, teamID)
  if (!src) return null
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const el = new Image()
    el.onload = () => resolve(el)
    // A `team_id` with no published asset answers 404: silence, no watermark, no error.
    el.onerror = () => resolve(null)
    el.src = src
  })
  return img ? tintedIconCanvas(img, color) : null
}

/** Prepares everything that stays the same from one frame to the next. Outside React: no state here. */
async function buildSource(o: ReplayExportOptions, ink: OverlayInk): Promise<OverlayPanelSource> {
  // THE COLOR IS THE ONE THE USER SET (DOM decision D1): the end screen is ALWAYS that of
  // their own side, so always `team-ally`, overridable by accessibility settings.
  const teamColor = resolveToken('team-ally')
  const victory = readVictory(o.allegiance, o.outcome?.code, meXUIDOf(o.scoreboard), o.viewpoint)
  const logo = victory?.mine
    ? await loadTeamLogo(o.titleSlug, victory.mine.teamID, teamColor)
    : null
  const tint = { background: `color-mix(in oklab, ${teamColor} 22%, transparent)`, border: `color-mix(in oklab, ${teamColor} 55%, transparent)` }
  return buildOverlayPanelSource({
    doc: o.doc,
    scoreboard: o.scoreboard,
    allegiance: o.allegiance,
    playWindow: o.playWindow,
    outcome: o.outcome,
    viewpoint: o.viewpoint,
    locale: o.locale,
    ink,
    teamStyle: { background: tint.background, border: tint.border },
    logo,
  })
}

/**
 * Paints ONE export frame: the map, the overlay if there is one, then the BACKDROP.
 *
 * THE BACKDROP IS LAID DOWN LAST, UNDERNEATH (`destination-over`). The 16:9 frame overflows
 * the map whenever their proportions differ, and the canvas there is TRANSPARENT: H.264 has no
 * alpha channel, and what a transparent pixel becomes in a `VideoFrame` depends on the
 * browser. The backdrop is therefore PAINTED, and it is PURE BLACK regardless of the theme
 * (`--replay-export-backdrop`, decision D8): a file does not change appearance based on the
 * interface preference of whoever exported it.
 */
function paintExportFrame(
  canvas: HTMLCanvasElement,
  o: ReplayExportOptions,
  source: OverlayPanelSource,
  paint: OverlayPaintContext,
  frame: number,
): void {
  o.frameRef.current = frame
  o.redraw()
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  // THE SCALING IS RESET HERE, never assumed: `draw()` sets it at the start of its own pass,
  // but nothing guarantees what state its layers leave it in. SAME DENSITY AS THE MAP'S OWN
  // DRAW — the format's: the overlay lays out in the same logical frame.
  const dpr = canvasPixelRatio()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  paintPanel(ctx, { width: canvas.width / dpr, height: canvas.height / dpr }, source, paint, frame)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'destination-over'
  ctx.fillStyle = paint.backdrop
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.globalCompositeOperation = 'source-over'
}

/** The frame's panel, if there is one, in the logical frame (context already at density). */
function paintPanel(
  ctx: CanvasRenderingContext2D,
  view: { width: number; height: number },
  source: OverlayPanelSource,
  paint: OverlayPaintContext,
  frame: number,
): void {
  const panel = source.panelAt(frame)
  if (panel) paintOverlayPanel(ctx, view, panel, paint.fonts, paint.ink)
}

/** Paints frame `frame` and returns the canvas to encode, once that frame is completely drawn. */
type FramePainter = (frame: number, index?: number) => HTMLCanvasElement | Promise<HTMLCanvasElement>

/**
 * How many times one 3D frame may wait for loads and render again. A frame normally waits once
 * at most (a model it asked for); the bound only stops a loader that keeps starting new loads.
 */
const MAX_LOAD_WAITS = 4

/**
 * renderComplete renders the 3D frame `frame` and, while the scene still has loads in flight
 * that this frame asked for, waits for them and renders it AGAIN: a model landing one frame late
 * would otherwise pop in mid-clip. A timed-out wait is reported and the frame is kept.
 */
export async function renderComplete(
  paint: (frame: number, index?: number) => HTMLCanvasElement,
  scene: Pick<Replay3DExportSource, 'exportPendingLoads'>,
  frame: number,
  index?: number,
): Promise<HTMLCanvasElement> {
  let canvas = paint(frame, index)
  for (let i = 0; i < MAX_LOAD_WAITS; i++) {
    const pending = scene.exportPendingLoads()
    if (!pending) return canvas
    if (await pending) console.warn(`[replay-export] 3D loads still pending at frame ${frame}, encoding it as is`)
    canvas = paint(frame, index)
  }
  return canvas
}

/** The 3D scene taken for the export, and what is asked of it. */
interface Scene3dRun {
  scene: Replay3DExportSource
  format: ExportFormat
  view3d: Export3dOptions
  /** The script time of each file frame, for a camera-script export; null otherwise. */
  scriptMs: number[] | null
  /** Filled by the painter: the camera of each file frame, once its image is final. */
  track: CameraTrackSample[]
  /** Motion blur: the subframe steps of file frame `index`; null without blur. */
  shutter?: ((index: number) => ShutterStep[]) | null
}

/**
 * take3dScene takes the page's 3D scene for the export (see `replay3dExportStore`). Throws if
 * the requested 3D view is no longer loaded: the export says so, it does not fall back to a
 * 2D export instead.
 */
function take3dScene(view3d: Export3dOptions, format: ExportFormat, frame: number, frameMs: number, supersample: 1 | 2): Replay3DExportSource {
  const entry = replay3DExportEntry()
  if (!entry) throw new Error('3D view is not loaded')
  entry.source.beginExport({
    width: format.width,
    height: format.height,
    camera: view3d.camera,
    pov: view3d.pov,
    frame,
    frameMs,
    supersample,
  })
  return entry.source
}

/**
 * shutterOf: the subframe steps of each file frame of `plan` under `blur`. A camera-script plan
 * spreads them in SCRIPT time and maps each to its film frame with the script's clock, the
 * plan's own conversion; a plain plan interpolates the film frame toward the next plan frame.
 */
function shutterOf(
  blur: MotionBlur,
  plan: ExportPlan & { scriptMs?: number[] },
  clock: ScriptClockView | null,
  doc: ReplayDocumentReady,
): (index: number) => ShutterStep[] {
  const scriptMs = plan.scriptMs
  if (clock && scriptMs) {
    const frameAt = (s: number) => msToFrames(clock.docMsAt(s), doc)
    return (i) => scriptShutterSteps(scriptMs[i], plan.frames[i], blur, plan.fps, clock.lengthMs, frameAt)
  }
  return (i) => planShutterSteps(plan.frames, i, blur)
}

/**
 * subframesOf hands a frame's steps to the scene: a camera-script step sets the script's time
 * right before it is posed, so the camera and any held player move within the shutter too.
 */
function subframesOf(steps: readonly ShutterStep[]): ExportSubframe3d[] {
  return steps.map((s) => {
    const sMs = s.scriptMs
    return { frame: s.frame, render: s.render, center: s.center, before: sMs === null ? undefined : () => setScriptPlaybackTime(sMs) }
  })
}

/**
 * framePainter: the page's 2D canvas (map, panel, backdrop), or the 3D scene composed by
 * `export3dFrame`, with the same frame's 2D map as a minimap when requested.
 */
async function framePainter(
  canvas: HTMLCanvasElement,
  o: ReplayExportOptions,
  overlay: { source: OverlayPanelSource; paint: OverlayPaintContext },
  scene3d: Scene3dRun | null,
  clean: boolean,
): Promise<FramePainter> {
  const { source, paint } = overlay
  if (!scene3d) {
    return (frame) => {
      paintExportFrame(canvas, o, source, paint, frame)
      return canvas
    }
  }
  // The followed player's HUD at the screen's level (`hudLevel`): first person draws the aim
  // (reticle, ADS overlays); both draw the place label from the areas the view already loaded.
  // A clean frame carries no HUD at all.
  const scene = scene3d.scene
  const shutter = scene3d.shutter ?? null
  const hud = !clean && scene3d.view3d.pov
    ? await createExportHud(o.doc, scene3d.view3d.pov, o.kills ?? [], o.playWindow, o.timeLimitMs ?? null, o.locale, {
        aim: scene3d.view3d.camera === 'fp',
        callouts: replay3DExportEntry()?.callouts ?? null,
        redReticle: scene.redReticle ? (frame, allegiance, held) => scene.redReticle?.(frame, allegiance, held) ?? false : undefined,
        frameSize: { width: scene3d.format.width, height: scene3d.format.height },
      })
    : null
  const painter = make3dPainter({
    source: scene3d.scene,
    format: scene3d.format,
    pixelRatio: canvasPixelRatio(),
    ink: { background: paint.ink.background, foreground: paint.ink.foreground },
    font: paint.fonts.sans,
    map2d: scene3d.view3d.minimap
      ? () => {
          o.redraw()
          return canvas
        }
      : null,
    overlay: (ctx, view, frame) => { hud?.(ctx, view, frame); paintPanel(ctx, view, source, paint, frame) },
    clean,
    // Motion blur: the frame's subframes, from its file index (a frame painted without one is a
    // single pose).
    subframes: shutter ? (_frame, index) => (index === undefined ? null : subframesOf(shutter(index))) : undefined,
  })
  const scriptMs = scene3d.scriptMs
  return async (frame, index) => {
    // A script export poses the camera at the SAME script time the world is sampled at.
    if (scriptMs && index !== undefined) setScriptPlaybackTime(scriptMs[index])
    // The current frame advances in 3D too: the transport bar and the 2D map follow it.
    o.frameRef.current = frame
    const image = await renderComplete(painter, scene3d.scene, frame, index)
    // THE CAMERA TRACK is read once the image is final (a frame re-rendered after a load wait
    // is posed again the same way): what is recorded is what the encoded frame saw from.
    const cam = scene.exportCamera?.()
    if (cam) {
      const i = index ?? scene3d.track.length
      // The frame's exposure record (clipped share, highlight ceiling) rides on its camera sample.
      const exposure = scene.exportExposure?.() ?? null
      scene3d.track[i] = {
        i,
        frame,
        scriptMs: scriptMs && index !== undefined ? scriptMs[index] ?? null : null,
        ...cam,
        ...(exposure ? { clippedPct: exposure.clippedPct, ceilingStops: exposure.ceilingStops } : {}),
      }
    }
    return image
  }
}

export function useReplayExport(o: ReplayExportOptions): ReplayExport {
  const [state, setState] = useState<ReplayExportState>(IDLE)
  const cancelRef = useRef(false)
  const runningRef = useRef(false)
  // THE `done` PHASE'S CLIP, ready to download but NOT YET DROPPED: the click that starts
  // the download must come from the user (see `saveDone`), and it is `releaseDone`
  // that releases it if the dialog closes without one.
  const pendingRef = useRef<PendingDownload | null>(null)
  // UNMOUNTING CANCELS, AND DOWNLOADS NOTHING. Same invariant as the real-time recording right
  // next to it (`useReplayCapture`, `liveRef`): leaving a match's page during an export must
  // not drop, three minutes later, the file of a match that was left behind.
  const liveRef = useRef(true)
  useEffect(() => {
    liveRef.current = true
    return () => {
      liveRef.current = false
      cancelRef.current = true
      // A clip waiting to be saved, on a page that is unmounting: released, not kept.
      pendingRef.current?.release()
      pendingRef.current = null
    }
  }, [])

  // The app window's close guard: while an export is running (`prepare` or `encode`), the
  // Go side asks before the window closes. Every other phase reports not running.
  useEffect(() => {
    window.it3dExportBusy?.(state.phase === 'prepare' || state.phase === 'encode')
  }, [state.phase])

  const cancel = useCallback(() => {
    cancelRef.current = true
  }, [])

  /** Releases the waiting clip: revokes the URL and returns to the idle state. */
  const releaseDone = useCallback(() => {
    pendingRef.current?.release()
    pendingRef.current = null
    setState(IDLE)
  }, [])

  const saveDone = useCallback(() => {
    pendingRef.current?.save()
  }, [])

  const discardDone = useCallback(() => {
    releaseDone()
  }, [releaseDone])

  const defaultBounds = useCallback(
    () => defaultExportBounds(o.doc, o.playWindow),
    [o.doc, o.playWindow],
  )

  const run = useCallback(
    async (bounds: ExportBounds, options?: ExportRunOptions) => {
      const canvas = o.canvasRef.current
      // `runningRef` is set SYNCHRONOUSLY, before the slightest `await`: that is what makes a
      // double-click on "Export" harmless.
      if (!canvas || runningRef.current || !canExportVideo()) return
      runningRef.current = true
      cancelRef.current = false
      // A clip from the PREVIOUS export may still be held (dialog closed without Save or
      // Discard, then a new export): release it now, or the old blob would leak in memory
      // until the tab closes.
      pendingRef.current?.release()
      pendingRef.current = null
      o.pause()
      // THE PRE-EXPORT FRAME is set aside NOW: the loop is about to write `frameRef` thousands
      // of times, and the user must get their replay back where they left it.
      const resume = o.frameRef.current
      const format = exportFormatOf(options?.format)
      // A camera script drives the FREE camera only: when one is given, this run uses
      // 'free' no matter which camera the dialog picked, and it is a 3D export (the script
      // is ignored without a `view3d`).
      const script = options?.script && options.view3d ? options.script : null
      const view3d =
        script && options?.view3d
          ? { ...options.view3d, camera: 'free' as const }
          : options?.view3d ?? null
      // THE RATE: 60 for the 3D view, 30 for the 2D map (cf. `EXPORT_FPS_3D`). The encoder may
      // refuse 60 at this size; it then falls back to 30 and the dialog says so.
      const wantedFps = view3d ? EXPORT_FPS_3D : EXPORT_FPS
      // The script's DOCUMENT range: the film time at script time 0 to the film time at its
      // length. It drives the sound mix and the file name; the frames themselves come from
      // the script's own plan.
      const clock = script ? scriptClockOf(script) : null
      const mixBounds =
        script && clock
          ? { startFrame: msToFrames(clock.docMsAt(0), o.doc), endFrame: msToFrames(clock.docMsAt(clock.lengthMs), o.doc) }
          : bounds
      // A script whose clock slows, freezes or speeds the film cannot carry its sound: the
      // clip's time and the match's time no longer run together, so the clip is silent.
      const scriptSilent = script !== null && (script.clock?.rates ?? []).some((r) => r.rate !== 1)
      // A first plan WITHOUT the hold: it gives the range's duration, which the mix needs.
      let plan: ExportPlan = script ? buildScriptExportPlan(script, o.doc, wantedFps) : buildExportPlan(bounds, o.doc, wantedFps)
      // PHASE 1: preparation. The bar does not show "frame 0" — it says what is happening.
      setState({ phase: 'prepare', done: 0, total: plan.frames.length, pct: 0 })
      let sink: VideoExportSink | null = null
      // The 3D scene taken for the export, returned to the screen in the `finally`.
      let scene3d: Replay3DExportSource | null = null
      try {
        // THE CANVAS IS CLAIMED AS SOON AS PREPARATION STARTS (decision D7): the request shuts
        // off framing gestures and hover right away, not only once sounds are decoded — a zoom
        // dragged during preparation would otherwise change the clip's framing.
        requestExportLayout(exportLayoutFor(format, options?.framing))
        // Fonts BEFORE the first frame: without this wait, the clip's start would write
        // overlays in a fallback font, and the rest in the right one.
        await document.fonts.ready
        // THE INKS ARE READ AFTER THE REQUEST: by then they are the DARK THEME's (decision D9,
        // see `themeInk.ts`), like the map's own inks that React re-resolves at the same moment.
        const ink = readOverlayInk()
        const fonts = readOverlayFonts()
        const backdrop = readInk('--replay-export-backdrop')
        const source = await buildSource(o, ink)
        // SOUND IS MIXED BEFORE THE CONTAINER OPENS: the MP4 declares its tracks once and for
        // all, so it must be known BEFORE whether there will be one. The offline mix is fast
        // (it plays nothing, it computes), and it returns `null` if there is nothing to mix.
        // THE CANVAS SWITCHES TO THE FILE'S FORMAT (2026-09-16): laid out in the format's 16:9
        // frame and rendered at its density (`exportLayoutFor`), the screen and its
        // `devicePixelRatio` no longer enter anywhere. The layout (requested at the top of the
        // `try`) goes through a React render: we WAIT for the canvas to actually be at the
        // format before opening the encoder — hence the order: request, wait, open.
        await waitForExportLayout(canvas, format, o.redraw)
        const mix = options?.sound === false || scriptSilent
          ? null
          : await mixExportAudio(o, mixBounds, plan, view3d, {
              cancelled: () => cancelRef.current,
              progress: prepareProgress(setState, plan.frames.length, 'mix'),
            })
        if (cancelRef.current) return void setState(IDLE) // Cancel during the preparation (the mix reads it at each step and stops): stop before encoding; `finally` restores.
        // The hold (see `holdMsFor`) depends only on durations: it is computed from the first plan.
        const holdMs = holdMsFor(o, mixBounds, plan, mix)
        sink = await openVideoExport({
          width: format.width,
          height: format.height,
          fps: wantedFps,
          fallbackFps: view3d ? EXPORT_FPS : undefined,
          preset: readExportPresetOverride(),
          audioTracks: mix ? trackNames(mix, o.locale) : undefined,
        })
        if (!sink) {
          // Configuration rejected by the browser: not a failure, a missing capability — but
          // the user must see it, not watch a bar disappear without a word.
          fail(setState, 'Video configuration rejected by the browser')
          return
        }
        // THE PLAN IS REBUILT AT THE RATE THE ENCODER ACCEPTED, with the hold: the last frame
        // must stay long enough to read the verdict, and at least as long as the sound keeps
        // playing. The file timestamps are `index / fps`, so the plan and the encoder MUST
        // share one rate, or the clip would play at the wrong speed.
        const fps = sink.fps
        const fpsFallback = sink.fpsFallback
        plan = script ? buildScriptExportPlan(script, o.doc, fps, holdMs) : buildExportPlan(bounds, o.doc, fps, holdMs)
        // SOUND REQUESTED BUT IMPOSSIBLE DOES NOT STAY SILENT ABOUT IT: the browser can have the
        // API and still REFUSE the AAC configuration. The clip comes out silent — better than a
        // lost export — and the final phase says so.
        const muted = mix !== null && !sink.audioEnabled
        if (muted) console.warn('[replay-export] Audio track rejected by the browser, clip is silent')
        if (mix && sink.audioEnabled) {
          await sink.addAudioTracks(exportTracks(mix, o.locale), prepareProgress(setState, plan.frames.length, 'audio'))
        }
        // The 3D scene is only taken here, at the last moment: the screen's own view stays
        // alive during preparation.
        // Film quality (3D only): motion blur and supersampling. Off, the frame is the single
        // pose at the file's size, exactly as before they existed.
        const blur = view3d ? normalizeMotionBlur(options?.motionBlur) : null
        const supersample = view3d && options?.supersample === 2 ? 2 : 1
        if (view3d) scene3d = take3dScene(view3d, format, mixBounds.startFrame, frameToMs(1, o.doc), supersample)
        const track: CameraTrackSample[] = []
        const painter = await framePainter(
          canvas,
          o,
          { source, paint: { ink, fonts, backdrop } },
          scene3d && view3d
            ? {
                scene: scene3d,
                format,
                view3d,
                scriptMs: script ? (plan as ExportPlan & { scriptMs: number[] }).scriptMs : null,
                track,
                shutter: blur ? shutterOf(blur, plan, clock, o.doc) : null,
              }
            : null,
          options?.clean === true,
        )
        // The script starts NOW, at script time 0: every painted frame sets its own script
        // time afterwards (the painter reads it from the frame index).
        if (script) startScript(script, 0)
        // PHASE 2: encoding. Only here does the frame count mean something, and the remaining
        // time can be estimated.
        const total = plan.frames.length
        const start = performance.now()
        setState({ phase: 'encode', done: 0, total, pct: 0, fps, fpsFallback })
        const ok = await encodeAll(painter, plan.frames, {
          cancelled: () => cancelRef.current,
          progress: (done) =>
            setState({
              phase: 'encode',
              done,
              total,
              pct: exportProgressPct(done, total),
              etaMs: etaFor(done, total, performance.now() - start),
              fps,
              fpsFallback,
            }),
          sink,
        })
        const clip = ok ? await sink.finish() : null
        // `sink` is only released ONCE `finish()` has closed it. On cancellation it stays here,
        // and it is the `finally` that abandons it — otherwise the encoder and its muxer would
        // stay open after a click on "Cancel".
        if (ok) sink = null
        // UNMOUNTING DOES NOT DOWNLOAD: the clip is assembled (the encoder must be drained
        // cleanly no matter what) but it does not go to a tab that has moved to another page.
        const filename = exportFilename(o, mixBounds)
        // THE CLIP IS ASSEMBLED, BUT NOTHING LEAVES YET: minutes after the export click, a
        // click on an anchor dropped by code no longer has a gesture behind it, and Chrome
        // blocks a site's second unrequested file. The clip waits for the "Save" button of the
        // `done` phase — and it is the dialog's closing, NOT this `finally`, that releases it
        // if it was not saved. The `finally` only releases what is still PENDING from a
        // running export (error, cancellation): releasing it here, on the successful path,
        // would kill the download just triggered by a click that just happened.
        if (clip) pendingRef.current = liveRef.current ? holdDownload(clip, filename) : null
        if (!clip) pendingRef.current?.release()
        if (!clip) pendingRef.current = null
        // THE CLIPPING CHECK: how much of each 3D frame was blown to white (`clipMetric`), said in
        // the console when a frame passes the threshold, and handed on with the camera track.
        const clipping = clip ? summarizeClipping(track) : null
        const clipWarn = clipWarning(clipping)
        if (clipWarn) console.warn(clipWarn)
        // PHASE 3: the file is READY, and it is SAID, with its name. A cancellation, instead,
        // returns to the form — there is nothing to announce about a gesture just undone.
        setState(clip ? { phase: 'done', done: total, total, pct: 100, filename, save: pendingRef.current ?? undefined, cameraTrack: track.length > 0 ? track : undefined, clipping: clipping ?? undefined, mutedFallback: muted, fps, fpsFallback } : IDLE)
      } catch (err) {
        // NEVER A SILENT FAILURE (repo rule 3: log BEFORE any degradation). Without this
        // block, an encoder failure made the progress bar disappear without a word, without a
        // file, and without a trace — and left the encoder open until the tab closed.
        console.error('[replay-export] Export interrupted', err)
        fail(setState, err instanceof Error ? err.message : String(err))
      } finally {
        // THE SCREEN LAYOUT COMES BACK, on EVERY path: left in place, the page would stay
        // drawn at the format's frame until the next remount. The draw below restores the
        // previous frame; the React render that follows repaints it at screen size.
        requestExportLayout(null)
        scene3d?.endExport()
        if (script) stopScript()
        // THE ENCODER CLOSES ON EVERY PATH: `sink` is only set back to `null` once the file is
        // assembled. If it is still here, it is because the function exits via an error or a
        // cancellation, and it would hold an entire muxer in memory.
        sink?.abort()
        runningRef.current = false
        o.frameRef.current = resume
        o.redraw()
      }
    },
    [o],
  )

  const clockOf = useCallback(
    (frame: number) => formatClock(frameToMs(frame, o.doc)),
    [o.doc],
  )
  const lengthClock = useCallback(
    (b: ExportBounds) => formatClock(frameToMs(b.endFrame, o.doc) - frameToMs(b.startFrame, o.doc)),
    [o.doc],
  )

  const zoomLevel = o.zoomLevel ?? 1
  return { supported: canExportVideo(), state, defaultBounds, run, saveDone, discardDone, cancel, clockOf, lengthClock, zoomLevel }
}

/**
 * fail sets the failure state. The export stops, but the dialog STAYS open and says so — this
 * is the only difference that matters between "it did not work" and "nothing happened".
 */
function fail(setState: (s: ReplayExportState) => void, message: string): void {
  setState({ phase: 'failed', done: 0, total: 0, pct: 0, message })
}

/**
 * prepareProgress publishes a sound step's progress in the `prepare` phase, once per whole
 * percent: the mix reports every two seconds of track, far more often than the bar can show.
 */
function prepareProgress(
  setState: (s: ReplayExportState) => void,
  total: number,
  stage: PrepareStep['stage'],
): (fraction: number) => void {
  let shown = -1
  return (fraction) => {
    const pct = Math.min(100, Math.floor(fraction * 100))
    if (pct === shown) return
    shown = pct
    setState({ phase: 'prepare', done: 0, total, pct: 0, prepareStep: { stage, pct } })
  }
}

/**
 * etaFor estimates the time remaining from the rate ALREADY observed.
 *
 * `undefined` below `ETA_MIN_FRAMES`: an estimate built on three frames would jump by a factor
 * of ten at every refresh, and an estimate that jumps around is worse than no estimate.
 */
function etaFor(done: number, total: number, elapsedMs: number): number | undefined {
  if (done < ETA_MIN_FRAMES || elapsedMs <= 0) return undefined
  return Math.max(0, Math.round((elapsedMs / done) * (total - done)))
}

/**
 * The two halves of the paint, GROUPED TOGETHER: they always travel together, and separating
 * them pushed four signatures to six parameters (the repo's threshold: five).
 */
interface OverlayPaintContext {
  ink: OverlayInk
  fonts: OverlayFonts
  /** The video's backdrop, under the whole frame (see `paintExportFrame`). */
  backdrop: string
}

/** What the loop needs beyond the frames: where to push, and when to stop. */
interface EncodeHooks {
  cancelled: () => boolean
  progress: (done: number) => void
  sink: { addFrame: (c: HTMLCanvasElement, i: number) => Promise<void> }
}

/**
 * encodeAll walks the plan. OUTSIDE the hook (repo's 80-line rule) and outside React: it
 * touches no state, it publishes through a callback.
 *
 * Returns `false` if the user cancelled — that is what decides, for the caller, between
 * handing back a file and handing back none.
 */
async function encodeAll(
  paint: FramePainter,
  frames: readonly number[],
  hooks: EncodeHooks,
): Promise<boolean> {
  for (let i = 0; i < frames.length; i++) {
    if (hooks.cancelled()) return false
    // The frame is complete before it is handed over (`renderComplete` in 3D): `addFrame` reads
    // the canvas as it is, and the index alone gives its timestamp. The index also reaches
    // the painter: a camera-script export sets the script's time from it.
    await hooks.sink.addFrame(await paint(frames[i], i), i)
    if (i % PROGRESS_EVERY !== 0) continue
    hooks.progress(i)
    // CONTROL RETURNS TO THE PAGE HERE, through the unthrottled channel: without this, the
    // progress bar would never paint, and "Cancel" would never be read.
    await yieldToEvents()
  }
  hooks.progress(frames.length)
  return true
}

/**
 * exportFilename names the clip on BOTH its bounds (plan decision D9).
 *
 * The capture's `filenameFor` only knows one instant — `frameRef`'s, which equals the END
 * bound at the moment the file ships. Two exports of different ranges sharing their end would
 * then carry the same name and overwrite each other in the downloads folder.
 */
function exportFilename(o: ReplayExportOptions, bounds: ExportBounds): string {
  return buildCaptureFilename(
    o.doc.matchId,
    frameToMs(bounds.startFrame, o.doc),
    'mp4',
    new Date(),
    frameToMs(bounds.endFrame, o.doc),
  )
}

/**
 * mixExportAudio renders the range's sound track, or `null` if there is nothing to mix.
 *
 * THE BOUNDS ARE PASSED IN FILM MILLISECONDS, not in frames: the sound track is timestamped on
 * the replay's own clock (the one the feed and the sheets use), never on the frame axis.
 */
async function mixExportAudio(
  o: ReplayExportOptions,
  bounds: ExportBounds,
  plan: ExportPlan,
  view3d: Export3dOptions | null,
  hooks: RenderHooks,
): Promise<MixedTracks | null> {
  // THE TRACK IS READ HERE, at launch: it carries instance settings that live in refs, and
  // reading them at render time would yield arbitrary values.
  const track = o.soundTrack?.()
  // A track with no event but with a vehicle ENGINE in the range still gets mixed.
  if (!track || (track.timeline.length === 0 && track.engines.length === 0)) return null
  // THE MIX'S LISTENER: the 3D clip follows a player, and that player is the one listening
  // (position and heading at every instant, see `soundListenerOf`) — the clip's sound must
  // hear what its frames show. A 2D export has no listener, like the page in 2D: the mix
  // stays as it was.
  const pov = view3d ? (view3d.pov ?? o.viewpoint) : null
  // THE FOLLOWED PLAYER'S SHIELD: the alarms of THEIR OWN bar, which the page plays in FIRST
  // PERSON. The clip carries them only when it follows that player's own eye: a third-person
  // or free-camera export has no bar to sound.
  // The followed player is `pov`: an export of the default player has no `view3d.pov`.
  const shield = view3d?.camera === 'fp' && pov ? followedShieldReader(o.doc, pov) : null
  const startMs = frameToMs(bounds.startFrame, o.doc)
  return mixReplayAudio(
    track.timeline,
    { startMs, endMs: startMs + plan.durationMs },
    {
      variationPercent: track.variationPercent,
      distancePercent: track.distancePercent,
      // THE CONCLUSION IS SUPPLIED ONLY IF THE RANGE TRULY REACHES THE MATCH'S END. Without
      // this guard, a clip of minutes 2 to 4 would end on the announcer's voice and the
      // victory fanfare: the sound would assert a fact about the clip that was false.
      endMatchStems: reachesMatchEnd(o, bounds) ? track.endMatchStems : [],
      families: track.families,
      engines: track.engines,
      ...(shield ? { shield: { reader: shield, frameMs: frameToMs(1, o.doc) } } : {}),
      listenerAt: pov ? listenerAtOfPlayer(o.doc, pov) : undefined,
      volume: o.soundVolume ?? 1,
      urlOf: soundUrlOf,
      trimToBounds: !reachesMatchEnd(o, bounds),
      hooks,
    },
  )
}

/**
 * holdMsFor — how long the LAST frame must stay on screen, after the range ends.
 *
 * TWO REASONS, and the longer one wins. (1) The match's end screen is only painted AT the
 * bound: without a hold, the clip would end on a 1/30 s flash of the verdict. (2) Sound often
 * overflows the bound — an ending fanfare can run up to 11 s — and a sound track still playing
 * after the last frame leaves the viewer on a dead screen.
 *
 * Neither applies to a silent mid-match clip: it stops cold, which is the expected behavior
 * for a clip.
 */
function holdMsFor(
  o: ReplayExportOptions,
  bounds: ExportBounds,
  plan: ExportPlan,
  mix: MixedTracks | null,
): number {
  const verdict = reachesMatchEnd(o, bounds) ? END_HOLD_MS : 0
  const sound = mix ? mix.full.duration * 1000 - plan.durationMs : 0
  return Math.max(verdict, sound, 0)
}

/**
 * reachesMatchEnd — does the range go all the way to the end of the MATCH?
 *
 * Without an established gameplay window, there is no way to know where the match ends: the
 * answer is NO. Laying a victory fanfare over a range of unknown end-ness would assert
 * something that is not known.
 */
function reachesMatchEnd(o: ReplayExportOptions, bounds: ExportBounds): boolean {
  if (!o.playWindow) return false
  return bounds.endFrame >= o.playWindow.endFrame
}

/**
 * THE TRACKS' NAMES, AND THEIR ORDER. THE FULL MIX FIRST — it is the only one an ordinary
 * player plays, and a browser does not even expose the others. The families follow, for
 * whoever opens the clip in an editor.
 */
function exportTracks(mix: MixedTracks, locale: ReplayLocale): { name: string; buffer: AudioBuffer }[] {
  const t = REPLAY_TEXT[locale]
  const names: Record<SoundFamily, string> = {
    sfx: t.exportTrackSfx,
    voice: t.exportTrackVoice,
    music: t.exportTrackMusic,
  }
  return [
    { name: t.exportTrackMix, buffer: mix.full },
    ...mix.families.map((f) => ({ name: names[f.family], buffer: f.buffer })),
  ]
}

/** The NAMES alone, to declare the tracks before there is anything to write into them. */
function trackNames(mix: MixedTracks, locale: ReplayLocale): string[] {
  return exportTracks(mix, locale).map((p) => p.name)
}
