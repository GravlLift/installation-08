// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * HomeCredits — the home screen's credits corner (bottom left): the projects this app builds
 * on, each a link to its source with its author beside it, and a last link to the full credits
 * (README's Credits section, which NOTICE.md's additional term points to). Names and links only.
 *
 * Every link is a plain anchor to another site: in the app window the injected external-link
 * script (cmd/infinite-theater-3d/window.go, externalLinksJS) hands it to the default browser,
 * so the window never navigates away; in a browser tab it opens a new tab.
 */

/** One credited project: its name (the link), its source and its author. */
export interface Credit {
  project: string
  href: string
  author: string
}

/** The credited projects, in the order the corner lists them. */
export const HOME_CREDITS: readonly Credit[] = [
  { project: 'LevelUp', href: 'https://github.com/JGtm/LevelUp', author: 'JGtm' },
  { project: 'OpenSpartan', href: 'https://github.com/dend', author: 'Den Delimarsky' },
  { project: 'Ekur', href: 'https://github.com/TheHaloArchive/ekur', author: 'The Halo Archive' },
  { project: 'SPNKr', href: 'https://github.com/acurtis166/SPNKr', author: 'Andy Curtis' },
]

/** The full credits: README's Credits section on GitHub. */
export const FULL_CREDITS_URL = 'https://github.com/llampwall/infinite-theater-3d#credits'

export function HomeCredits() {
  return (
    <nav className="bc-home-credits" aria-label="Credits">
      <div className="bc-eyebrow">Credits</div>
      <ul className="bc-credits-list">
        {HOME_CREDITS.map((c) => (
          <li key={c.project}>
            <a className="bc-credit-project" href={c.href} target="_blank" rel="noopener noreferrer">
              {c.project}
            </a>
            <span className="bc-credit-author">{c.author}</span>
          </li>
        ))}
      </ul>
      <a className="bc-credits-more" href={FULL_CREDITS_URL} target="_blank" rel="noopener noreferrer">
        More in NOTICE
      </a>
    </nav>
  )
}
