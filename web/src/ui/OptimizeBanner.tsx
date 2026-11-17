// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * OptimizeBanner — a thin bar fixed to the very top of every page while the server's startup
 * builds (weapons, first-person, Spartan pieces, map meshes) are still running: a progress
 * fill (the overall fraction across every job), the line "Optimizing assets. Playback may be
 * less smooth until this finishes." and the current step in plain words ("Weapons 84/190").
 * It disappears the instant the queue empties.
 *
 * It never overlaps anything: it is `position: fixed` at the top with its own height, and
 * while it shows it adds `bc-has-optimize-bar` to `<body>`, which broadcast.css reads to push
 * every page's own fixed-to-the-viewport frame (`.bc-stage`, `.bc-player`) down by that height
 * — including the replay viewer, whose minimap/camera-view corner stays inside its own frame
 * and so moves down with it, never covered.
 */
import { useEffect, useRef } from 'react'

import { useOptimizeBanner } from './optimizeBannerModel'

const BODY_CLASS = 'bc-has-optimize-bar'

export function OptimizeBanner({ pollMs }: { pollMs?: { active: number; idle: number } }) {
  const view = useOptimizeBanner(pollMs?.active, pollMs?.idle)
  const shown = useRef(false)

  useEffect(() => {
    const visible = view !== null
    if (visible === shown.current) return
    shown.current = visible
    document.body.classList.toggle(BODY_CLASS, visible)
    return () => document.body.classList.remove(BODY_CLASS)
  }, [view])

  if (!view) return null
  const percent = Math.round(view.fraction * 100)
  return (
    <div className="bc-optimize-bar" role="status" data-testid="optimize-banner">
      <div className="bc-optimize-fill" style={{ width: `${percent}%` }} />
      <div className="bc-optimize-text">
        <span>Optimizing assets. Playback may be less smooth until this finishes.</span>
        <span className="bc-optimize-step">{view.step}</span>
      </div>
    </div>
  )
}
