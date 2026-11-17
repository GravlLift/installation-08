// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * optimizeBannerModel — the top-of-page "Optimizing assets" banner: reads `GET /api/builds`
 * (the same endpoint BuildActivity.tsx's header indicator reads) and reduces it to the
 * fraction and step text the banner shows. The reduction is pure (`optimizeBannerView`);
 * `useOptimizeBanner` polls every 2 s while something builds and every 10 s when idle (so a
 * build that starts later while the tab stays open is still noticed), and not at all while the
 * tab is hidden.
 */
import { useEffect, useState } from 'react'

import { fetchBuilds, type BuildsBody } from './buildActivityModel'

export interface OptimizeBannerView {
  /** 0..1, the overall fraction done across every job the server has ever queued this run. */
  fraction: number
  /** "Weapons 84/190", or just the label when the active job reports no unit count. */
  step: string
}

export const OPTIMIZE_ACTIVE_POLL_MS = 2000
export const OPTIMIZE_IDLE_POLL_MS = 10000

/** optimizeBannerView: null when nothing builds (the banner hides). */
export function optimizeBannerView(body: BuildsBody | null): OptimizeBannerView | null {
  if (!body?.active) return null
  const overall = body.overall
  const fraction = overall && overall.total > 0 ? Math.min(1, Math.max(0, overall.fraction)) : 0
  return { fraction, step: body.active.step || body.active.label }
}

/** useOptimizeBanner: the banner's view, polled while the tab is visible. */
export function useOptimizeBanner(activeMs = OPTIMIZE_ACTIVE_POLL_MS, idleMs = OPTIMIZE_IDLE_POLL_MS): OptimizeBannerView | null {
  const [view, setView] = useState<OptimizeBannerView | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let busy = false
    const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'
    const tick = async () => {
      timer = undefined
      if (busy || hidden()) return
      busy = true
      const body = await fetchBuilds(controller.signal)
      busy = false
      if (controller.signal.aborted) return
      const next = optimizeBannerView(body)
      setView(next)
      if (!hidden()) timer = setTimeout(() => void tick(), next ? activeMs : idleMs)
    }
    const onVisibility = () => {
      if (hidden()) {
        if (timer) clearTimeout(timer)
        timer = undefined
      } else if (!timer && !busy) void tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    void tick()
    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [activeMs, idleMs])

  return view
}
