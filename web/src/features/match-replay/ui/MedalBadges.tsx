// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * MedalBadges — medal badges AS IMAGES (POC): the game's badge is recognized at a
 * glance, the label and description live in the tooltip where they cost nothing.
 * NO inversion or tinting: a medal is a COLORED piece.
 *
 * FALLBACK: a medal with no visual keeps its OWN TEXT — never another medal's badge.
 *
 * Extracted from `ReplayKillFeed.tsx` on 2026-08-16, when the feed crossed the repo's
 * size threshold by taking on identity marks: this block has no connection to the row
 * that carries it (it ignores killer, victim, team colors), so it's the one that moves out.
 */
import type { MedalEvent } from '../model/killFeedLogic'

/** Side of a medal badge, in px (option 2a from the 2026-08-27 handoff: 16 px). */
const MEDAL_PX = 16

/** A medal's display label: the localized label, otherwise the film's English name. */
export function libelleMedale(medal: MedalEvent): string {
  return medal.label || medal.name
}

export function MedalBadges({ medals }: { medals: readonly MedalEvent[] }) {
  return (
    <>
      {medals.map((m, i) => {
        const label = libelleMedale(m)
        const tooltip = m.description ? `${label} — ${m.description}` : label
        return m.imageUrl ? (
          <img
            key={`${m.name}-${m.tMs}-${i}`}
            src={m.imageUrl}
            alt={label}
            title={tooltip}
            width={MEDAL_PX}
            height={MEDAL_PX}
            className="inline-block object-contain"
            loading="lazy"
          />
        ) : (
          <span
            key={`${m.name}-${m.tMs}-${i}`}
            title={tooltip}
            className="rounded-sm border border-border px-1 text-3xs text-muted-foreground"
          >
            {label}
          </span>
        )
      })}
    </>
  )
}
