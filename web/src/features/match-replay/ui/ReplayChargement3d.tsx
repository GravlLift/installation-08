import { useEffect, useState, type RefObject } from 'react'

import type { Scene3dText } from '../i18n/scene3dText'
import { fractionChargement3d, monterSeulement, type LoadState } from '../model/chargement3d_logic'
import type { LoadGate } from '../scene3d/loadGate3d'

const MB = 1024 * 1024

function loadMessage(load: LoadState, t: Scene3dText): string {
  switch (load.kind) {
    case 'download':
      return load.total > 0
        ? t.loadingFmt(Math.floor((100 * load.loaded) / load.total), Math.round(load.total / MB))
        : t.loadingFmt(0, Math.round(load.loaded / MB))
    case 'materials': return t.loadingMaterials
    case 'index': return t.loadingIndex
    case 'assets': return t.loadingAssets
    case 'warmup': return t.loadingWarmup
    case 'error': return t.loadFailed
    case 'ready': return ''
  }
}

export function ReplayChargement3d({ load, t, compact, gateRef }: {
  load: LoadState
  t: Scene3dText
  compact: boolean
  gateRef: RefObject<LoadGate | null>
}) {
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const gate = gateRef.current
    const update = () => setProgress((prev) => monterSeulement(prev, fractionChargement3d(load, gate?.started, gate?.finished)))
    update()
    if (load.kind !== 'assets' || !gate) return
    let frame = 0
    const unsubscribe = gate.subscribe(() => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; update() })
    })
    return () => { unsubscribe(); if (frame) cancelAnimationFrame(frame) }
  }, [load, gateRef])

  const message = loadMessage(load, t)
  const percent = Math.round(progress * 100)
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
