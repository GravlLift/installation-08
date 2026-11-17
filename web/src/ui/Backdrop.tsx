// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * Backdrop — the treated full-screen map image (docs/UI-DESIGN.md 3.3). Two layers cross-fade
 * when `imageUrl` changes (the mockup's `setBackdrop` behavior): the incoming layer is
 * painted and switched on, the other fades out over 600 ms. The CSS treatment (blur, tint,
 * vignette, scanlines, drift) lives in `broadcast.css`; this component only flips the layers
 * and carries the one dynamic value, `background-image`.
 */
import { useEffect, useRef } from 'react'

export interface BackdropProps {
  /** The map image URL; `null` keeps the studio base with no image. */
  imageUrl: string | null
  /** `true` for a sharper treatment (the pre-game and player pages). */
  sharp?: boolean
}

export function Backdrop({ imageUrl, sharp }: BackdropProps) {
  const layerA = useRef<HTMLDivElement>(null)
  const layerB = useRef<HTMLDivElement>(null)
  // Which layer index (0 or 1) is currently on screen; the other receives the new image.
  const onRef = useRef(0)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    const on = onRef.current === 0 ? layerA.current : layerB.current
    const next = onRef.current === 0 ? layerB.current : layerA.current
    if (!on || !next) return
    if (urlRef.current === imageUrl) return
    next.style.backgroundImage = imageUrl ? `url("${imageUrl}")` : 'none'
    next.classList.add('on')
    on.classList.remove('on')
    onRef.current = onRef.current === 0 ? 1 : 0
    urlRef.current = imageUrl
  }, [imageUrl])

  return (
    <div className={'bc-backdrop' + (sharp ? ' sharp' : '')} aria-hidden="true">
      <div ref={layerA} className="bc-layer" />
      <div ref={layerB} className="bc-layer" />
    </div>
  )
}
