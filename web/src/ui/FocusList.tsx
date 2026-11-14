/**
 * FocusList — the game-menu row list (docs/UI-DESIGN.md 5): one row per item, exactly one
 * focused. It owns the row rendering (a row is its `name`, an optional `sub` line and an
 * optional right-side `aside`), the aria listbox contract (`role="listbox"`, rows are
 * `role="option"` with `aria-selected`), hover-to-focus, click-to-select, and scrolling
 * the focused row into view. Key handling is `useFocusList`'s.
 */
import { useEffect, useRef, type ReactNode } from 'react'

import { useFocusList } from './useFocusList'

export interface FocusListProps {
  /** One entry per row; the row's text comes from `name` and `sub`. */
  items: { name: string; sub?: string; aside?: ReactNode }[]
  /** Selects the focused row (Enter or a click). */
  onSelect?: (index: number) => void
  /** Back action on Escape, when given. */
  onBack?: () => void
  /** An extra class for the list element (pages size the list from there). */
  className?: string
}

export function FocusList({ items, onSelect, onBack, className }: FocusListProps) {
  const { index, onHover, onClick } = useFocusList({
    count: items.length,
    onSelect,
    onBack,
  })
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    row?.scrollIntoView({ block: 'nearest' })
  }, [index, items.length])

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-orientation="vertical"
      className={'bc-list' + (className ? ' ' + className : '')}
    >
      {items.map((item, i) => (
        <div
          key={item.name}
          role="option"
          aria-selected={i === index}
          className={'bc-row' + (i === index ? ' bc-focus' : '')}
          onMouseEnter={() => onHover(i)}
          onClick={() => onClick(i)}
        >
          <div>
            <div className="bc-name">{item.name}</div>
            {item.sub ? <div className="bc-sub">{item.sub}</div> : null}
          </div>
          {item.aside}
        </div>
      ))}
    </div>
  )
}
