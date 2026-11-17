// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * BuildActivity — the header's "Building: Vacancy Forge layer · 2 queued" indicator, with a
 * small pulsing mark; the tooltip lists the queue. Hidden when nothing builds. At narrow
 * widths the queue count goes first, then the label shortens to "Building…" (broadcast.css).
 */
import { useBuildActivity } from './buildActivityModel'

export function BuildActivity({ pollMs }: { pollMs?: { active: number; idle: number } }) {
  const view = useBuildActivity(pollMs?.active, pollMs?.idle)
  if (!view) return null
  return (
    <div className="bc-builds" role="status" title={view.title} data-testid="build-activity">
      <span className="bc-builds-mark" aria-hidden="true" />
      <span className="bc-builds-full">Building: {view.label}</span>
      <span className="bc-builds-short">Building…</span>
      {view.queued > 0 && <span className="bc-builds-queue">· {view.queued} queued</span>}
    </div>
  )
}
