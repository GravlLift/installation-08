// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * Plate — the angled panel of the broadcast look (docs/UI-DESIGN.md 5): an eyebrow label,
 * a large display title and free-form children (facts, rosters, a call to action).
 * `as` renders the title with a different heading level when the plate is not the page's
 * main heading.
 */
import type { ReactNode } from 'react'

export interface PlateProps {
  /** The small accent label above the title (e.g. "Featured game"). */
  eyebrow?: string
  /** The title text (the map name on Home). */
  title: ReactNode
  /** The plate body: facts, rosters, buttons. */
  children?: ReactNode
  /** The heading level for the title; the page's main heading should be `1`. */
  as?: 'h1' | 'h2'
}

export function Plate({ eyebrow, title, children, as = 'h1' }: PlateProps) {
  const TitleTag = as
  return (
    <div className="bc-plate">
      {eyebrow ? <div className="bc-eyebrow">{eyebrow}</div> : null}
      <TitleTag className="bc-title">{title}</TitleTag>
      {children}
    </div>
  )
}
