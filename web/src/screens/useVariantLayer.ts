// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { useEffect, useState } from 'react'

import { qualityQuery, type MeshQuality } from '../lib/api/standalone'

/**
 * useVariantSource — the match's variant layer as the server has it: its URL once built, and
 * `pending` while the state is still being checked or the layer is queued or building (an absent
 * layer, or one built by an older version, is built on the spot). Not pending without a URL: the match has no layer, or it could not
 * be checked or built. The variant route takes the same `?quality=` as the mesh route, so a
 * `high` layer is a separate file the server builds on first request; standard sends no
 * parameter (the URL stays the pre-quality one).
 */
export function useVariantSource(matchId: string, quality?: MeshQuality): { path: string | null; pending: boolean; progress?: number; stage?: string } {
  const [result, setResult] = useState<{ id: string; url: string | null; pending: boolean; progress?: number; stage?: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    // The quality query goes after the route's last segment (`variant/state?quality=high`,
    // `variant.glb?quality=high`); placed after `variant` it would swallow the segment.
    const base = `/api/matches/${encodeURIComponent(matchId)}/variant`
    const q = qualityQuery(quality)
    // The result is keyed by match AND quality, so a quality switch reads as a fresh request
    // (pending) until the new quality's check settles, not as a stale standard layer.
    const key = `${matchId}:${quality ?? 'standard'}`
    let timer: ReturnType<typeof setTimeout> | undefined
    let fallback: string | null = null
    const settle = (url: string | null) => setResult({ id: key, url, pending: false })
    const check = async (build = false) => {
      try {
        const response = await fetch(`${base}/${build ? 'build' : 'state'}${q}`, {
          method: build ? 'POST' : 'GET', signal: controller.signal,
        })
        if (controller.signal.aborted) return
        if (!response.ok) return settle(fallback)
        const body = await response.json() as { state: string; progress?: number; stage?: string }
        if (controller.signal.aborted) return
        if (body.state === 'ready') settle(`${base}.glb${q}`)
        // An outdated layer (built by an older version, `meshjobs.StateOutdated`) is rebuilt like an
        // absent one: skipping it dropped the match's Forge objects. Asked once; a build request
        // that still answers absent or outdated settles without the layer instead of looping.
        else if ((body.state === 'absent' || body.state === 'outdated') && !build) void check(true)
        else if (body.state === 'queued' || body.state === 'building') {
          if (quality === 'high' && !fallback) {
            try {
              const standard = await fetch(`${base}/state`, { signal: controller.signal })
              if (standard.ok && (await standard.json() as { state: string }).state === 'ready') fallback = `${base}.glb`
            } catch { /* The selected quality can still finish. */ }
          }
          if (controller.signal.aborted) return
          setResult({ id: key, url: fallback, pending: !fallback, progress: body.progress, stage: body.stage })
          timer = setTimeout(() => void check(), 2000)
        }
        else settle(fallback)
      } catch (error) {
        if (controller.signal.aborted) return
        console.warn('Variant build failed', error)
        settle(fallback)
      }
    }
    void check()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [matchId, quality])
  if (result?.id !== `${matchId}:${quality ?? 'standard'}`) return { path: null, pending: true }
  return { path: result.url, pending: result.pending, progress: result.progress, stage: result.stage }
}

export function useVariantLayer(matchId: string): string | null {
  return useVariantSource(matchId).path
}
