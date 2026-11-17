// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * _momentum.ts — pure logic for the "Dominance" chart's momentum histogram
 * (match_view.10, `MatchTugOfWarChart`).
 *
 * Assigns each `kill` event to a time slice (bin) and a team, then derives per bin:
 *   - `delta` = allied kills − enemy kills (momentum's signed bar);
 *   - `teamKills` / `enemyKills` (the slice's absolute counts);
 *   - `cumTeam` / `cumEnemy` (cumulative totals since the start, for the tooltip);
 *   - `trend` (DEC-4): `'up'` when momentum is BUILDING relative to the previous
 *     slice (→ full opacity when rendered), `'down'` when it's fading.
 *
 * The `kills` list (one entry per kill, with its fractional position in the bin)
 * is returned so the scatter/wave component only iterates the events once.
 *
 * Zero React/ECharts dependency: pure and testable (`_momentum.test.ts`).
 *
 * Product reminder: the backend's `team_kills` / `enemy_kills` (`MatchTugOfWarBin`)
 * are a NET delta (only one is non-zero per bin) — here we recompute both counts
 * simultaneously from `highlight_events` + the scoreboard's `team_side`.
 */
import type { MatchHighlightEvent, MatchTugOfWarBin } from '@/lib/api/types'

/** Direction of a slice's momentum relative to the previous one (DEC-4). */
type MomentumTrend = 'up' | 'down'

/** Momentum result for a time slice. */
export interface MomentumBin {
  /** Allied kills − enemy kills in the slice (signed bar). */
  delta: number
  teamKills: number
  enemyKills: number
  /** Cumulative allied kills since the start of the match (tooltip). */
  cumTeam: number
  /** Cumulative enemy kills since the start of the match (tooltip). */
  cumEnemy: number
  /** `'up'` = momentum building (full opacity), `'down'` = fading. */
  trend: MomentumTrend
}

/**
 * A KILL, independent of any time slicing.
 *
 * WHY THIS TYPE EXISTS SEPARATELY FROM `MomentumKill`. Binning belongs only to the
 * "Dominance" chart's histogram: the 2D replay, on the other hand, places the same
 * kills on the film's clock, where a bin makes no sense. What's COMMON — what makes
 * an event a kill, who carried it out, and how its weapon travels — is therefore
 * read here, in one place.
 */
export interface KillEvent {
  tMs: number
  xuid: string
  ally: boolean
  /**
   * The KILLER's team (`actor_team_id`): the side the replay's Dominance track credits
   * the frag to. Null if the backend didn't resolve it (actor off the scoreboard): the
   * frag counts for neither side. It no longer colors anything — the replay feed's color
   * comes from the film's team.
   */
  teamID: number | null
  /**
   * THE KILL'S WEAPON, as resolved by the backend. The three fields travel together
   * and are empty together: a damage source identified without ambiguity gives NO
   * icon, never another weapon's.
   *
   * `weaponLabel` is a proper name (BR75), not a translated label. Empty for sources
   * with no proper name (melee, grenade), which nonetheless keep their icon.
   *
   * `weaponKey` is the title's weapon registry canonical key — the join key for the
   * replay's death effect (`doc.killEffects`). Empty when the source isn't listed
   * there (generic melee, objects): the effect stays neutral, never a neighbor's.
   */
  weaponKey: string
  weaponLabel: string
  weaponImageUrl: string
  weaponTinted: boolean
  /**
   * Was the fatal hit a headshot? INDEPENDENT of the three `weapon*` fields above
   * (not conditioned on icon resolution). `undefined` = not measurable (film absent,
   * unpublishable pass, ambiguous source) — NEVER defaults to `false`, same doctrine
   * as `killerDamagePct`/`assistDamagePct` below. Optional (and not required like the
   * other fields of this type): this field appeared after this type did, and existing
   * consumers (2D replay) still build `KillEvent`s that don't carry it.
   */
  headshot?: boolean
  /**
   * The kill's ASSIST, read from the film — THREE states that are never conflated:
   * '' (unknown), 'none' (measured: no assist), 'named' (named assist, with their
   * damage share when it's available). NEVER treat '' as "no assist": that's exactly
   * the lie this enum exists to prevent.
   */
  assistState: '' | 'none' | 'named'
  assistGamertag: string
  assistTeamID: number | null
  /** Damage shares in whole %, NOT capped at 100. Null = not measured, never 0. */
  killerDamagePct: number | null
  assistDamagePct: number | null
  /**
   * The kill's VICTIM, joined server-side from killer_victim_pairs by the (killer,
   * instant) key with a unanimity guard. Empty when the pair is missing, or when two
   * distinct victims share the same key: nobody gets named at random.
   */
  victimXuid: string
  victimGamertag: string
}

/** Minimal per-xuid metadata needed for the computation (team membership). */
type XuidAllyMeta = ReadonlyMap<string, { ally: boolean }>

/**
 * collectKillEvents extracts the kills from a list of raw events, in their arrival order.
 *
 * An event is skipped if it isn't a `kill`, has neither an actor nor a timestamp, or its
 * actor is off the scoreboard — the same exclusions as before the extraction, because
 * they're the server binning's own.
 */
export function collectKillEvents(
  events: MatchHighlightEvent[] | null | undefined,
  xuidMeta: XuidAllyMeta,
): KillEvent[] {
  const out: KillEvent[] = []
  for (const e of events ?? []) {
    if ((e.event_type ?? '').toLowerCase() !== 'kill') continue
    if (!e.actor_xuid || e.event_time_ms == null) continue
    const meta = xuidMeta.get(e.actor_xuid)
    if (!meta) continue
    out.push({
      tMs: e.event_time_ms,
      xuid: e.actor_xuid,
      ally: meta.ally,
      teamID: e.actor_team_id ?? null,
      weaponKey: e.weapon_key ?? '',
      weaponLabel: e.weapon_label ?? '',
      weaponImageUrl: e.weapon_image_url ?? '',
      weaponTinted: e.weapon_image_tinted ?? false,
      headshot: e.headshot ?? undefined,
      assistState: e.assist_state === 'named' || e.assist_state === 'none' ? e.assist_state : '',
      assistGamertag: e.assist_gamertag ?? '',
      assistTeamID: e.assist_team_id ?? null,
      killerDamagePct: e.killer_damage_pct ?? null,
      assistDamagePct: e.assist_damage_pct ?? null,
      victimXuid: e.victim_xuid ?? '',
      victimGamertag: e.victim_gamertag ?? '',
    })
  }
  return out
}

/** A kill assigned to a bin, with its fractional position (kill feed / waves). */
export interface MomentumKill extends KillEvent {
  binIdx: number
  fracInBin: number
}

interface MomentumData {
  momentum: MomentumBin[]
  kills: MomentumKill[]
}

/**
 * Computes momentum per bin from the `kill` events and the bin boundaries.
 * `xuidMeta` resolves an actor's team membership (ally vs enemy). A skipped event
 * (wrong type, missing xuid/time, actor off the scoreboard, time BEFORE the first
 * bin) contributes to neither delta nor kills. An event PAST the last bin is
 * CLAMPED into the last bin — strict parity with the server's binning
 * (`tug_of_war.go`: `if idx >= nBins { idx = nBins - 1 }`), so the front-end
 * histogram and the backend's net delta count the same kills.
 */
export function computeMomentumBins(
  bins: MatchTugOfWarBin[],
  events: MatchHighlightEvent[] | null | undefined,
  xuidMeta: XuidAllyMeta,
): MomentumData {
  const teamKills = new Array<number>(bins.length).fill(0)
  const enemyKills = new Array<number>(bins.length).fill(0)
  const kills: MomentumKill[] = []

  // Kills are collected through the SAME path as the 2D replay; only the binning is
  // specific to this chart. Two collection paths would mean two definitions of "what
  // is a kill" on the same page.
  for (const k of collectKillEvents(events, xuidMeta)) {
    const tSec = k.tMs / 1000
    let idx = bins.findIndex((b) => tSec >= b.bin_start && tSec < b.bin_end)
    if (idx < 0) {
      // Parity with the backend clamp (tug_of_war.go): an event past the last bin is
      // counted in the last bin; a time before the first bin is skipped (the backend
      // skips TimeMS < 0).
      const last = bins.length - 1
      if (last >= 0 && tSec >= bins[last].bin_end) {
        idx = last
      } else {
        continue
      }
    }
    const bin = bins[idx]
    const span = Math.max(1, bin.bin_end - bin.bin_start)
    const frac = Math.min(0.999, Math.max(0, (tSec - bin.bin_start) / span))
    kills.push({ ...k, binIdx: idx, fracInBin: frac })
    if (k.ally) teamKills[idx]++
    else enemyKills[idx]++
  }

  const momentum: MomentumBin[] = []
  let cumTeam = 0
  let cumEnemy = 0
  for (let i = 0; i < bins.length; i++) {
    cumTeam += teamKills[i]
    cumEnemy += enemyKills[i]
    const delta = teamKills[i] - enemyKills[i]
    momentum.push({
      delta,
      teamKills: teamKills[i],
      enemyKills: enemyKills[i],
      cumTeam,
      cumEnemy,
      trend: computeTrend(delta, i > 0 ? momentum[i - 1].delta : 0),
    })
  }

  return { momentum, kills }
}

/**
 * Direction of a slice's momentum (DEC-4). `prevDelta` = the previous slice's delta
 * (0 before the first slice, which makes the first non-zero bin "up", whether it
 * leans allied or enemy). `'up'` = signed amplitude growing in the direction already
 * engaged → full opacity; otherwise `'down'` (fading). A zero `delta` produces no
 * bar (DEC-5), its `trend` is neutralized to `'down'`.
 */
function computeTrend(delta: number, prevDelta: number): MomentumTrend {
  if (delta > 0) return delta > prevDelta ? 'up' : 'down'
  if (delta < 0) return delta < prevDelta ? 'up' : 'down'
  return 'down'
}
