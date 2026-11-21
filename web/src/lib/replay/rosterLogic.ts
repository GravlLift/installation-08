// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * rosterLogic.ts — THE JOIN BETWEEN THE FILM AND THE DATABASE, and a player's state at a frame.
 *
 * TWO SOURCES, TWO ROLES, AND ONE SINGLE KEY. The film carries what happens — positions,
 * lives, deaths, weapons, shield, and each player's TEAM (`roster[].team`, the page's only
 * source of membership AND allegiance, see `ReplayPlayer.team` and
 * `filmAllegiance.ts`) — and identifies them by XUID. The database carries who the people are:
 * gamertag, scoreboard side (which NAMES a side), match K/D/A. Neither does the other's
 * job, and the replay artifact does not try to: it publishes the xuid, which is the only key
 * on which a join assumes nothing.
 *
 * WHY NOT AN INDEX. This project already published a "player index" as a discovery
 * before realizing it was just its own alphabetical sort. An index is an ORDER; the xuid
 * is an IDENTITY. The rule that came out of that fits in one line and applies here: never
 * join on a rank.
 *
 * This whole file is PURE: no React, no canvas, hence testable.
 */
import type { MatchScoreboardRow, ReplayRosterEntry } from '@/lib/api/types'
import { displayPlayerName, stripBotSuffix } from '@/lib/players/displayName'

import { refineAbilityReading, refineWeaponsReading } from './changeRefine'
import type { PlayerMarkKind } from './playerMarks'
import { groupByCamp, type ReplayCamp } from './replayCamps'
import { heldReading, isAliveAt, trackWindow } from './replayLogic'
import type { ReplayDocumentReady, ReplayTrackReady } from './replayNormalize'

/**
 * ReplayPlayer — a replay player: their identity (database) and their lives (film).
 *
 * `board` is absent when the film's xuid has no scoreboard row. This is not supposed to
 * happen, and that is exactly why it is represented instead of being papered over: a film
 * player not found in the database is a signal, not a detail to hide.
 */
export interface ReplayPlayer {
  /**
   * Player identity: the decimal xuid, or — for a BOT, which has none — the
   * synthetic key `bot:<name>` (schema 36). The key never shows on screen: it serves the
   * Maps of this file and its resolvers, the displayed name comes from `filmName`/`board`.
   */
  xuid: string
  /** True for a bot declared by the film (roster/tracks `bot`). */
  bot?: boolean
  /** The match's scoreboard row, when the join succeeds. */
  board?: MatchScoreboardRow
  /** Gamertag written by the FILM. Used when the database has nothing to say about this player. */
  filmName?: string
  /**
   * THE PLAYER'S TEAM: the designator the FILM writes for their roster entry
   * (`roster[].team`, schema 57; `-1` = "no team" for a mode without sides, a reading).
   * It is the ONLY source of membership for the Replay page (ADR 0034 D-9) — all its sides
   * come from it (`replayCamps.ts`), and all its ally/enemy ink (`filmAllegiance.ts`). Absent
   * = the film stays silent on it, or the player has no entry: they belong to no side, have no
   * side ink, and the scoreboard does not substitute for it.
   */
  team?: number
  /** All of this player's lives, in chronological order. */
  lives: ReplayTrackReady[]
}

/** Identity key for a bot in this file's tables — never displayed. */
export function botKey(name: string): string {
  return `bot:${name}`
}

/**
 * rosterEntryKey — the identity key for a roster entry, IN THE SAME SPACE as
 * `ReplayPlayer.xuid` built by `buildPlayers` below: the xuid when it exists,
 * otherwise `botKey(name)` for a bot (`RosterEntry.xuid` is `''` for a bot, never a real
 * xuid — schema 36). A caller who compares `entry.xuid` directly to `player.xuid` never
 * matches a bot (finding P2-5, anonymous-lives audit 2026-09-06: `equipmentUsageLogic`
 * and `playerCardReadings` each carried an occurrence). Centralized here so that the
 * repo's two roster -> player joins that needed it share a single
 * derivation (the <= 2 copies rule, CLAUDE.md #6). `seatLogic.filmIndexByIdentity` carried a
 * 3rd inline copy (correct, but not centralized): migrated on 2026-09-10 — grep guard rail:
 * `apps/web/src/lib/replay/rosterEntryKey_no_new_copies.guard.test.ts`. `buildPlayers`
 * also uses it: it is through it that an entry's team reaches its player.
 */
export function rosterEntryKey(entry: Pick<ReplayRosterEntry, 'xuid' | 'bot' | 'name'>): string {
  return entry.xuid || (entry.bot && entry.name ? botKey(entry.name) : '')
}

/**
 * playerName chooses the name to display.
 *
 * DATABASE FIRST, FILM SECOND. Both say the same gamertag, but the database is the one that
 * follows a name change: the film freezes the name as of the match day. When there is no
 * scoreboard row, the film's name avoids falling back to "unknown player"
 * for someone the film names perfectly well.
 */
export function playerName(player: ReplayPlayer): string | null {
  return player.board?.gamertag || player.filmName || null
}

/**
 * ReplayTeamGroup — a side FROM THE FILM and its players (`replayCamps.ts`: the designator decides,
 * its members' scoreboard side only names it).
 */
export interface ReplayTeamGroup extends ReplayCamp {
  players: ReplayPlayer[]
}

/**
 * buildPlayers groups lives by player and joins them to the scoreboard.
 *
 * ANONYMOUS LIVES ARE NOT GIVEN A MADE-UP OWNER: a trace with no xuid belongs to
 * no player. It therefore adds neither a card nor a row to anyone — and since its slot belongs to
 * none of the tables below, the layer does not draw it either (`colorOfSlot` returns
 * `null`, see useSlotIdentity): these are cameras and end-of-match spectators.
 *
 * WHAT IDENTIFIES SOMEONE (color, identity mark, name) BELONGS TO THE PLAYER, never to a
 * life; the layer resolves it by SLOT and by FRAME (`buildSlotOwnership` / `ownerAtFrame`
 * below, derived `colorResolver`/`markResolver`/`nameResolver`). Without this, a player
 * would change color on every respawn (99 traces for 8 players), and — a biped slot
 * being reassigned between rounds — a slot would show a single player for the whole match:
 * following someone with your eyes would become impossible.
 */
export function buildPlayers(
  doc: ReplayDocumentReady,
  scoreboard: MatchScoreboardRow[],
): ReplayPlayer[] {
  const byXUID = new Map<string, ReplayPlayer>()
  // The film's roster order gives a STABLE, reproducible order; failing that, the order in
  // which traces appear. Never the iteration order of a Map filled at random.
  // A BOT HAS NO XUID (schema 36): its table identity is `bot:<name>` — two bots with the
  // same name would merge, and that is accepted: the film gives nothing more discriminating.
  // THE TEAM IS SET HERE AND NOWHERE ELSE (see `ReplayPlayer.team`): the entry's designator,
  // joined by the same key as everywhere else (`rosterEntryKey`). A player named only by their
  // lives has no entry, hence no team.
  for (const entry of doc.roster ?? []) {
    const key = rosterEntryKey(entry)
    if (!key) continue
    byXUID.set(key, {
      xuid: key,
      bot: entry.bot || undefined,
      filmName: entry.name,
      team: entry.team ?? undefined,
      lives: [],
    })
  }
  for (const track of doc.tracks) {
    const key = track.xuid || (track.bot ? botKey(track.bot) : '')
    if (!key) continue
    let p = byXUID.get(key)
    if (!p) {
      p = { xuid: key, bot: track.bot ? true : undefined, filmName: track.bot, lives: [] }
      byXUID.set(key, p)
    }
    p.lives.push(track)
  }
  const board = new Map(scoreboard.map((r) => [r.xuid, r]))
  // A BOT IS JOINED BY GAMERTAG, for lack of a shared xuid: the database identifies its
  // bots by `is_bot` (xuid `bid(N.0)`, gamertag resolved WITHOUT the suffix), the film by the name
  // suffixed "[bot]" — the join key is the BARE name on both sides. A name absent from the
  // scoreboard leaves `board` empty — the bot stays without a scoreboard row, never a guessed
  // row; its team, though, is the one the film writes (`team`, set above).
  const boardByName = new Map(
    scoreboard.filter((r) => r.is_bot).map((r) => [stripBotSuffix(r.gamertag), r]),
  )
  for (const p of byXUID.values()) {
    p.board = p.bot ? boardByName.get(stripBotSuffix(p.filmName ?? '')) : board.get(p.xuid)
    p.lives.sort((a, b) => trackWindow(a).start - trackWindow(b).start)
  }
  return [...byXUID.values()]
}

/**
 * groupByTeam arranges players by side FROM THE FILM (`ReplayPlayer.team`), sides in the order of
 * their designators, players in roster order.
 *
 * A PLAYER WHOSE TEAM THE FILM KEEPS SILENT BELONGS TO NO SIDE — there is no "other"
 * group: it is a source defect (see `replayCamps.ts`). A player WITHOUT a scoreboard row,
 * on the other hand, is in the side the film gives them; the scoreboard only names that side.
 */
export function groupByTeam(players: readonly ReplayPlayer[]): ReplayTeamGroup[] {
  return groupByCamp(players, (p) => p.team, (p) => [p.board]).map(({ team, side, members }) => ({
    team,
    side,
    players: members,
  }))
}

/**
 * indexBySlot — MATCH-WIDE AGGREGATE: "what belongs to the PLAYER flows down to each of their
 * LIVES", collapsed into ONE value per slot (LAST WINNER over player order then life order).
 *
 * THIS IS AN AGGREGATE OVER THE WHOLE MATCH, NOT A PER-FRAME READING. It serves equipment
 * usage counting (`equipmentUsageLogic`), where "the slot's player" is wanted across all
 * lives. For per-FRAME rendering, do not use it: a biped slot is reassigned
 * between respawns AND between rounds, so it does not have ONE owner but the owner
 * of the life that occupies it AT THAT FRAME — that is `buildSlotOwnership` / `ownerAtFrame`. (In
 * multi-round play, this aggregate attributes to the slot's last owner: a known debt, accepted
 * here because usage counting is match-level, not frame-level.)
 *
 * A life WITHOUT an owner (a trace with no xuid) appears in no table: the caller then
 * serves its own fallback — neutral ink for color, no mark, no name.
 */
export function indexBySlot<T>(
  players: readonly ReplayPlayer[],
  valueOf: (player: ReplayPlayer) => T,
): Map<number, T> {
  const bySlot = new Map<number, T>()
  for (const p of players) {
    const value = valueOf(p)
    for (const life of p.lives) bySlot.set(life.slot, value)
  }
  return bySlot
}

/**
 * SlotOwnership — WHO OCCUPIES A SLOT AT A FRAME. The fix for `indexBySlot`'s collapse
 * for rendering: a biped slot is reassigned between respawns AND between rounds, so its
 * owner is not a match-wide constant but the LIFE that covers the read frame.
 *
 * UNAMBIGUOUS: a slot's lives are disjoint (a biped has only one occupant at a time),
 * `buildPlayers` sorted them in time, and the lookup returns the first life that covers
 * the frame. A slot free between two lives — or before the first, or after the last — has
 * no owner at that frame: `ownerAtFrame` returns `null`, the layer draws nothing.
 */
export interface SlotOwnership {
  ownerAtFrame(slot: number, frame: number): ReplayPlayer | null
  /**
   * ownerAtFrameOrLast — the life that COVERS the frame, otherwise the most recent life
   * ENDED before it (the "life just before"). Reserved for BOUNDARY consumers whose event
   * is dated AT THE MOMENT THE OWNER JUST LEFT THE SLOT: an object DROPPED on death carries
   * `t0 = lifeEnd + 1` (the dropper no longer occupies the slot), and a posthumous kill/trade
   * can land one frame after the killer's life ends. `ownerAtFrame` would return `null` there
   * (so neutral ink instead of the team color): that is a GAP to fill with the preceding
   * life, not with the match's last-winner — in multi-round play, the result stays the player
   * of THAT round (SHROOM if they just died, DinoR00 otherwise). Do NOT use it for the
   * continuous rendering of markers/lives: those must stay `null` in the gaps.
   */
  ownerAtFrameOrLast(slot: number, frame: number): ReplayPlayer | null
}

/** An owned life, reduced to its window and its owner (the index needs nothing else). */
interface OwnedLife {
  start: number
  end: number
  player: ReplayPlayer
}

/**
 * buildSlotOwnership indexes, per slot, the lives that occupied it — sorted by start — and returns
 * the `ownerAtFrame` resolver. Built ONCE per document (memoized by the caller); the
 * resolution is a short scan (a handful of lives per slot) with early exit as soon as
 * a life starts after the frame.
 */
export function buildSlotOwnership(players: readonly ReplayPlayer[]): SlotOwnership {
  const bySlot = new Map<number, OwnedLife[]>()
  for (const p of players) {
    for (const life of p.lives) {
      const w = trackWindow(life)
      const entry: OwnedLife = { start: w.start, end: w.end, player: p }
      const lives = bySlot.get(life.slot)
      if (lives) lives.push(entry)
      else bySlot.set(life.slot, [entry])
    }
  }
  for (const lives of bySlot.values()) lives.sort((a, b) => a.start - b.start)
  return {
    ownerAtFrame(slot, frame) {
      const lives = bySlot.get(slot)
      if (!lives) return null
      for (const l of lives) {
        // Sorted by start: as soon as a life starts after the frame, none of the rest covers it.
        if (frame < l.start) break
        if (frame <= l.end) return l.player
      }
      return null
    },
    ownerAtFrameOrLast(slot, frame) {
      const lives = bySlot.get(slot)
      if (!lives) return null
      let last: ReplayPlayer | null = null
      for (const l of lives) {
        if (frame < l.start) break // no covering nor preceding life beyond this: keep `last`
        if (frame <= l.end) return l.player // covering life
        last = l.player // life entirely BEFORE the frame: keep the most recent one
      }
      return last // the life just before (the dropper / the killer), or null if none
    },
  }
}

/**
 * colorResolver — THE COLOR OF A LIFE IS THAT OF ITS OWNER AT THAT FRAME, and it is their
 * TEAM color (decision D1 of the dressing-up plan, 2026-08-16, amended by the user):
 * the `team-ally` / `team-enemy` tokens that accessibility settings may override,
 * never a trace-indexed series color. A player used to keep a hue per LIFE (it
 * changed on every respawn); then a hue fixed per SLOT, which showed a
 * single player for the whole match when a slot is reassigned between rounds. The color is
 * now resolved AT THE FRAME, via the owner of the life occupying the slot at that moment.
 *
 * `colorOf` returns a side's color (the caller resolves the tokens), `allyOf` tells a
 * PLAYER's allegiance as seen from the reference (`FilmAllegiance.ofPlayer`: the FILM's team,
 * never the scoreboard), `neutral` serves when it is unknown (`null`: the film keeps the
 * player's team silent, or the reference's). `null` on output = no owner at that frame (free
 * slot, or anonymous life): the layer draws nothing.
 */
export function colorResolver(
  ownership: SlotOwnership,
  colorOf: (ally: boolean) => string,
  allyOf: (player: ReplayPlayer) => boolean | null,
  neutral: string,
): (slot: number, frame: number) => string | null {
  return (slot, frame) => teamColorOfOwner(ownership.ownerAtFrame(slot, frame), colorOf, allyOf, neutral)
}

/**
 * colorResolverOrLast — the SAME team color, but resolved via `ownerAtFrameOrLast`: for BOUNDARY
 * consumers (the color of an object DROPPED on death, the color of a death effect)
 * whose event is dated right when the owner just left the slot. A dropped object carries
 * `t0 = lifeEnd + 1`: a strict resolution would return `null` there -> neutral ink instead of
 * the dropper's color. Do NOT use it for markers/lives (continuous rendering).
 */
export function colorResolverOrLast(
  ownership: SlotOwnership,
  colorOf: (ally: boolean) => string,
  allyOf: (player: ReplayPlayer) => boolean | null,
  neutral: string,
): (slot: number, frame: number) => string | null {
  return (slot, frame) => teamColorOfOwner(ownership.ownerAtFrameOrLast(slot, frame), colorOf, allyOf, neutral)
}

/** teamColorOfOwner — an owner's team color (neutral without allegiance, null if there is none). */
function teamColorOfOwner(
  p: ReplayPlayer | null,
  colorOf: (ally: boolean) => string,
  allyOf: (player: ReplayPlayer) => boolean | null,
  neutral: string,
): string | null {
  if (!p) return null
  const ally = allyOf(p)
  return ally === null ? neutral : colorOf(ally)
}

/**
 * campResolver — THE SIDE OF A LIFE AT A FRAME, that of its owner at that frame: their
 * FILM team (`ReplayPlayer.team`). It serves OPPOSITION between two lives (threat sensor, card
 * zones, poses), not the ink: that one is relative to the reference
 * (`filmAllegiance.ts`).
 *
 * NOT THE "ally" FLAG, which is relative to the player being viewed and lumps every other
 * player into a single side — wrong as soon as there are more than two teams (four-side BTB).
 * What the sensor needs to know is whether TWO lives oppose each other; their designators say so.
 *
 * With no owner at that frame (free slot), or when the film keeps its team silent or gives
 * none (`-1`, mode without sides), a life has NO side (null): neither ally nor enemy to
 * anyone, and the scoreboard will not assert one in its place.
 */
export function campResolver(
  ownership: SlotOwnership,
): (slot: number, frame: number) => number | null {
  return (slot, frame) => {
    const team = ownership.ownerAtFrame(slot, frame)?.team
    return team !== undefined && team >= 0 ? team : null
  }
}

/**
 * markResolver returns the identity mark ("me", "friend") of the owner of the life that
 * occupies the slot at that frame; `undefined` if there is no owner or no mark.
 */
export function markResolver(
  ownership: SlotOwnership,
  marks: ReadonlyMap<string, PlayerMarkKind>,
): (slot: number, frame: number) => PlayerMarkKind | undefined {
  return (slot, frame) => {
    const p = ownership.ownerAtFrame(slot, frame)
    return p ? marks.get(p.xuid) : undefined
  }
}

/**
 * nameResolver returns the DISPLAY NAME of the owner of the life that occupies the slot at
 * that frame — the one used by cards and the feed (`displayPlayerName`), never a raw xuid. No
 * owner at that frame -> `null`: the card's label then stays empty rather than writing
 * "Player ####" or, worse, the name of a player from ANOTHER round.
 */
export function nameResolver(
  ownership: SlotOwnership,
): (slot: number, frame: number) => string | null {
  return (slot, frame) => {
    const p = ownership.ownerAtFrame(slot, frame)
    return p ? displayPlayerName(playerName(p), p.xuid) : null
  }
}

/**
 * nameByXuidResolver — THE SAME DISPLAY NAME, but requested BY XUID and without a frame.
 *
 * WHY IT EXISTS (2026-09-02, the vehicles layer). `nameResolver` answers "who occupies THIS
 * SLOT at THIS FRAME" — the right question for a pawn, whose identity only exists through
 * the life occupying the slot. But a vehicle OCCUPANCY EPISODE (`VehicleRide`) names its
 * occupant ITSELF, by xuid, and that statement does not depend on any biped trace: it
 * survives the case — observed on film — where the slot's trace was not joined to a player
 * (`buildPlayers` then discards it, see `if (!track.xuid) continue`) and where the
 * slot->player bridge can therefore return nothing.
 *
 * XUID UNKNOWN TO THE ROSTER -> `null`: a name is not manufactured from an identifier no
 * player in the match carries.
 */
export function nameByXuidResolver(
  players: readonly ReplayPlayer[],
): (xuid: string) => string | null {
  const byXuid = new Map(players.map((p) => [p.xuid, p]))
  return (xuid) => {
    const p = byXuid.get(xuid)
    return p ? displayPlayerName(playerName(p), p.xuid) : null
  }
}

/**
 * colorByXuidResolver — THE SAME TEAM COLOR, but requested BY XUID and without a frame.
 *
 * WHY IT EXISTS (2026-09-02, vehicle tinting). `colorResolver` answers "what color is the
 * life occupying THIS SLOT at THIS FRAME" — the right question for a pawn. But a vehicle
 * OCCUPANCY EPISODE names its occupant ITSELF (`VehicleRide.xuid`), and during the episode
 * the biped no longer replicates: the slot->player bridge is then SILENT right where it
 * needs to speak — exactly the defect the `VehicleRide.xuid` contract claimed was
 * resolved ("it is the one that gives the vehicle its color"). Resolving by xuid keeps
 * that promise; the slot bridge remains the FALLBACK, as for the name.
 *
 * XUID UNKNOWN TO THE ROSTER -> `null`: no player in the match carries it, no team is
 * invented for them. Known xuid whose allegiance is unknown (the film keeps its team silent, or
 * the reference's) -> neutral ink (same rule as the slot bridge: the player exists, their side
 * does not).
 */
export function colorByXuidResolver(
  players: readonly ReplayPlayer[],
  colorOf: (ally: boolean) => string,
  allyOf: (player: ReplayPlayer) => boolean | null,
  neutral: string,
): (xuid: string) => string | null {
  const byXuid = new Map(players.map((p) => [p.xuid, p]))
  return (xuid) => teamColorOfOwner(byXuid.get(xuid) ?? null, colorOf, allyOf, neutral)
}

/**
 * PlayerState — what a player is at a given frame, read from the film.
 *
 * `shield` is null when no measurement exists in the hold window: that is
 * "unknown", to be absolutely distinguished from a shield at zero, which is a measurement.
 */
export interface PlayerState {
  alive: boolean
  /** The current life, when there is one. */
  life: ReplayTrackReady | null
  /**
   * Shield: the life's last measurement with its age, or 1.0 (age 0) before the first
   * measurement — you spawn full, and the differential stream only retransmits what changes.
   * Null ONLY when the document does not carry this field at all (see VitalityPresence) or
   * the player is dead.
   */
  shield: { value: number; age: number } | null
  /**
   * Health, same contract as the shield — including the full-on-spawn value. It is
   * replicated ON CHANGE and rarely transmitted (zero-sample median per life on the
   * reference film): in Halo the shield absorbs first, a life with no health measurement is a
   * life that stayed untouched.
   */
  health: { value: number; age: number } | null
  /** Number of frames elapsed since the end of the last life (death); -1 if alive. */
  sinceDeath: number
  /**
   * RESPAWN frame, READ: it is the start frame of the same player's next life, not
   * a constant added to the moment of death. -1 when no life follows — which happens
   * for an end-of-match survivor, and must display as a gap, never as a guessed delay.
   */
  respawnFrame: number
}

/**
 * VitalityPresence — does the document carry the data, field by field? This is the
 * multi-title guard for "full on spawn": a title whose film NEVER transmits a
 * vitality value must not display invented full bars — it displays no bar.
 * Degrades on ABSENCE OF DATA, never on a slug comparison.
 */
export interface VitalityPresence {
  shield: boolean
  health: boolean
}

/**
 * vitalityPresence measures, once per document, which vitality fields exist. The shield also
 * exists when no point carries one but the decoder read the bipeds' records (`coverage.keyframes`):
 * the shield lives in those records and is replicated only when it CHANGES
 * (`tracks_publication.go`), so records read without a single shield value say that nobody's shield
 * ever moved from its spawn value, full (an aim-training game where nobody shoots back).
 */
export function vitalityPresence(doc: ReplayDocumentReady): VitalityPresence {
  let shield = (doc.coverage?.keyframes?.records ?? 0) > 0
  let health = false
  for (const t of doc.tracks) {
    for (const p of t.points) {
      if (p.sh !== undefined) shield = true
      if (p.hp !== undefined) health = true
      if (shield && health) return { shield, health }
    }
  }
  return { shield, health }
}

/**
 * playerStateAt reads a player's state at a frame.
 *
 * VITALITY CARRY-FORWARD COVERS THE WHOLE LIFE, and that is a correct reading: the stream is
 * differential — not retransmitted means UNCHANGED — and the points belong to the life,
 * so the carry-forward never crosses a death. What ages must SHOW: the age travels
 * with the value and the display fades it (see bars).
 *
 * BEFORE A LIFE'S FIRST MEASUREMENT, THE CORRECT VALUE IS 1.0: you spawn with full life and
 * shield (game rule), and the film only retransmits what CHANGES — "nothing happened"
 * means "full", not "unknown". This is the POC's reading, restored by user decision
 * (2026-08-12). It is GUARDED by VitalityPresence: a document that never carries the
 * field shows nothing (title without film decoding).
 *
 * THE RESPAWN DELAY IS READ, NOT DERIVED. Measured on the reference film: 90 death
 * episodes, 82 with a readable return, median 8.0 s and 66 of 82 exactly at 7.9-8.0 s. It is a
 * clean plateau — but measured on ONE match, which does not make it a game constant. The 8
 * episodes without a return stay with no displayed delay.
 */
export function playerStateAt(
  player: ReplayPlayer,
  frame: number,
  presence: VitalityPresence,
): PlayerState {
  const live = player.lives.find((l) => isAliveAt(l, frame)) ?? null
  if (live) {
    const spawnFull = { value: 1, age: 0 }
    const shield = heldReading(live.points, frame, (p) => p.sh, Number.POSITIVE_INFINITY)
    const health = heldReading(live.points, frame, (p) => p.hp, Number.POSITIVE_INFINITY)
    return {
      alive: true,
      life: live,
      shield: shield ?? (presence.shield ? spawnFull : null),
      health: health ?? (presence.health ? spawnFull : null),
      sinceDeath: -1,
      respawnFrame: -1,
    }
  }
  // Dead: the last life CLOSED before this frame dates the death; the next one, if it exists,
  // dates the return.
  let last: ReplayTrackReady | null = null
  let next = -1
  for (const l of player.lives) {
    const w = trackWindow(l)
    if (w.end < frame) last = l
    else if (w.start > frame && next === -1) next = w.start
  }
  return {
    alive: false,
    life: null,
    shield: null,
    health: null,
    sinceDeath: last ? frame - trackWindow(last).end : -1,
    respawnFrame: next,
  }
}

/**
 * LOADOUT_SRC_BIRTH — the provenance of a reading taken from the body's CREATION
 * record (`loadouts[].src`, schema 69; mirror of Go's `replay.LoadoutSrcBirth`).
 */
export const LOADOUT_SRC_BIRTH = 'birth'

/**
 * LoadoutReading — the weapons carried and the AGE of this reading.
 *
 * THE AGE IS INSEPARABLE FROM THE VALUE. The loadout is only read at keyframes, one every
 * ~20 s. Between two, what is displayed is the last known reading, and passing it off as
 * the current state was a real defect: across a match's 21,899 cards, the median age of this
 * reading is 8.4 s, and only 7.1% have less than one second. Fading is therefore not
 * a rare ornament — it is used nine times out of ten.
 */
export interface LoadoutReading {
  weapons: string[]
  age: number
  /**
   * PROVENANCE of the base reading (schema 69): `birth` = the SPAWN LOADOUT, read from the
   * body's creation record; absent = a keyframe reading. The card's tooltip says so.
   */
  src?: string
  /** Each weapon's slot in `weapons`, when the reading places it (spawn loadout). */
  k?: number[]
}

/**
 * loadoutAt returns the weapons carried by a SLOT at a frame, with the reading's age.
 *
 * The lookup is by slot, not by player: the loadout is written for a biped, and
 * a slot is reassigned on every respawn. That is also what makes the carry-forward SAFE — a
 * loadout cannot cross a death, since it does not outlive its holder.
 *
 * BOUNDED TO THE SLOT'S CURRENT LIFE (2026-09-06 fix): a reassigned slot does not only receive
 * a death, it receives ANOTHER life — sometimes ANOTHER player. Looking for "the slot's
 * last reading" without a life boundary therefore carried forward the PREVIOUS life's loadout.
 * `currentLifeOf` names the life that covers `frame` on this slot; without one, no lookup
 * happens — `null`, never a reading stolen from another life.
 *
 * THE SPAWN LOADOUT IS THE LIFE'S FIRST READING (schema 69, batch M3.3). The document
 * publishes, in `loadouts`, the weapons that the body's creation record transmits (`src:
 * 'birth'`), placed on the life it opens: it is the PAST reading at the start of life, and
 * `nearestReading` keeps it like any other.
 *
 * THE "UPCOMING" READING IS WITHDRAWN FROM A LIFE WHOSE BIRTH IS READ (user decision
 * Q18 of 2026-09-23): before the first keyframe, it showed the weapons read UP TO twenty
 * seconds later — including a weapon picked up in the meantime. The rule is PER LIFE, because
 * the birth reading is too: on films from builds earlier than HI_1_12_0, the creation
 * record does not close and no loadout is published (batch M3 measurement: nine of
 * twenty-two references) — a PER-DOCUMENT rule deprived them of the fallback, and the
 * "weapons unread" card went from 4.1% to 13.9% of lifetime across the corpus gate's nineteen
 * references. A life WITHOUT a spawn loadout therefore keeps the old fallback: the nearest
 * UPCOMING reading of the same life, NEGATIVE age published as-is and labeled "upcoming".
 */
export function loadoutAt(doc: ReplayDocumentReady, slot: number, frame: number): LoadoutReading | null {
  const life = currentLifeOf(doc, slot, frame)
  if (!life) return null
  const window = trackWindow(life)
  const loadouts = doc.loadouts ?? []
  const read = nearestReading(loadouts, slot, frame, window, !lifeHasBirthLoadout(loadouts, slot, window))
  if (!read) return null
  // FINE-GRAINED DATING (schema 25): the reading gives the STATE, the dated weapon changes give
  // the TRANSITIONS that occurred since. What they apply and what they refuse to apply is
  // written in changeRefine.ts — an artifact carrying none returns the reading unchanged.
  return refineWeaponsReading(
    {
      weapons: read.value.w,
      age: read.age,
      src: read.value.src,
      // LOCATED only when every weapon has its slot: a keyframe reading carries none,
      // and a half-located row is not located.
      k: read.value.k.length > 0 && read.value.k.length === read.value.w.length ? read.value.k : undefined,
    },
    doc.weaponChanges,
    slot,
    frame,
  )
}

/** lifeHasBirthLoadout says whether the slot's life, within these bounds, carries its SPAWN LOADOUT. */
function lifeHasBirthLoadout(
  loadouts: ReadonlyArray<{ slot: number; t: number; src?: string | null }>,
  slot: number,
  window: { start: number; end: number },
): boolean {
  return loadouts.some(
    (l) => l.slot === slot && l.src === LOADOUT_SRC_BIRTH && l.t >= window.start && l.t <= window.end,
  )
}

/**
 * currentLifeOf — THE SLOT'S LIFE THAT COVERS THIS FRAME, or `undefined`.
 *
 * SIBLING OF `lifeOfSlotAt` (`features/match-replay/model/livesPosition.ts`), NOT A FOURTH
 * COPY: this module cannot import it — `lib/` never depends on `features/` (the repo's
 * one-way direction, no production file reverses it) — and this module's callers
 * (`loadoutAt`, `abilityAt`, and `inventoryAt`/`grenadeReadingAt` on the feature side, which reuse
 * this same function) only have a slot and a frame, never the already-built per-slot
 * map: rebuilding it on every call would cost more than a direct scan of
 * `doc.tracks`, already `nearestReading`'s own complexity. The same direct scan already
 * exists in production (`abilityChargeLogic.ts:133`) and the 2026-09-06 audit examined it and
 * cleared it as not at fault — same guard, same verdict.
 *
 * SAME RULE AS `lifeOfSlotAt`: "taking whichever one comes first would be a bug" — a slot
 * with no life at that instant returns nothing, never a neighboring life.
 */
export function currentLifeOf(
  doc: ReplayDocumentReady,
  slot: number,
  frame: number,
): ReplayTrackReady | undefined {
  return doc.tracks.find((t) => t.slot === slot && isAliveAt(t, frame))
}

/**
 * nearestReading — THE CANONICAL HOME of carry-forward reading (<=2 copies rule, CLAUDE.md #6).
 *
 * Three layers read the film in SPACED-OUT SAMPLES and must display, at a given
 * frame, the last known reading: weapons carried, inventory, and — since
 * 2026-08-14 — armor ability. The third copy triggered centralization; the
 * guard rail `rosterLogic.guard.test.ts` forbids hand-writing a fourth one.
 *
 * THE RULE, IDENTICAL FOR ALL THREE:
 *   - the lookup is by SLOT, never by player. A slot is reassigned on every
 *     respawn: that is what makes the carry-forward SAFE, a reading cannot cross a
 *     death since it does not outlive its holder;
 *   - before a life's first reading, return the nearest UPCOMING one of the same slot, with
 *     a NEGATIVE age published as-is. The display fades it by its absolute value and labels it
 *     "upcoming" — never disguised as a past reading.
 *
 * `life` NOW BOUNDS THE LOOKUP TO THE SLOT'S CURRENT LIFE (2026-09-06 fix) — NEITHER `best` NOR
 * `ahead` LOOKED AT THE LIFE BOUNDARY BEFORE THIS FIX: on a recycled slot or a multi-round
 * film, `best` ALWAYS kept the closest past reading, regardless of its life, before even
 * considering `ahead` — the "upcoming" fallback documented above was therefore INERT as soon as
 * the slot carried an earlier life, and the card displayed that previous life's loadout,
 * sometimes that of ANOTHER player on a recycled slot. `life` comes from `currentLifeOf`; without
 * a covering life, or without a reading within its bounds, the function returns `null`.
 *
 * `allowAhead` (true by default) allows this "upcoming" fallback; `loadoutAt` refuses it for a
 * life whose spawn loadout is read (Q18, see its note) — the other layers keep it.
 *
 * `null` DOES NOT MEAN "UNKNOWN IDENTITY" — product decision of 2026-09-06: a life is
 * a human or a bot, never an anonymous entity (naming is fixed at the source on the Go
 * side, outside this batch). `null` only means "no reading yet observed since the start of
 * THIS life" — a neutral fallback, never a reading stolen from another life.
 */
export function nearestReading<T extends { slot: number; t: number }>(
  samples: readonly T[],
  slot: number,
  frame: number,
  life: { start: number; end: number } | undefined,
  allowAhead = true,
): { value: T; age: number } | null {
  if (!life) return null
  let best: { value: T; age: number } | null = null
  let ahead: { value: T; age: number } | null = null
  for (const s of samples) {
    if (s.slot !== slot) continue
    // LIFE BOUNDARY: a reading outside [life.start, life.end] belongs to ANOTHER life of the
    // same slot (recycled) — never a candidate, neither as "best" nor as "ahead".
    if (s.t < life.start || s.t > life.end) continue
    const age = frame - s.t
    if (age < 0) {
      // The nearest upcoming one: the least negative age.
      if (!ahead || age > ahead.age) ahead = { value: s, age }
      continue
    }
    if (!best || age < best.age) best = { value: s, age }
  }
  return best ?? (allowAhead ? ahead : null)
}

/**
 * AbilityReading — the palette RANK of the ability carried, and the age of this reading.
 *
 * TWO CHANNELS, ONE QUANTITY (see the artifact, abilities.go): `i48` transmits the full
 * rank in delta packets, about once per life; the keyframe channel is dense but
 * BLIND — it only sees ranks 16 to 23. They are not arbitrated: the most recent
 * reading wins, whichever channel it came from, because both say the same thing.
 */
export interface AbilityReading {
  rank: number
  age: number
  src: string
}

/**
 * abilityAt returns the last ability rank read for a SLOT, with the reading's age.
 *
 * THREE SOURCES SINCE SCHEMA 25, AND THE MOST RECENT WINS: `abilities`'s two channels
 * (keyframe and delta packet, which say what the player CARRIES) and equipment
 * CHANGES (which date what HAPPENS to them). The arbitration — and the consumption case,
 * which returns `null` because the player then carries nothing — lives in changeRefine.ts.
 *
 * BOUNDED TO THE SLOT'S CURRENT LIFE (fix P0-2, 2026-09-06, same defect and same fix
 * as `loadoutAt`): without a covering life for this slot at this frame, neither source
 * answers — `null`, never another life's ability. `window.start` is passed down to
 * `refineAbilityReading`, which in turn bounds the equipment-changes channel (sibling
 * site of the same defect, `changeRefine.ts`).
 */
export function abilityAt(
  doc: ReplayDocumentReady,
  slot: number,
  frame: number,
): AbilityReading | null {
  const life = currentLifeOf(doc, slot, frame)
  if (!life) return null
  const window = trackWindow(life)
  const read = nearestReading(doc.abilities ?? [], slot, frame, window)
  const base = read ? { rank: read.value.r, age: read.age, src: read.value.src } : null
  return refineAbilityReading(base, doc.equipmentChanges, slot, frame, window.start)
}
