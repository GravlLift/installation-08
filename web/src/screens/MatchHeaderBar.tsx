import type { MatchSummary } from '../lib/api/standalone'

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
 * name and import time once `useMatchSummary` has them. `summary` is `null` while that is still
 * loading or the server has no row for this id — the bar still renders (just the back button),
 * so the layout never jumps and the back button is never blocked by the viewer's own controls.
 *
 * The game mode/variant is NOT shown here: no route this app talks to carries it for an already
 * imported match. `store.Match` (`internal/store/match.go`) has no mode field, and the Xbox
 * API's mode/start-time (`internal/haloapi.Match.Mode`/`.Time`) is read only before import and
 * discarded at import time in `cmd/infinite-theater-3d/import.go` — it is exposed solely by
 * `GET /api/remote/matches`, the pre-import remote list, not by anything keyed on a local match
 * id. The timestamp shown is therefore when the match was *imported* into this store, not when
 * it was played — the closest the current routes get.
 */
export function MatchHeaderBar({
  summary,
  onBack,
}: {
  summary: MatchSummary | null
  onBack: () => void
}) {
  const mapName = summary ? summary.mapName || summary.mapModule || null : null
  return (
    <header className="flex h-12 flex-shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-foreground">
      <button
        type="button"
        onClick={onBack}
        className="shrink-0 rounded bg-background px-2 py-1 text-xs hover:bg-muted"
      >
        ← Matches
      </button>
      {summary && (
        <div className="flex min-w-0 items-baseline gap-2 truncate text-sm">
          <span className="truncate font-semibold">{mapName ?? 'Unknown map'}</span>
          <span className="shrink-0 truncate text-xs text-muted-foreground">
            Imported {formatTimestamp(summary.importedAt)}
          </span>
        </div>
      )}
    </header>
  )
}
