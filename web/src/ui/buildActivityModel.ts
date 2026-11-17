// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * buildActivityModel — the header's build indicator: reads `GET /api/builds` (the server's active
 * build and its queue, labeled in plain words) and reduces it to what the header shows. The
 * reduction is pure (`buildActivityView`); `useBuildActivity` polls every 3 s while something
 * builds and every 10 s when idle, and not at all while the tab is hidden.
 */
import { useEffect, useState } from 'react'

export interface BuildsBody {
  active: { key: string; label: string; elapsedMs?: number; step?: string } | null
  queued: { key: string; label: string }[]
  /** Across every job the server has ever queued this run (LOCAL-CHANGE (infinite-theater-3d),
   * OptimizeBanner.tsx): `done` finished jobs plus the active job's own fraction, over
   * `total`; `fraction` is that already divided, 0 when `total` is 0. */
  overall?: { done: number; total: number; fraction: number }
}

export interface BuildActivityView {
  /** "Vacancy Forge layer" — the active build's label. */
  label: string
  /** How many builds wait behind it. */
  queued: number
  /** The tooltip: the active build, then the queue in order. */
  title: string
}

export const BUILDS_ACTIVE_POLL_MS = 3000
export const BUILDS_IDLE_POLL_MS = 10000

/** buildActivityView: null when nothing builds (the indicator hides). */
export function buildActivityView(body: BuildsBody | null): BuildActivityView | null {
  if (!body?.active) return null
  const queue = body.queued ?? []
  const lines = [`Building: ${body.active.label}`, ...queue.map((q, i) => `${i + 1}. ${q.label}`)]
  if (queue.length) lines.splice(1, 0, 'Queued:')
  return { label: body.active.label, queued: queue.length, title: lines.join('\n') }
}

/** fetchBuilds reads GET /api/builds; exported so OptimizeBanner (optimizeBannerModel.ts)
 * polls the same endpoint without duplicating the fetch/parse. */
export async function fetchBuilds(signal: AbortSignal): Promise<BuildsBody | null> {
  try {
    const res = await fetch('/api/builds', { signal })
    if (!res.ok) return null
    const body = (await res.json()) as BuildsBody
    return body && typeof body === 'object' ? body : null
  } catch {
    return null
  }
}

/** useBuildActivity: the indicator's view, polled while the tab is visible. */
export function useBuildActivity(activeMs = BUILDS_ACTIVE_POLL_MS, idleMs = BUILDS_IDLE_POLL_MS): BuildActivityView | null {
  const [view, setView] = useState<BuildActivityView | null>(null)

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
      const next = buildActivityView(body)
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
