// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useReplayCapture — THE REACT WIRING OF CAPTURE: what the transport bar commands, and what
 * the canvas must lend it for that.
 *
 * WHY A HOOK RATHER THAN A HANDLER IN THE CANVAS. `ReplayCanvas.tsx` lives under a size
 * threshold (`max-lines` eslint, R5, nine extractions imposed so far): everything that is not
 * DRAWING comes out of it. The canvas therefore only lends its CANVAS, its CLOCK, and its
 * playback state, and gets back a single object it passes straight through to the bar —
 * exactly the pattern used for sound (`useReplaySound` -> `ReplaySound`), and for the same
 * reason: wiring one more command must not cost a line of canvas code.
 *
 * WHAT THIS FILE DOES NOT DECIDE: the filename, the download, and reading pixels are pure
 * logic and live in `replayCapture.ts`; the video container choice lives in
 * `replayRecording.ts`; the audio track lives in `replayAudio.ts` (the player opens a second
 * output alongside the speakers). Here, only the wiring.
 *
 * TWO SUB-HOOKS, for the reason already written in `useReplaySound.ts` (CLAUDE.md #5,
 * function <= 80 lines): the image and the video only share their destination — a file — and
 * merging them into one function would only have made a long function.
 *
 * # THE SCREEN IS FILMED, AND THAT IS INTENTIONAL
 *
 * Recording captures what the canvas SHOWS, frame by frame, while it shows it. Changing speed
 * or dragging the scrubber mid-recording therefore shows up in the file (decision 4): not a
 * flaw, it is the contract, and the button's tooltip says so. An offscreen render at a fixed
 * speed would be a different product — and a different piece of work.
 *
 * # ONE SINGLE EXIT PATH
 *
 * Three gestures stop recording, and all three go through `stopRecording`: a second click on
 * the button, pausing, and the film's end. That is what guarantees a clip is always assembled
 * and handed back exactly once — never zero (a forgotten recording spinning in the void),
 * never two (two downloads for one clip). Symmetrically, a click on a PAUSED replay starts
 * playback (decision 3): filming a frozen frame makes no sense.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'

import { buildCaptureFilename, captureCanvasImage, triggerDownload } from './replayCapture'
import {
  CAPTURE_FPS,
  canRecordCanvas,
  isVideoTypeSupported,
  pickVideoMimeType,
} from './replayRecording'
import { frameToMs } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { useReplayExport, type ReplayExport, type ReplayExportOptions } from './useReplayExport'
import type { ExportOutcome } from './exportOverlayPanels'
import { readVictory } from '../model/victoryLogic'
import type { ReplayWindowBounds } from '../model/replayWindow'
import type { ReplayLocale } from '../i18n/i18n'
import { meXUIDOf } from '@/features/match-view/xuidMeta'
import type { MatchScoreboardRow } from '@/lib/api/types'
import type { FilmAllegiance } from '@/lib/replay/filmAllegiance'
import type { ReplayScoreDocument } from '@/lib/replay/scoreTimeline'
import { DEFAULT_LOCALE } from '@/lib/i18n/locale'

export interface ReplayCaptureOptions {
  /** The replay's canvas: it, and only it, carries everything that is visible. */
  canvasRef: RefObject<HTMLCanvasElement | null>
  /** The document: it gives the match's id and a frame's duration. */
  doc: ReplayDocumentReady
  /** The current frame, shared with drawing — read on click, never on render. */
  frameRef: RefObject<number>
  /** Playback state. Its FALLING EDGE to `false` ends recording (pause, film's end). */
  playing: boolean
  /** Starts playback. Called at start if the replay is paused (decision 3). */
  play: () => void
  /**
   * The replay's audio track, REQUESTED when recording starts (see `ReplaySound`).
   * `null` = sound muted or player not yet alive: the clip comes out silent, which is the
   * nominal case since the replay's sound is muted by default.
   */
  audioTrack?: () => MediaStreamTrack | null
  /**
   * WHAT THE OFFLINE EXPORT ADDITIONALLY NEEDS (see `useReplayExport`). Absent, only the
   * image and real-time video remain available — the export simply does not render.
   */
  redraw?: () => void
  playWindow?: ReplayWindowBounds | null
  scoreboard?: readonly MatchScoreboardRow[]
  kills?: ReplayExportOptions['kills']
  timeLimitMs?: number | null
  /**
   * The allegiance read from the film, from the viewpoint (`model.allegiance`): the clip's
   * end screen. REQUIRED, like the viewpoint it carries.
   */
  allegiance: FilmAllegiance
  /**
   * The match's verdict: its CODE (`header.outcome_code`) and, in a mode played in rounds,
   * the final score served by the API. The WORD itself is resolved right here from the
   * title's mappings (`useViewedOutcome`). Without a verdict, no end screen in the clip
   * (parity with the DOM).
   */
  outcome?: ExportOutcome | null
  /**
   * THE PAGE'S VIEWPOINT (2026-09-06): the export renders WHAT THE SCREEN SHOWS (decision 12
   * of the "timeline, viewpoint" plan) — including the victory panel. The person exporting
   * chose what they are watching. `null`: the page's own player.
   *
   * MANDATORY SINCE 2026-09-07 (F4 review), `null` included. Optional, its omission at the
   * call site made NO test fail — the clip would come out at the page player's side while
   * the screen followed the chosen player. Required, the omission no longer compiles.
   */
  viewpoint: string | null
  locale?: ReplayLocale
  /** The replay's sound track and its volume, for the offline mix (`useReplaySound`). */
  soundTrack?: ReplayExportOptions['soundTrack']
  soundVolume?: number
  /** The screen's zoom level, for the export's framing choice (see `useReplayExport`). */
  zoomLevel?: number
}

/** What the transport bar receives (same shape as `ReplaySound`: an object, not props). */
export interface ReplayCapture {
  /** Downloads the current scene as PNG. With no readable canvas: does nothing, breaks nothing. */
  captureImage: () => void
  /**
   * `false` = this browser cannot film a canvas (no `MediaRecorder`, no `captureStream`, or no
   * accepted container). The button then does NOT render at all (decision 7): a greyed-out
   * command would suggest a fixable failure.
   */
  recordingSupported: boolean
  recording: boolean
  /** Starts, or stops AND downloads. The same button, both directions. */
  toggleRecording: () => void
  /**
   * THE OFFLINE EXPORT. `null` when the page did not give it anything to paint overlays with
   * — the transport bar then does not show the command.
   */
  videoExport: ReplayExport | null
}

/** Names a capture file at the CURRENT match instant, in the requested extension. */
type FilenameFor = (ext: string) => string

/** The absent scoreboard, as a STABLE reference: a fresh `[]` per render would break memos. */
const EMPTY_BOARD: readonly MatchScoreboardRow[] = []

/**
 * openRecording assembles the stream, opens the recorder, and starts it. OUTSIDE REACT:
 * nothing here is component state, only the media graph — that is what keeps the hook short.
 *
 * `onClosed` receives the assembled clip (or `null` if nothing was recorded) and its name. It
 * is called exactly once, at closing, and it is the only place a file can come out of.
 */
function openRecording(
  canvas: HTMLCanvasElement,
  filenameFor: FilenameFor,
  audioTrack: (() => MediaStreamTrack | null) | undefined,
  onClosed: (clip: Blob | null, filename: string) => void,
): MediaRecorder | null {
  const choice = pickVideoMimeType(isVideoTypeSupported)
  if (!choice) return null
  const canvasStream = canvas.captureStream(CAPTURE_FPS)
  // SOUND JOINS THE IMAGE HERE, AND ONLY HERE (decision 6): the track is requested at
  // START, so enabling sound afterwards adds nothing to the current clip. With no track —
  // sound muted, the default case — the canvas's own stream is recorded as is.
  const audio = audioTrack?.() ?? null
  const stream =
    audio && typeof MediaStream === 'function'
      ? new MediaStream([...canvasStream.getTracks(), audio])
      : canvasStream
  const recorder = new MediaRecorder(stream, { mimeType: choice.mime })
  const chunks: Blob[] = []
  // The name is FIXED at start: it carries the instant the clip begins, not the one it
  // stops. A clip named after its end would not place back into the match.
  const filename = filenameFor(choice.ext)
  recorder.ondataavailable = (e: BlobEvent) => {
    if (e.data && e.data.size > 0) chunks.push(e.data)
  }
  recorder.onstop = () => {
    // THE CANVAS'S TRACKS STOP HERE, not before: capture must run until the last slice, or
    // the clip would lose its ending. THE AUDIO TRACK, however, IS NOT STOPPED — it belongs
    // to the sound player, which lives longer than the clip; closing it here would mute
    // every following recording.
    for (const track of canvasStream.getTracks()) track.stop()
    onClosed(chunks.length > 0 ? new Blob(chunks, { type: choice.mime }) : null, filename)
  }
  recorder.start()
  return recorder
}

/** Sub-hook: image capture. Nothing asynchronous to hold, so no state. */
function useImageCapture(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  filenameFor: FilenameFor,
): () => void {
  return useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // THE NAME IS FIXED BEFORE ENCODING: `toBlob` is asynchronous, and the frame keeps
    // running during that time. Naming it afterward would date a file with an instant that
    // is not the one it shows.
    const filename = filenameFor('png')
    void captureCanvasImage(canvas).then((blob) => {
      // No blob = blank canvas or refused encoding: nothing to hand back. An empty file
      // would be worse than no file (see `captureCanvasImage`).
      if (blob) triggerDownload(blob, filename)
    })
  }, [canvasRef, filenameFor])
}

/** Sub-hook: video recording, its state, and its three exits (see the header). */
function useVideoRecording(
  o: ReplayCaptureOptions,
  filenameFor: FilenameFor,
): { supported: boolean; recording: boolean; toggle: () => void } {
  const { canvasRef, playing, play, audioTrack } = o
  const [recording, setRecording] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  // UNMOUNTING DOES NOT DOWNLOAD. Leaving the page during a recording must close the
  // recorder, not drop a file nobody is waiting for anymore.
  const liveRef = useRef(true)
  // The capability only depends on the browser: it does not change from one render to the next.
  const supported = useMemo(() => canRecordCanvas(), [])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    // Assembly and download happen in `onstop`: `stop()` first drains whatever the encoder
    // still holds, and that last slice arrives AFTER this return.
    recorder.stop()
  }, [])

  const start = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || recorderRef.current) return
    const recorder = openRecording(canvas, filenameFor, audioTrack, (clip, filename) => {
      recorderRef.current = null
      setRecording(false)
      if (liveRef.current && clip) triggerDownload(clip, filename)
    })
    if (!recorder) return
    recorderRef.current = recorder
    setRecording(true)
    // FILMING A FROZEN FRAME MAKES NO SENSE (decision 3): a paused replay resumes.
    if (!playing) play()
  }, [canvasRef, filenameFor, audioTrack, playing, play])

  // AUTO-STOP ON PLAYBACK'S FALLING EDGE — manual pause or the film's end, it is the same
  // signal and the same exit. The TRANSITION is what is watched for, never the state: at
  // startup from a pause, `playing` is still `false` for one render, and reading the state
  // would stop the clip within the second after it opens.
  const wasPlayingRef = useRef(playing)
  useEffect(() => {
    const was = wasPlayingRef.current
    wasPlayingRef.current = playing
    if (was && !playing) stop()
  }, [playing, stop])

  // Unmounting: the recorder is closed without dropping anything (see `liveRef`).
  useEffect(() => {
    return () => {
      liveRef.current = false
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
    }
  }, [])

  const toggle = useCallback(() => {
    if (recorderRef.current) stop()
    else start()
  }, [start, stop])

  return { supported, recording, toggle }
}

export function useReplayCapture(o: ReplayCaptureOptions): ReplayCapture {
  const { canvasRef, doc, frameRef } = o
  // THE INSTANT IS READ AT NAMING TIME, never at render: image and video share the same
  // naming rule (decision 8), and that is the only thing they truly have in common.
  const filenameFor = useCallback<FilenameFor>(
    (ext) => buildCaptureFilename(doc.matchId, frameToMs(frameRef.current, doc), ext, new Date()),
    [doc, frameRef],
  )
  const captureImage = useImageCapture(canvasRef, filenameFor)
  const video = useVideoRecording(o, filenameFor)
  const videoExport = useExportSeam(o)

  return {
    captureImage,
    recordingSupported: video.supported,
    recording: video.recording,
    toggleRecording: video.toggle,
    videoExport,
  }
}

/**
 * useExportSeam wires in the offline export — when the page has given it something to paint.
 *
 * THE PAUSE IS BUILT HERE, it is not one more parameter: `play` is the playback TOGGLE
 * (`togglePlay`), so calling it during playback pauses it. That is exactly what the export
 * needs — the animation loop writes `frameRef` too, and the two running at once would fight
 * over the cursor.
 *
 * THE HOOK IS CALLED UNCONDITIONALLY, and only its RESULT is kept or discarded: calling a
 * hook behind an `if` is forbidden by React, and a page with no overlays is still a page that
 * can export its map.
 *
 * THIS IS ALSO WHERE THE VERDICT'S WORD IS RESOLVED (2026-09-07), and nowhere further down:
 * the outcome's canonical label comes from a HOOK — `useOutcomeMapping`, the title's mappings
 * — and `exportOverlayPanels` is a pure function the export loop calls outside React. The
 * wiring layer is the last step where a hook can still run.
 *
 * `useOutcomeMapping` AND NOT `useOutcomeLabel`, which would otherwise be the natural hook:
 * the latter returns the RAW KEY when the title's mappings are not loaded (`win`, `loss`),
 * and an export panel cannot recover from that — the encoded clip would keep the word `loss`
 * in full frame, forever. `useOutcomeMapping` returns `undefined` in that case, which is
 * distinct from a label and SILENCES the panel, exactly like the DOM.
 */
function useExportSeam(o: ReplayCaptureOptions): ReplayExport | null {
  const { canvasRef, frameRef, doc, playing, play, redraw } = o
  const pause = useCallback(() => {
    if (playing) play()
  }, [playing, play])
  const noop = useCallback(() => {}, [])
  const outcome = useViewedOutcome(o)
  const exportable = useReplayExport({
    canvasRef,
    frameRef,
    redraw: redraw ?? noop,
    pause,
    doc: doc as ReplayDocumentReady & ReplayScoreDocument,
    playWindow: o.playWindow ?? null,
    scoreboard: o.scoreboard ?? [],
    kills: o.kills,
    timeLimitMs: o.timeLimitMs,
    allegiance: o.allegiance,
    outcome,
    viewpoint: o.viewpoint,
    titleSlug: doc.titleSlug ?? '',
    locale: o.locale ?? DEFAULT_LOCALE,
    soundTrack: o.soundTrack,
    soundVolume: o.soundVolume,
    zoomLevel: o.zoomLevel,
  })
  return redraw ? exportable : null
}

/**
 * useViewedOutcome completes the page's verdict with THE WORD THE SCREEN SHOWS.
 *
 * ONE SINGLE SOURCE, THE TITLE'S MAPPINGS (2026-09-07): the label of the READ outcome
 * (`readVictory`, already swapped when the subject is on the other side) exactly as
 * `outcomes.toml` publishes it via `/field-mappings`. This is word for word what the DOM paints.
 *
 * THERE USED TO BE TWO VOCABULARIES, and this rule closes that gap. The default word used to
 * come from `header.outcome_label`, built by a Go map HARD-CODED IN FRENCH; only the SWAPPED
 * word went through `outcomes.toml`. In French the two coincided — nothing showed; in English
 * the clip would have said "Victoire" by default and "Loss" seen from an opponent. Since
 * 2026-09-07 (D5), the backend no longer serves ANY word for the outcome — only the canonical
 * key (win|loss|tie|dnf, see `service/outcome_label.go`) — and in any case only knows one
 * viewpoint: resolving it here, on the read outcome, is what guarantees uniqueness.
 *
 * SAME RULE AS THE DOM (`ReplayVictoryOverlay`), line for line — this is the second and last
 * tolerated copy (rule #6), and `exportOverlayPanels`'s header already explains why the export
 * cannot mount the component. `null` returned when the outcome has no label (title's mappings
 * not loaded yet): the panel stays silent, exactly like the DOM.
 */
function useViewedOutcome(o: ReplayCaptureOptions): ExportOutcome | null {
  const scoreboard = o.scoreboard ?? EMPTY_BOARD
  const reading = useMemo(
    () => readVictory(o.allegiance, o.outcome?.code, meXUIDOf(scoreboard), o.viewpoint),
    [o.allegiance, scoreboard, o.outcome?.code, o.viewpoint],
  )
  const viewedLabel = reading ? { win: 'Victory', loss: 'Defeat', tie: 'Tie' }[reading.outcome] : null
  return useMemo(
    () => (o.outcome ? { ...o.outcome, viewedLabel } : null),
    [o.outcome, viewedLabel],
  )
}
