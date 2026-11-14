/**
 * Ticker — the status line along the bottom of every broadcast page: free-form status
 * items on the left (server state, "N matches stored", the coatings notice) and the
 * key hints for the current page on the right (e.g. ["Up/Down", "Move"], ["Enter", "Select"]).
 */
import type { ReactNode } from 'react'

export interface TickerProps {
  /** The status items, left to right. */
  items?: ReactNode[]
  /** The key hints, right-aligned: [key, label] pairs. */
  keys?: [string, string][]
}

export function Ticker({ items, keys }: TickerProps) {
  return (
    <div className="bc-ticker">
      {items}
      {keys && keys.length > 0 ? (
        <span className="bc-keys">
          {keys.map(([key, label]) => (
            <span key={label}>
              <span className="bc-key">{key}</span>
              {label}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  )
}

/** A status dot: green when good, red for a failed state (e.g. the server is down). */
export function TickerDot({ bad = false }: { bad?: boolean }) {
  return <span className={'bc-dot' + (bad ? ' bad' : '')} aria-hidden="true" />
}
