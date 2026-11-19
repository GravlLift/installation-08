// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ProgressLine — the pre-game page's one progress line: the real step name and, when the
 * state carries a fraction, the determinate bar; otherwise the bar indeterminate. An optional
 * `detail` (the build's current step and time in it) renders one small, dim line under the
 * step name: nothing renders when it is absent, and it reserves a single line of height while
 * shown so the bar and the step never move as the build's text changes. Nothing invents a
 * percentage.
 */
export function ProgressLine({ label, fraction, detail }: { label: string; fraction: number | null; detail?: string }) {
  return (
    <div className="bc-progress">
      <div className="bc-bar">
        <i
          className={fraction === null ? 'indeterminate' : ''}
          style={fraction === null ? undefined : { width: `${Math.round(fraction * 100)}%` }}
        />
      </div>
      <div className="bc-step">{label}</div>
      {detail ? <div className="bc-detail">{detail}</div> : null}
    </div>
  )
}
