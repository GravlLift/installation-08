import type { MatchSummary, RemoteMatch } from '../lib/api/standalone'

/** Formats an ISO timestamp the way a header reads best (e.g. "Nov 11, 2026, 11:04 PM").
 *  Falls back to the raw string if it does not parse. */
function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * MatchHeaderBar — the full-width bar above the 3D viewer: the back button, plus the match's map
 * name (`useMatchSummary`), and its mode and played time from the same row of "Your recent
 * matches" (`useRemoteMatch`). Without that row (signed out, or the match is no longer among the
 * recent ones) the bar falls back to the import time. Either may be `null` while loading; the
 * bar still renders (at least the back button), so the layout never jumps.
 */
export function MatchHeaderBar({
  summary,
  remote,
  onBack,
}: {
  summary: MatchSummary | null
  remote: RemoteMatch | null
  onBack: () => void
}) {
  const mapName = summary ? summary.mapName || summary.mapModule || null : remote?.map || null
  return (
    <header className="flex h-12 flex-shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-foreground">
      <button
        type="button"
        onClick={onBack}
        className="shrink-0 rounded bg-background px-2 py-1 text-xs hover:bg-muted"
      >
        ← Matches
      </button>
      {(summary || remote) && (
        <div className="flex min-w-0 items-baseline gap-2 truncate text-sm">
          <span className="truncate font-semibold">{mapName ?? 'Unknown map'}</span>
          {remote?.mode && <span className="shrink-0 truncate">{remote.mode}</span>}
          <span className="shrink-0 truncate text-xs text-muted-foreground">
            {remote?.time
              ? `Played ${formatTimestamp(remote.time)}`
              : summary && `Imported ${formatTimestamp(summary.importedAt)}`}
          </span>
        </div>
      )}
    </header>
  )
}
