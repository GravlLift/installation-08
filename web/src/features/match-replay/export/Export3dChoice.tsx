// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** Choose the exported view, camera, followed player, and optional minimap. */
import type { CameraMode3d } from '../scene3d/replayScene3d'
import type { ReplayLocale } from '../i18n/i18n'
import { SCENE3D_TEXT } from '../i18n/scene3dText'
import type { Replay3DExportEntry } from './replay3dExportStore'
import type { View3dChoice } from './view3dChoice'

const CAMERAS: CameraMode3d[] = ['fp', 'tp', 'free']

const ROW = 'mt-3 flex items-start gap-3 text-[12.5px] text-foreground'
const LABEL = 'w-12 shrink-0 text-muted-foreground'
const RADIO = 'size-3.5 cursor-pointer accent-primary'

export function Export3dChoice({
  entry,
  locale,
  choice,
  onChange,
  threeDOnly = false,
}: {
  entry: Replay3DExportEntry
  locale: ReplayLocale
  choice: View3dChoice
  onChange: (next: View3dChoice) => void
  threeDOnly?: boolean
}) {
  const t = SCENE3D_TEXT[locale]
  const set = (patch: Partial<View3dChoice>) => onChange({ ...choice, ...patch })
  const cameraLabel: Record<CameraMode3d, string> = {
    fp: t.cameraFirst,
    tp: t.cameraThird,
    free: t.exportCameraFreeFixed,
  }
  return (
    <>
      {!threeDOnly && <div role="radiogroup" aria-label={t.exportView} className={ROW}>
        <span className={LABEL}>{t.exportView}</span>
        <div className="flex flex-col gap-1">
          {[false, true].map((on) => (
            <label key={String(on)} className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="replay-export-view"
                checked={choice.on === on}
                onChange={() => set({ on })}
                className={RADIO}
              />
              {on ? t.exportView3d : t.exportView2d}
            </label>
          ))}
        </div>
      </div>}
      {choice.on && (
        <>
          <div role="radiogroup" aria-label={t.cameraGroup} className={ROW}>
            <span className={LABEL}>{t.cameraGroup}</span>
            <div className="flex flex-col gap-1">
              {CAMERAS.map((camera) => (
                <label key={camera} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="replay-export-camera"
                    checked={choice.camera === camera}
                    onChange={() => set({ camera })}
                    className={RADIO}
                  />
                  {cameraLabel[camera]}
                </label>
              ))}
            </div>
          </div>
          <label className="mt-3 flex items-center gap-3 text-[12.5px] text-foreground">
            <span className={LABEL}>{t.exportFollow}</span>
            <select
              value={choice.pov ?? ''}
              onChange={(e) => set({ pov: e.currentTarget.value || null })}
              className="h-7 min-w-0 flex-1 cursor-pointer rounded-md border border-border bg-background px-2 text-[12.5px] text-foreground"
            >
              {choice.pov === null && <option value="">-</option>}
              {entry.source.players.map((p) => (
                <option key={p.xuid} value={p.xuid}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {!threeDOnly && <label className="mt-3 flex cursor-pointer items-center gap-2 text-[12.5px] text-foreground">
            <input
              type="checkbox"
              checked={choice.minimap}
              onChange={(e) => set({ minimap: e.currentTarget.checked })}
              className={RADIO}
            />
            {t.exportMinimap}
          </label>}
        </>
      )}
    </>
  )
}
