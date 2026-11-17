// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ReplayExportDialog — THE EXPORT PANEL: the range, the sound, and what happens during.
 *
 * # WHY A PANEL, AND NOT A SIMPLE BUTTON
 *
 * Real-time recording had nothing to ask: it filmed whatever was shown to it, and stopped
 * when told to. Export, on the other hand, decides EVERYTHING up front — from which frame to
 * which frame, with or without sound — and only returns control once the file is ready. These
 * choices must therefore be made BEFORE, and only once.
 *
 * # IT IS ANCHORED TO THE BUTTON, AND THAT IS A DECISION
 *
 * The panel opens just above the button that called it, right-aligned to it: the gesture and
 * its response in the same place. It was anchored wrong until 2026-08-28 — declared
 * `absolute` with no positioned ancestor in the bar, it landed by ACCIDENT on the replay's
 * full map, five hundred lines further down, and covered the timeline. The export controls'
 * container now carries `relative`: the anchoring is written, not accidental.
 *
 * # WHAT THIS COMPONENT DOES NOT DECIDE
 *
 * None of the computation. It knows nothing of the encoder, the canvas, or the sound track:
 * it reads a state (`ReplayExport`) and calls `run`. Bounding itself is delegated —
 * `clampExportBounds` lives in `replayExportPlan.ts`, with the rest of the export's
 * arithmetic, because a bound that corrects itself inside a component is a bound that cannot
 * be tested.
 *
 * # THE TWO SLIDERS CANNOT CROSS
 *
 * They are bounded to the gameplay window AND to each other: dragging the end before the
 * start pushes the start, never the other way around. An empty interval is not an error to
 * report, it is a gesture that is prevented — there is nothing to tell the user.
 *
 * # THE FILE FORMAT IS CHOSEN HERE, AND REMEMBERED (2026-09-16)
 *
 * 1080p or 720p (`exportFormats.ts`), 1080p by default. The choice is remembered in THIS
 * browser (`readExportFormat` / `persistExportFormat`, decision D4): exporting once is rare,
 * and the format is a habit tied to usage (sharing, editing), not to the match.
 *
 * # FRAMING, ON THE OTHER HAND, IS OFFERED ONLY ON A ZOOMED MAP, AND IS NOT REMEMBERED (D6)
 *
 * At 1x there is nothing to choose. Zoomed, the map can export in full (the default: a clip
 * gets shared, and the whole field should be visible) or at the screen's current framing. The
 * choice lives only for the duration of the dialog: a zoom is a moment's gesture.
 *
 * # THE 3D VIEW, WHEN THE PAGE HAS ONE LOADED
 *
 * 2D map or 3D view, and in 3D the camera, the followed player and the minimap
 * (`Export3dChoice`). The zoomed-map framing only applies to 2D.
 *
 * # DURING THE COMPUTATION, THE PANEL DOES NOT CLOSE ON ITS OWN
 *
 * It turns into a progress bar and a "Cancel" button. And if the user closes it anyway via
 * the button, it is THAT button which then carries the progress (see `PlayerTransport`): no
 * page state must lose both the way back and the means to cancel at the same time.
 */
import { useState, type ReactNode } from 'react'

import { REPLAY_TEXT, type ReplayLocale } from '../i18n/i18n'
import { Export3dChoice } from './Export3dChoice'
import { initialView3dChoice, view3dRunOptions, type View3dChoice } from './view3dChoice'
import type { Export3dOptions } from './export3dFrame'
import { useReplay3DExport } from './replay3dExportStore'
import { persistExportFormat, readExportFormat } from '../settings/replayPreferences'
import type { ReplayText } from '../i18n/i18nContract'
import { DEFAULT_EXPORT_FRAMING, EXPORT_FORMATS, type ExportFormatId, type ExportFraming } from './exportFormats'
import { clampExportBounds, etaLabel, type ExportBounds } from './replayExportPlan'
import type { ReplayExport, ReplayExportState } from './useReplayExport'

interface Props {
  exporter: ReplayExport
  locale: ReplayLocale
  onClose: () => void
  threeDOnly?: boolean
}

/** Is the export busy? The two active phases, and only those. */
export function isExportBusy(state: ReplayExportState): boolean {
  return state.phase === 'prepare' || state.phase === 'encode'
}

export function ReplayExportDialog({ exporter, locale, onClose, threeDOnly = false }: Props) {
  const t = REPLAY_TEXT[locale]
  const domain = exporter.defaultBounds()
  const [bounds, setBounds] = useState<ExportBounds>(domain)
  const [withSound, setWithSound] = useState(true)
  const [format, setFormat] = useState<ExportFormatId>(readExportFormat)
  const [framing, setFraming] = useState<ExportFraming>(DEFAULT_EXPORT_FRAMING)
  const entry3d = useReplay3DExport()
  const [view3d, setView3d] = useState<View3dChoice>(() => ({ ...initialView3dChoice(entry3d), ...(threeDOnly ? { on: true, minimap: false } : {}) }))
  const chooseFormat = (id: ExportFormatId) => {
    setFormat(id)
    persistExportFormat(id)
  }
  const { state } = exporter

  const setStart = (v: number) => setBounds((b) => clampExportBounds({ ...b, startFrame: v }, domain))
  const setEnd = (v: number) => setBounds((b) => clampExportBounds({ ...b, endFrame: v }, domain))

  return (
    <div
      role="dialog"
      aria-label={t.exportDialogTitle}
      className={`z-20 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-4 shadow-lg ${threeDOnly ? 'relative overflow-y-auto' : 'absolute bottom-full right-0 mb-2'}`}
    >
      <p className="text-sm font-semibold text-foreground">{t.exportDialogTitle}</p>
      {/* FAILURE IS SAID OUT LOUD. Without this line, an encoder failure made the bar vanish
          without a word and without a file — impossible to tell "it failed" apart from
          "nothing happened". */}
      {state.phase === 'failed' && (
        <p role="alert" className="mt-2 text-[12.5px] text-destructive">
          {t.exportFailed}
          {state.message ? ` (${state.message})` : ''}
        </p>
      )}
      {/* THE END IS SAID TOO, with the file name: the clip lands in downloads, where nothing
          ties a `replay-...mp4` back to the gesture that just happened. */}
      {state.phase === 'done' && (
        <p role="status" className="mt-2 break-all text-[12.5px] text-foreground">
          {t.exportDoneFmt(state.filename ?? '')}
          {state.mutedFallback ? <span className="block text-muted-foreground">{t.exportMutedFallback}</span> : null}
        </p>
      )}
      {/* A 3D clip encoded at 30 instead of 60 is SAID, while it encodes and once it is saved. */}
      {state.fpsFallback && (state.phase === 'encode' || state.phase === 'done') && (
        <p role="alert" className="mt-2 text-[12.5px] text-destructive">
          {t.exportFpsFallbackFmt(state.fps ?? 30)}
        </p>
      )}
      {isExportBusy(state) ? (
        <ExportProgress exporter={exporter} locale={locale} />
      ) : state.phase === 'done' ? (
        <ExportDone exporter={exporter} t={t} onClose={onClose} />
      ) : (
        <ExportForm
          t={t}
          bounds={bounds}
          domain={domain}
          exporter={exporter}
          sound={{ on: withSound, set: setWithSound }}
          format={{ id: format, set: chooseFormat }}
          framing={{ id: framing, set: setFraming }}
          view3d={
            entry3d && {
              slot: <Export3dChoice entry={entry3d} locale={locale} choice={view3d} onChange={setView3d} threeDOnly={threeDOnly} />,
              run: view3dRunOptions(entry3d, view3d),
            }
          }
          onBound={{ start: setStart, end: setEnd }}
          onClose={onClose}
        />
      )}
    </div>
  )
}

/**
 * The form: the two bounds, the format, the sound, and the two actions.
 *
 * THE FORMAT DOES NOT NEED TO BE DISABLED DURING EXPORT: this form is not rendered at all
 * during `prepare`/`encode` (see `isExportBusy`), so the choice cannot change under a
 * computation already in progress.
 */
function ExportForm({
  t, bounds, domain, exporter, sound, format, framing, view3d, onBound, onClose,
}: {
  t: ReplayText
  bounds: ExportBounds
  domain: ExportBounds
  exporter: ReplayExport
  sound: { on: boolean; set: (v: boolean) => void }
  format: { id: ExportFormatId; set: (id: ExportFormatId) => void }
  framing: { id: ExportFraming; set: (id: ExportFraming) => void }
  /** The 2D / 3D choice (`Export3dChoice`) and its options; `null` with no 3D map loaded. */
  view3d: { slot: ReactNode; run: Export3dOptions | null } | null
  onBound: { start: (v: number) => void; end: (v: number) => void }
  onClose: () => void
}) {
  const run3d = view3d?.run ?? null
  return (
    <>
      <div className="mt-3 flex flex-col gap-2">
        <BoundSlider
          label={t.exportFrom}
          value={bounds.startFrame}
          domain={domain}
          clock={exporter.clockOf(bounds.startFrame)}
          onChange={onBound.start}
        />
        <BoundSlider
          label={t.exportTo}
          value={bounds.endFrame}
          domain={domain}
          clock={exporter.clockOf(bounds.endFrame)}
          onChange={onBound.end}
        />
      </div>
      {view3d?.slot}
      <FormatChoice t={t} format={format} />
      {/* Framing belongs to the 2D map: in 3D, the camera serves that role instead. */}
      {exporter.zoomLevel > 1 && !run3d && <FramingChoice t={t} framing={framing} zoomLevel={exporter.zoomLevel} />}
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-[12.5px] text-foreground">
        <input
          type="checkbox"
          checked={sound.on}
          onChange={(e) => sound.set(e.currentTarget.checked)}
          className="size-3.5 cursor-pointer accent-primary"
        />
        {t.exportWithSound}
      </label>
      <p className="mt-2 text-[11.5px] text-muted-foreground">
        {t.exportLengthFmt(exporter.lengthClock(bounds))}
      </p>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="h-8 cursor-pointer rounded-full px-3 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {t.exportClose}
        </button>
        <button
          type="button"
          onClick={() =>
            void exporter.run(bounds, { sound: sound.on, format: format.id, framing: framing.id, view3d: run3d })
          }
          className="h-8 cursor-pointer rounded-full bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t.exportStart}
        </button>
      </div>
    </>
  )
}

/** The format choice: one option per catalog format, with its dimensions. */
function FormatChoice({
  t,
  format,
}: {
  t: ReplayText
  format: { id: ExportFormatId; set: (id: ExportFormatId) => void }
}) {
  return (
    <div role="radiogroup" aria-label={t.exportFormat} className="mt-3 flex items-start gap-3 text-[12.5px] text-foreground">
      <span className="w-12 shrink-0 text-muted-foreground">{t.exportFormat}</span>
      <div className="flex flex-col gap-1">
        {EXPORT_FORMATS.map((f) => (
          <label key={f.id} className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="replay-export-format"
              value={f.id}
              checked={format.id === f.id}
              onChange={() => format.set(f.id)}
              className="size-3.5 cursor-pointer accent-primary"
            />
            <span className="font-mono tabular-nums">{t.exportFormatOptionFmt(f.id, f.width, f.height)}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

/** The framing choice, on a zoomed map only (see the header). */
function FramingChoice({
  t,
  framing,
  zoomLevel,
}: {
  t: ReplayText
  framing: { id: ExportFraming; set: (id: ExportFraming) => void }
  zoomLevel: number
}) {
  const options: { id: ExportFraming; label: string }[] = [
    { id: 'whole', label: t.exportFramingWhole },
    { id: 'current', label: t.exportFramingCurrentFmt(zoomLevel) },
  ]
  return (
    <div role="radiogroup" aria-label={t.exportFraming} className="mt-3 flex items-start gap-3 text-[12.5px] text-foreground">
      <span className="w-12 shrink-0 text-muted-foreground">{t.exportFraming}</span>
      <div className="flex flex-col gap-1">
        {options.map((o) => (
          <label key={o.id} className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="replay-export-framing"
              value={o.id}
              checked={framing.id === o.id}
              onChange={() => framing.set(o.id)}
              className="size-3.5 cursor-pointer accent-primary"
            />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  )
}

/** A bound slider, with its match clock on the right. */
function BoundSlider({
  label,
  value,
  domain,
  clock,
  onChange,
}: {
  label: string
  value: number
  domain: ExportBounds
  clock: string
  onChange: (v: number) => void
}) {
  return (
    <label className="flex items-center gap-3 text-[12.5px] text-foreground">
      <span className="w-12 shrink-0 text-muted-foreground">{label}</span>
      <input
        type="range"
        min={domain.startFrame}
        max={domain.endFrame}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        aria-label={label}
        className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
      />
      <span className="w-12 shrink-0 text-right font-mono tabular-nums text-muted-foreground">{clock}</span>
    </label>
  )
}

/**
 * The progress bar, and the ONLY action available during the computation.
 *
 * TWO PHASES THAT DO NOT SAY THE SAME THING. During `prepare` — fonts, logo, sound decoding,
 * offline mixing, track encoding — no frame count means anything, nothing is encoded yet: the
 * bar is INDETERMINATE and the text says what is being done. This is the phase that used to
 * show "Frame 0 / 18000" without moving for several seconds, which is exactly the moment one
 * wonders whether it has crashed. During `encode`, the count and the estimate become real.
 *
 * The bar is a simple variable-width block: a `<progress>` tag styles differently in every
 * browser, and the export does not need yet another component.
 */
function ExportProgress({ exporter, locale }: { exporter: ReplayExport; locale: ReplayLocale }) {
  const t = REPLAY_TEXT[locale]
  const { phase, done, total, pct, etaMs, prepareStep } = exporter.state
  // The preparation is INDETERMINATE until a sound step reports its share; then the bar moves.
  const step = phase === 'prepare' ? prepareStep : undefined
  const preparing = phase === 'prepare' && !step
  const shownPct = step ? step.pct : pct
  const eta = etaLabel(etaMs)
  return (
    <div className="mt-3">
      <div
        role="progressbar"
        aria-valuenow={preparing ? undefined : Math.round(shownPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t.exportDialogTitle}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={`h-full rounded-full bg-primary ${preparing ? 'animate-pulse' : 'transition-[width]'}`}
          style={{ width: preparing ? '100%' : `${shownPct}%` }}
        />
      </div>
      <p className="mt-2 text-[11.5px] text-muted-foreground">
        {preparing ? (
          t.exportPreparing
        ) : step ? (
          <span className="font-mono tabular-nums">
            {step.stage === 'mix' ? t.exportMixingFmt(step.pct) : t.exportSoundEncodingFmt(step.pct)}
          </span>
        ) : (
          <>
            <span className="font-mono tabular-nums">{t.exportProgressFmt(done, total)}</span>
            {eta ? <span> — {t.exportEtaFmt(eta)}</span> : null}
          </>
        )}
      </p>
      {/* WHAT THE USER SEES MOVING BEHIND THE PANEL, which would otherwise worry them. This
          text used to live in the FORM until 2026-08-28: its key is nonetheless called
          `exportRunningHint`, and it precisely did not show during the computation. */}
      <p className="mt-1 text-[11.5px] text-muted-foreground">{t.exportRunningHint}</p>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={exporter.cancel}
          className="h-8 cursor-pointer rounded-full bg-secondary px-4 text-[12.5px] font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
        >
          {t.exportCancel}
        </button>
      </div>
    </div>
  )
}

/**
 * The `done` phase: the clip is ready, the dialog stays open, and the delivery waits for a
 * click.
 *
 * WHY THE CLICK, AND NOT THE CODE. Minutes after the export click, a download triggered by
 * code no longer has a user gesture behind it: Chrome blocks a site's second unrequested
 * file ("Needs permission to download"), and the video is precisely the second one. The
 * "Save video" button therefore carries the click — it is the user who delivers the file,
 * not the code throwing it at them.
 *
 * Closing WITHOUT saving releases the clip (`discardDone`): the object URL is revoked, the
 * state falls back to idle, and nothing keeps the blob in memory. Saving, on the other hand,
 * does not close: the user can still re-read the name, or ask for another one.
 */
function ExportDone({ exporter, t, onClose }: { exporter: ReplayExport; t: ReplayText; onClose: () => void }) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            exporter.discardDone()
            onClose()
          }}
          className="h-8 cursor-pointer rounded-full px-3 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {t.exportClose}
        </button>
        <button
          type="button"
          onClick={exporter.saveDone}
          className="h-8 cursor-pointer rounded-full bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t.exportSaveVideo}
        </button>
      </div>
    </div>
  )
}
