// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import * as THREE from 'three'
import type { ReplayDocumentReady, ReplayWeaponPadReady } from '@/lib/replay/replayNormalize'
import { frameToMs } from '@/lib/replay/replayLogic'
import { useTitleSlug } from '@/lib/title-routing'
import { padIconRefFor } from '../layers/useReplayWeaponPads'
import { navpointStateAt, projectNavpoint } from '../scene3d/padNavpoint3d'
import type { ReplayScene3d } from '../scene3d/replayScene3d'
import { toThree } from '../scene3d/tracks3d'

interface NavpointStyle { iconWidth: number; iconHeight: number; iconAlpha: number; numericTimerSize: number; numericTimerOffsetY: number }
interface Marker { x: number; y: number; seconds: number | null; icon: NonNullable<ReturnType<typeof padIconRefFor>> }

export function PadNavpoints3d({ doc, sceneRef, frameRef }: { doc: ReplayDocumentReady; sceneRef: RefObject<ReplayScene3d | null>; frameRef: RefObject<number> }) {
  const host = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<NavpointStyle | null>(null)
  const [markers, setMarkers] = useState<Marker[]>([])
  const title = useTitleSlug()
  const pads = useMemo(() => [...doc.weaponPads, ...(doc.padCandidates ?? []).map((pad): ReplayWeaponPadReady => ({ ...pad, spawns: pad.spawns ?? [], presence: pad.presence ?? [] }))], [doc.weaponPads, doc.padCandidates])
  useEffect(() => {
    const controller = new AbortController()
    fetch('/static/weapons-assets/halo_infinite/hud/pad-navpoint.json', { signal: controller.signal }).then((r) => r.ok ? r.json() : null).then((data: NavpointStyle | null) => {
      if (data && data.iconWidth > 0 && data.iconHeight > 0 && data.numericTimerSize > 0) setStyle(data)
    }).catch(() => {})
    return () => controller.abort()
  }, [])
  useEffect(() => {
    if (!style) return
    let raf = 0
    const tick = () => {
      const camera = sceneRef.current?.camera
      const rect = host.current?.getBoundingClientRect()
      if (camera && rect) {
        const result: Marker[] = []
        for (const pad of pads) {
          if (pad.z == null) continue
          const icon = padIconRefFor(pad.weapon, doc.weaponLabels, title)
          if (!icon) continue
          const at = projectNavpoint(new THREE.Vector3(...toThree(pad.x, pad.y, pad.z)), camera, rect.width, rect.height)
          if (!at) continue
          const reading = navpointStateAt(pad, frameRef.current ?? 0, frameToMs(1, doc))
          result.push({ ...at, seconds: reading.seconds, icon })
        }
        setMarkers(result)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [doc, frameRef, pads, sceneRef, style, title])
  return <div ref={host} aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
    {style && markers.map((marker, i) => <div key={i} style={{ position: 'absolute', left: marker.x, top: marker.y, transform: 'translate(-50%, -100%)', width: style.iconWidth, height: style.iconHeight, opacity: style.iconAlpha }}>
      <img alt="" src={marker.icon.url} style={{ width: '100%', height: '100%', objectFit: 'contain', transform: marker.icon.mirrored ? 'scaleX(-1)' : undefined }} />
      {marker.seconds != null && <span style={{ position: 'absolute', left: '50%', top: `calc(50% + ${style.numericTimerOffsetY}px)`, transform: 'translateX(-50%)', fontSize: style.numericTimerSize }}>{Math.ceil(marker.seconds)}</span>}
    </div>)}
  </div>
}
