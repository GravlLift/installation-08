import { useEffect, useState } from 'react'

export function useVariantLayer(matchId: string): string | null {
  const [result, setResult] = useState<{ id: string; url: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const base = `/api/matches/${encodeURIComponent(matchId)}/variant`
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = async (build = false) => {
      try {
        const response = await fetch(`${base}/${build ? 'build' : 'state'}`, {
          method: build ? 'POST' : 'GET', signal: controller.signal,
        })
        if (!response.ok) return
        const body = await response.json() as { state: string }
        if (controller.signal.aborted) return
        if (body.state === 'ready') setResult({ id: matchId, url: `${base}.glb` })
        else if (body.state === 'absent') void check(true)
        else if (body.state === 'queued' || body.state === 'building') timer = setTimeout(() => void check(), 2000)
      } catch (error) {
        if (!controller.signal.aborted) console.warn('Variant build failed', error)
      }
    }
    void check()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [matchId])
  return result?.id === matchId ? result.url : null
}
