// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import type { Scene3dText } from '../i18n/scene3dText'
import type { LoadState } from '../model/chargement3d_logic'

const MB = 1024 * 1024

function loadMessage(load: LoadState, t: Scene3dText): string {
  if (load.kind === 'error') return t.loadFailed
  if (load.kind === 'ready') return ''
  switch (load.phase) {
    case 'download':
      return load.total > 0
        ? t.loadingFmt(Math.floor((100 * load.done) / load.total), Math.round(load.total / MB))
        : t.loadingFmt(0, Math.round(load.done / MB))
    case 'decode': return t.loadingMaterials
    case 'index':
    case 'variant-build':
    case 'variant-prepare': return t.loadingIndex
    case 'assets': return t.loadingAssets
    case 'warmup':
    case 'first-frame': return t.loadingWarmup
  }
}

/** The in-view loading overlay: the phase message and the scene's overall, monotonic fraction. */
export function ReplayChargement3d({ load, t, compact }: {
  load: LoadState
  t: Scene3dText
  compact: boolean
}) {
  const message = loadMessage(load, t)
  const percent = Math.round((load.kind === 'loading' ? load.fraction : load.kind === 'ready' ? 1 : 0) * 100)
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <div>{message}</div>
      {load.kind !== 'error' && (
        <>
          <div role="progressbar" aria-label={message} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
            className="h-1.5 overflow-hidden rounded-full bg-muted" style={{ width: 'min(40%, 320px)' }}>
            <div className="h-full rounded-full bg-primary transition-[width] duration-150" style={{ width: `${percent}%` }} />
          </div>
          {!compact && <div className="text-xs">{percent}%</div>}
        </>
      )}
    </div>
  )
}
