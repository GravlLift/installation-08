// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * matchSelectModel — the pure logic of the match select page (brief 124): the merge of the
 * stored matches and the account's recent matches into one time-sorted list, the tab
 * filtering, the row and preview view models, and the fetch-state labels. No React and no
 * network here, so it is unit-tested directly. The screen is a thin render of this model plus
 * the hooks (`useAuthState`, `useRemoteMatches`, `useMatchFetchQueue`), whose data flow is
 * unchanged by the redesign.
 */
import type { MatchSummary, RemoteMatch } from '../lib/api/standalone'
import type { FetchRowPhase } from './useMatchFetchQueue'

/** The tabs above the list. "Recent" (the not-stored rows) is hidden when signed out. */
export const MATCH_TABS = ['All', 'Stored', 'Ranked', 'Recent'] as const
export type MatchTab = (typeof MATCH_TABS)[number]

/** One row of the one list: a stored match, or a recent match not stored yet. */
export type MatchRow =
  | { kind: 'stored'; id: string; match: MatchSummary }
  | { kind: 'remote'; id: string; match: RemoteMatch }

/** The list's time key: when the match was played, newest first. A stored match without a
 *  play time falls back to its import time; a remote match falls back to its id so the sort
 *  stays total. */
export function playTimeOf(row: MatchRow): string {
  if (row.kind === 'stored') return row.match.startTime ?? row.match.importedAt
  return row.match.time || row.match.id
}

/** The set of stored match ids. */
export function localMatchIdSet(matches: MatchSummary[]): Set<string> {
  return new Set(matches.map((m) => m.matchId))
}

/** Merges the stored matches and the account's recent matches into one list, newest first.
 *  A recent match that is already stored appears once, as stored; the rest appear as
 *  remote rows. The result is sorted by time played, newest first, and the sort is stable
 *  within equal keys (stored rows keep their order before remote ones). */
export function mergeMatchRows(
  stored: MatchSummary[],
  remote: RemoteMatch[],
  localIds: Set<string>,
): MatchRow[] {
  const rows: MatchRow[] = stored.map((m) => ({ kind: 'stored', id: m.matchId, match: m }))
  for (const m of remote) {
    if (!localIds.has(m.id)) rows.push({ kind: 'remote', id: m.id, match: m })
  }
  return rows.sort((a, b) => playTimeOf(b).localeCompare(playTimeOf(a)))
}

/** Which tabs the page shows: Recent is hidden when signed out. */
export function visibleTabs(signedIn: boolean): MatchTab[] {
  return signedIn ? [...MATCH_TABS] : MATCH_TABS.filter((t) => t !== 'Recent')
}

/** Filters the one list by a tab. Ranked is stored matches only (a remote row does not
 *  publish whether it was ranked). */
export function filterByTab(rows: MatchRow[], tab: MatchTab, signedIn: boolean): MatchRow[] {
  switch (tab) {
    case 'All':
      return rows
    case 'Stored':
      return rows.filter((r) => r.kind === 'stored')
    case 'Ranked':
      return rows.filter((r) => r.kind === 'stored' && r.match.isRanked === true)
    case 'Recent':
      return signedIn ? rows.filter((r) => r.kind === 'remote') : []
  }
}

/** Whether `row` is the one `focusId` names in this filtered list (`null` when absent). */
export function indexOfRow(rows: MatchRow[], focusId: string | null): number {
  if (focusId === null) return 0
  const i = rows.findIndex((r) => r.id === focusId)
  return i < 0 ? 0 : i
}

/** The map name as a row or the plate shows it: no trailing " - Ranked". */
export function cleanMapName(name: string): string {
  return name.replace(/\s*-\s*Ranked$/i, '')
}

/** The score line: "3 - 1" from `scoreMine`/`scoreTheirs` when present, else the team
 *  scores, else `null`. */
export function scoreLabel(match: MatchSummary): string | null {
  if (match.scoreMine !== undefined && match.scoreTheirs !== undefined) {
    return `${match.scoreMine} - ${match.scoreTheirs}`
  }
  if (match.teamScores) return `${match.teamScores[0]} - ${match.teamScores[1]}`
  return null
}

/** "Victory" or "Defeat", and only for a win or loss outcome. */
export function resultLabel(match: MatchSummary): string {
  if (match.outcome === 'win') return 'Victory'
  if (match.outcome === 'loss') return 'Defeat'
  return ''
}

/** Formats a duration in ms as `M:SS`. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
}

/** Formats an ISO instant as a locale date (the raw string when it does not parse). */
export function formatPlayedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** The eyebrow of the preview plate: the playlist and the mode, joined by " / ". */
export function eyebrowOf(match: MatchSummary): string {
  return [match.playlistName, match.modeName].filter(Boolean).join(' / ')
}

/** The meta line of the player's top strip (brief 127): the mode and when the match was
 *  played. The stored summary wins (`modeName`, `startTime`); then the remote row
 *  (`mode`, `time`); then the import date. `''` when nothing is known. */
export function playerTopMeta(summary: MatchSummary | null, remote: RemoteMatch | null): string {
  const mode = summary?.modeName || remote?.mode || ''
  const time = summary?.startTime || remote?.time || ''
  const played = time
    ? formatPlayedAt(time)
    : summary
      ? `Imported ${formatPlayedAt(summary.importedAt)}`
      : ''
  return [mode, played].filter(Boolean).join(' · ')
}

/** One fact cell of the preview plate: a label and its value. */
export interface SelectFact {
  label: string
  value: string
}

/** A roster team in the preview plate: a title and its player names. */
export interface SelectRosterTeam {
  title: string
  names: string[]
}

/** The preview of a focused row. A remote row has no facts, rosters or score: the plate
 *  says the match is not fetched yet and what Enter does. */
export interface SelectPreview {
  title: string
  eyebrow: string | null
  imageUrl: string | null
  facts: SelectFact[]
  rosters: SelectRosterTeam[]
  note: string | null
}

/** The preview of one row. `gamertag` is the signed-in player's name; when they are in the
 *  match the teams are read from their side ("Your team" first), else "Team 1" and "Team 2". */
export function previewOf(row: MatchRow, gamertag: string | null): SelectPreview {
  if (row.kind === 'remote') {
    const m = row.match
    return {
      title: cleanMapName(m.map || 'Unknown map'),
      eyebrow: m.mode || null,
      imageUrl: m.mapImageUrl ?? null,
      facts: [],
      rosters: [],
      note: 'This match is not fetched yet. Press Enter to fetch it; it plays automatically once it is ready.',
    }
  }
  const m = row.match
  const facts: SelectFact[] = []
  const score = scoreLabel(m)
  if (score) facts.push({ label: 'Final', value: score })
  facts.push({ label: 'Length', value: formatDuration(m.durationMs) })
  facts.push({ label: 'Played', value: formatPlayedAt(m.startTime ?? m.importedAt) })
  return {
    title: cleanMapName(m.mapName || m.mapModule || 'Unknown map'),
    eyebrow: eyebrowOf(m) || null,
    imageUrl: m.mapImageUrl ?? null,
    facts,
    rosters: rostersOf(m, gamertag),
    note: null,
  }
}

/** The players' rosters by team, with the signed-in player's team first when they are in
 *  the match. Campless players (no team, the film's `-1`) are left out. */
export function rostersOf(match: MatchSummary, gamertag: string | null): SelectRosterTeam[] {
  const players = match.players ?? []
  const teams = new Map<number, string[]>()
  for (const p of players) {
    if (p.teamId < 0) continue
    const names = teams.get(p.teamId) ?? []
    names.push(p.name)
    teams.set(p.teamId, names)
  }
  const ids = [...teams.keys()].sort((a, b) => a - b)
  const mine = myTeamIndex(ids, players, gamertag)
  const ordered = mine === -1 ? ids : [ids[mine], ...ids.filter((t) => t !== ids[mine])]
  const named = mine !== -1
  return ordered.map((teamId, i) => ({
    title: named ? (i === 0 ? 'Your team' : 'Opponents') : `Team ${i + 1}`,
    names: teams.get(teamId) ?? [],
  }))
}

/** The index of the signed-in player's team among the match's teams, or -1. */
function myTeamIndex(
  ids: number[],
  players: { name: string; teamId: number }[],
  gamertag: string | null,
): number {
  if (!gamertag) return -1
  const me = gamertag.replace(/\s+/g, '').toLowerCase()
  for (const p of players) {
    if (me && p.name.replace(/\s+/g, '').toLowerCase() === me) {
      return ids.indexOf(p.teamId)
    }
  }
  return -1
}

/** The right side of a stored row: the score and the result mark. `null` when the match
 *  publishes neither. */
export function storedAside(match: MatchSummary): { score: string; result: string } | null {
  const score = scoreLabel(match)
  if (!score) return null
  return { score, result: resultLabel(match) }
}

/** The label a fetch row shows in place of the score. The wording of the failed states
 *  stays the one the old panel used, including the film-that-is-no-longer-available one. */
export function fetchStateLabel(phase: FetchRowPhase): string {
  switch (phase.phase) {
    case 'idle':
      return 'Fetch'
    case 'queued':
      return phase.position > 1 ? `Queued (${phase.position})…` : 'Queued…'
    case 'downloading':
      return `Downloading… ${phase.done}/${phase.total}`
    case 'building':
      return 'Building…'
    case 'ready':
      return 'Ready'
    case 'blocked':
      return 'Another fetch is already in progress…'
    case 'failed':
      return phase.error === 'film not available'
        ? 'This film is no longer available on the Halo service.'
        : `Fetch failed: ${phase.error}`
  }
}
