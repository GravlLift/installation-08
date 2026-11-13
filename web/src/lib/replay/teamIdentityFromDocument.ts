/**
 * teamIdentityFromDocument.ts — team-aware colors and names from the DOCUMENT ALONE.
 *
 * LevelUp's own replay page gets this from `useSlotIdentity` (`features/match-replay/
 * layers/useSlotIdentity.ts` in the source repo), which layers `rosterLogic.ts` with a
 * scoreboard join (gamertags that survive a rename) and `seatLogic.ts` (bot-takeover
 * "fiche" gating — a human relieving a bot loses its pawn). Neither of those two extras is
 * available to this standalone shell: there is no Match View scoreboard here (no
 * `/replay/context`), and `seatLogic.ts` was not lifted into this worktree (see
 * `docs/PARITY.md` §1, `action.seatedOfXuid`).
 *
 * What IS fully available from the document alone is the film's own roster
 * (`doc.roster[].team`) — the SOLE source of team membership and allegiance ink on the
 * replay page (ADR 0034 D-9) — so this builds the same color/name resolvers `rosterLogic.ts`
 * already exports, with an empty scoreboard (gamertags fall back to the film's own name,
 * same as `displayPlayerName`) and no seat gating (every slot with an owner draws, matching
 * this shell's prior behavior of `seatedOfXuid: () => true`).
 */
import { buildFilmAllegiance, type FilmAllegiance } from './filmAllegiance'
import type { ReplayDocumentReady } from './replayNormalize'
import {
  buildPlayers,
  buildSlotOwnership,
  colorByXuidResolver,
  colorResolver,
  nameByXuidResolver,
  nameResolver,
} from './rosterLogic'

export interface DocumentTeamIdentity {
  allegiance: FilmAllegiance
  colorOfSlot: (slot: number, frame: number) => string | null
  colorOfXuid: (xuid: string) => string | null
  nameOfSlot: (slot: number, frame: number) => string | null
  nameOfXuid: (xuid: string) => string | null
}

/**
 * buildDocumentTeamIdentity — `reference` is the xuid whose camp counts as "ally" (the
 * followed viewpoint, falling back to the first roster entry so a page with no viewpoint
 * selected still tints by camp rather than going fully neutral).
 */
export function buildDocumentTeamIdentity(
  doc: ReplayDocumentReady,
  reference: string | null,
  teamColorOf: (ally: boolean) => string,
  neutral: string,
): DocumentTeamIdentity {
  const players = buildPlayers(doc, [])
  const ownership = buildSlotOwnership(players)
  const allegiance = buildFilmAllegiance(players, reference ?? doc.roster[0]?.xuid ?? null)
  const allyOf = allegiance.ofPlayer
  return {
    allegiance,
    colorOfSlot: colorResolver(ownership, teamColorOf, allyOf, neutral),
    colorOfXuid: colorByXuidResolver(players, teamColorOf, allyOf, neutral),
    nameOfSlot: nameResolver(ownership),
    nameOfXuid: nameByXuidResolver(players),
  }
}
