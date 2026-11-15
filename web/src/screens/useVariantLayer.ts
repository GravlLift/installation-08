import { useEffect, useState } from 'react'

/**
 * useVariantSource — the match's variant layer as the server has it: its URL once built, and
 * `pending` while the state is still being checked or the layer is queued or building (an absent
 * layer is built on the spot). Not pending without a URL: the match has no layer, or it could not
 * be checked or built.
 */
export function useVariantSource(matchId: string): { path: string | null; pending: boolean } {
  const [result, setResult] = useState<{ id: string; url: string | null; pending: boolean } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const base = `/api/matches/${encodeURIComponent(matchId)}/variant`
    let timer: ReturnType<typeof setTimeout> | undefined
    const settle = (url: string | null) => setResult({ id: matchId, url, pending: false })
    const check = async (build = false) => {
      try {
        const response = await fetch(`${base}/${build ? 'build' : 'state'}`, {
          method: build ? 'POST' : 'GET', signal: controller.signal,
        })
        if (controller.signal.aborted) return
        if (!response.ok) return settle(null)
        const body = await response.json() as { state: string }
        if (controller.signal.aborted) return
        if (body.state === 'ready') settle(`${base}.glb`)
        else if (body.state === 'absent') void check(true)
        else if (body.state === 'queued' || body.state === 'building') timer = setTimeout(() => void check(), 2000)
        else settle(null)
      } catch (error) {
        if (controller.signal.aborted) return
        console.warn('Variant build failed', error)
        settle(null)
      }
    }
    void check()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [matchId])
  if (result?.id !== matchId) return { path: null, pending: true }
  return { path: result.url, pending: result.pending }
}

export function useVariantLayer(matchId: string): string | null {
  return useVariantSource(matchId).path
}
