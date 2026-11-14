/**
 * homeScreenModel — the pure logic of the Home page (brief 123): picking the featured
 * match, formatting its facts, building the main-menu rows and the ticker contents. No
 * React and no network here, so it is unit-tested directly. The older `homeScreenLogic.ts`
 * holds the account-panel and remote-matches helpers this page does not need; the two files
 * stay separate.
 */
import type { MatchSummary } from '../lib/api/standalone'

/** One fact cell of the featured plate: an eyebrow label and its value. */
export interface FeaturedFact {
  label: string
  value: string
}

/** The facts the featured plate shows: the map name, and one cell per entry. */
export interface FeaturedFacts {
  mapName: string
  facts: FeaturedFact[]
}

/** One main-menu row. */
export interface HomeMenuItem {
  /** The row's big name. */
  name: string
  /** The small line under the name. */
  sub: string
  /** The route the row goes to. */
  route: string
}

/** Whether a match names when it was played (an ISO instant). */
export function matchPlayTime(m: MatchSummary): string {
  return m.startTime ?? m.importedAt
}

/** The most recently played match: newest `startTime` (falling back to `importedAt`), or
 *  `null` when the list is empty. */
export function featuredMatch(matches: MatchSummary[]): MatchSummary | null {
  let best: MatchSummary | null = null
  for (const m of matches) {
    if (!best) { best = m; continue }
    if (matchPlayTime(m) > matchPlayTime(best)) best = m
  }
  return best
}

/** The map name as the plate shows it: no trailing " - Ranked". */
export function cleanMapName(m: MatchSummary): string {
  const name = m.mapName || m.mapModule || 'Unknown map'
  return name.replace(/\s*-\s*Ranked$/i, '')
}

/** The score line: "3 : 1" from `scoreMine`/`scoreTheirs` when present, else the team
 *  scores, else nothing. */
export function scoreLabel(m: MatchSummary): string {
  if (m.scoreMine !== undefined && m.scoreTheirs !== undefined) {
    return `${m.scoreMine} - ${m.scoreTheirs}`
  }
  if (m.teamScores) return `${m.teamScores[0]} - ${m.teamScores[1]}`
  return ''
}

/** "Victory" or "Defeat", and only for a win or loss outcome. */
export function resultLabel(m: MatchSummary): string {
  if (m.outcome === 'win') return 'Victory'
  if (m.outcome === 'loss') return 'Defeat'
  return ''
}

/** Formats an ISO instant as a locale date (the raw string when it does not parse). */
export function formatPlayedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Builds the featured plate's facts from one match (omitting empty cells). */
export function featuredFacts(m: MatchSummary): FeaturedFacts {
  const facts: FeaturedFact[] = []
  const mode = m.modeName ?? ''
  if (mode) facts.push({ label: 'Mode', value: mode })
  const score = scoreLabel(m)
  if (score) facts.push({ label: 'Final', value: score })
  const result = resultLabel(m)
  if (result) facts.push({ label: 'Result', value: result })
  facts.push({ label: 'Played', value: formatPlayedAt(matchPlayTime(m)) })
  return { mapName: cleanMapName(m), facts }
}

/** The main menu, exactly the rows the page can do: Watch always; Recent matches when
 *  signed in (the match list carries the account panel and the remote list); Sign in
 *  when signed out (it goes to the same panel). */
export function homeMenu(signedIn: boolean): HomeMenuItem[] {
  const menu: HomeMenuItem[] = [
    { name: 'Watch', sub: 'Pick a stored match and play it', route: '/matches' },
  ]
  if (signedIn) {
    menu.push({ name: 'Recent matches', sub: 'Fetch games from your account', route: '/matches' })
  } else {
    menu.push({ name: 'Sign in', sub: 'Connect your Xbox account', route: '/matches' })
  }
  return menu
}

/** The ticker's left-hand items: the stored-match count, and the coatings notice when
 *  there is one. The server-state item (dot + text) is the page's to render. */
export function tickerItems(matchCount: number, coatingsNotice: string | null): string[] {
  const items: string[] = [`${matchCount} match${matchCount === 1 ? '' : 'es'} stored`]
  if (coatingsNotice) items.push(coatingsNotice)
  return items
}
