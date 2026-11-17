// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ProgressLine — the pre-game page's one progress line: the real step name and, when the
 * state carries a fraction, the determinate bar; otherwise the bar indeterminate. Nothing
 * invents a percentage.
 */
export function ProgressLine({ label, fraction }: { label: string; fraction: number | null }) {
  return (
    <div className="bc-progress">
      <div className="bc-bar">
        <i
          className={fraction === null ? 'indeterminate' : ''}
          style={fraction === null ? undefined : { width: `${Math.round(fraction * 100)}%` }}
        />
      </div>
      <div className="bc-step">{label}</div>
    </div>
  )
}
