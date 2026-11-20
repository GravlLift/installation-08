// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useAutoExport — THE PAGE SIDE of "auto export": a URL renders a camera script and uploads
 * the clip, with no clicks (`autoExport.ts` reads the URL, this hook does what it asks).
 *
 * THE RUN, IN ITS WHOLE. The request is read ONCE from the page's hash (a page load is one
 * question; a navigation must not rewrite a run under way). The hook then waits for the two
 * things the export needs to exist — the loaded 3D scene (`exportScene`) and the page's
 * offline export (`videoExport`, supported) — fetches the named script, and runs it EXACTLY
 * as the dialog does: free camera, no minimap, the chosen sound/format/clean, the script in
 * hand (the script decides the range, so the bounds are ignored by the run). When the run
 * ends in `done`, the clip's blob goes up by upload instead of waiting for a "Save" click,
 * and the clip is released; a `failed` phase fails the run with the run's own message.
 *
 * EVERY STEP IS SAID, in three places at once: the pill (bottom-left, `role="status"` and
 * `data-autoexport-state` for a machine), the document title, and the console
 * (`[autoexport]`) — so a script driving the page reads progress without a screenshot.
 * A refusal (an invalid parameter) fails the run AT ONCE with its stated reason, never a
 * silent fallback.
 */
import { createElement, useEffect, useRef, useState, type ReactNode } from 'react'

import { fetchCameraScript, uploadExport } from '../camera-script/cameraScriptApi'
import { parseAutoExport, type AutoExportRequest, type AutoExportRefusal } from './autoExport'
import type { Replay3DExportEntry } from './replay3dExportStore'
import type { ReplayExport, ReplayExportState } from './useReplayExport'

/** The steps a driven run goes through, and the only ones. */
export type AutoExportStatus = 'waiting' | 'rendering' | 'uploading' | 'done' | 'failed'

/** The run's state, as the pill, the title and the console say it. */
export interface AutoExportState {
  status: AutoExportStatus
  /** `rendering`: the encoded frames so far. */
  done?: number
  /** `rendering`: the frames to encode. */
  total?: number
  /** `done`: the path the server gave the clip. */
  path?: string
  /** `failed`: the stated reason. */
  reason?: string
}

export interface AutoExportInputs {
  matchId: string
  /** The page's offline export (`useReplayCapture`'s `videoExport`); `null` before the page can paint. */
  videoExport: ReplayExport | null
  /** The loaded 3D scene (`useReplay3DExport`): non-null once registered — the readiness signal. */
  exportScene: Replay3DExportEntry | null
}

/** The one stated reason of an error: its message, or its shape. */
function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The text the three surfaces say, for one state. */
function textOf(name: string | null, state: AutoExportState): string {
  const who = name === null ? 'Auto export' : `Auto export ${name}`
  switch (state.status) {
    case 'rendering':
      return `${who}: rendering ${state.done ?? 0}/${state.total ?? 0}`
    case 'uploading':
      return `${who}: uploading`
    case 'done':
      return `${who}: saved ${state.path ?? ''}`
    case 'failed':
      return `${who}: failed (${state.reason ?? 'no reason given'})`
    default:
      return `${who}: waiting`
  }
}

export function useAutoExport(o: AutoExportInputs): { state: AutoExportState | null; pill: ReactNode | null } {
  // THE REQUEST IS READ ONCE, on the first render: the hash is the question asked when the
  // page opened; re-reading it would let a later navigation change a run under way.
  const parsedRef = useRef<AutoExportRequest | AutoExportRefusal | null | undefined>(undefined)
  if (parsedRef.current === undefined) parsedRef.current = parseAutoExport(window.location.hash)
  const parsed = parsedRef.current

  const [state, setState] = useState<AutoExportState | null>(() => {
    if (parsed === null) return null
    if ('error' in parsed) return { status: 'failed', reason: parsed.error }
    return { status: 'waiting' }
  })
  const name = parsed === null || 'error' in parsed ? null : parsed.name

  // THE RUN STARTS ONCE AND ONLY ONCE, when everything it needs exists: the scene registered,
  // the export ready and supported. The ref is the once-guard; the effect re-runs on every
  // render (the export's identity changes) until that guard trips.
  const startedRef = useRef(false)
  // UNMOUNTING STOPS THE RUN'S WORDS: a page that is gone is not told what happened to it.
  const liveRef = useRef(true)
  useEffect(() => {
    liveRef.current = true
    return () => {
      liveRef.current = false
    }
  }, [])

  async function launch(request: AutoExportRequest, videoExport: ReplayExport): Promise<void> {
    try {
      const script = await fetchCameraScript(o.matchId, request.name)
      if (!liveRef.current) return
      // EXACTLY what the dialog does (ReplayExportDialog, the "Export" button): the script
      // decides the range, so the default bounds are ignored by the run.
      await videoExport.run(videoExport.defaultBounds(), {
        sound: request.sound,
        format: request.format,
        view3d: { camera: 'free', pov: null, minimap: false },
        clean: request.clean,
        script,
      })
    } catch (err) {
      if (liveRef.current) setState({ status: 'failed', reason: reasonOf(err) })
    }
  }

  useEffect(() => {
    if (parsed === null || 'error' in parsed || startedRef.current) return
    if (!o.exportScene || !o.videoExport || !o.videoExport.supported) return
    startedRef.current = true
    void launch(parsed, o.videoExport)
    // The launch reads only the refs and this render's values; the guards make a re-run
    // impossible, so nothing else is a dependency.
  }, [parsed, o.exportScene, o.videoExport, o.matchId])

  // THE RUN'S PHASES, FOLLOWED. `done` hands the clip to the upload; `failed` takes the
  // run's own message. The guard keeps the upload a single one, whatever re-renders follow.
  const uploadedRef = useRef(false)

  async function deliver(st: ReplayExportState, request: AutoExportRequest): Promise<void> {
    if (uploadedRef.current) return
    const save = st.save
    if (!save) {
      setState({ status: 'failed', reason: 'export finished without a clip' })
      return
    }
    uploadedRef.current = true
    setState({ status: 'uploading' })
    try {
      const res = await uploadExport(o.matchId, request.out, save.blob)
      if (!liveRef.current) return
      // THE CLIP IS RELEASED ONCE IT IS UP: it is not a download to hold for a click.
      o.videoExport?.discardDone()
      setState({ status: 'done', path: res.path })
    } catch (err) {
      if (!liveRef.current) return
      o.videoExport?.discardDone()
      setState({ status: 'failed', reason: reasonOf(err) })
    }
  }

  // THE STATE ITSELF IS A DEPENDENCY: the export reports its progress by changing it, and a
  // change with no re-run would leave the run's word behind where it last was said.
  const exportState = o.videoExport?.state
  useEffect(() => {
    if (parsed === null || 'error' in parsed || !startedRef.current) return
    const st = o.videoExport?.state
    if (!st) return
    if (st.phase === 'prepare' || st.phase === 'encode') {
      setState({ status: 'rendering', done: st.done, total: st.total })
    } else if (st.phase === 'done') {
      void deliver(st, parsed)
    } else if (st.phase === 'failed') {
      setState({ status: 'failed', reason: st.message ?? 'export failed' })
    }
  }, [parsed, o.videoExport, exportState, o.matchId])

  // EVERY STEP IS SAID: the title and the console move with the pill, on each change.
  const text = state === null ? null : textOf(name, state)
  useEffect(() => {
    if (text === null) return
    document.title = text
    console.info('[autoexport]', state?.status, text)
  }, [text, state?.status])

  return { state, pill: autoExportPill(state, name) }
}

/**
 * The pill: small, fixed at the BOTTOM-LEFT (the top-left is the camera view selector's),
 * with its state readable off the DOM as well as the eye. `createElement` rather than JSX:
 * this file is a `.ts` (the hook), not a component module.
 */
function autoExportPill(state: AutoExportState | null, name: string | null): ReactNode {
  if (state === null) return null
  return createElement(
    'div',
    {
      role: 'status',
      'data-autoexport-state': state.status,
      // Above the transport bar (bottom-24), never over its play button; a long saved path is
      // truncated on screen (the title and the console carry it whole).
      className: `fixed bottom-24 left-4 z-30 max-w-[calc(100vw-2rem)] truncate rounded-full border border-border bg-card px-3 py-1.5 text-[12.5px] shadow-lg ${state.status === 'failed' ? 'text-destructive' : 'text-foreground'}`,
    },
    textOf(name, state),
  )
}
