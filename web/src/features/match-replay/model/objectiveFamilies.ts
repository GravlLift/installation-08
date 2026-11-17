// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * objectiveFamilies.ts — THE OBJECTIVE FAMILY OF A NAMED STATISTIC. Pure logic, no
 * React, no interface strings.
 *
 * WHAT `doc.objectives` CARRIES, AND THAT IS NOT AN OBJECTIVE. The transport contract
 * (`ObjectiveAction`) has only one `stat` field — no `kind`, no `family`: it is the NAME of
 * the statistic that says the family, and it is placed on the Go side by
 * `internal/games/halo_infinite/film/facts/objectives/named.go`. Yet the tables of this file do not contain
 * only objectives: `kills` (`comp 2 A`) is there the IDENTITY ANCHOR of the sweep and `assists`
 * (`comp 3 A`) its neighbor of cross-check. The two are published like the others — and on
 * `8bc6074f` they make up 99% of the layer (15,648 actions out of 15,808, audit of 2026-09-10 §12-1).
 *
 * THE NAMING RULE IS THE CONTRACT, and it is checked: every objective statistic is
 * prefixed by its family (`flag_captures`, `zone_secures`, `vip_selected`, `bomb_detonations`,
 * `skull_grabs`...), and the families are exactly the `ObjectiveType*` of
 * `objectiveevents/extract.go`. The two non-objective statistics, for their part, have NO prefix.
 * The list below is therefore not a guessed enumeration of the known stats — which would expire
 * at the first named placement — but the list of FAMILIES, stable and closed on the server side
 * (Go guard-rail: `objectiveevents.TestStatsNommeesPortentLeurFamille`, which holds the naming rule
 * on all the tables of the decoder).
 *
 * THE PARITY WITH THE GO LIST IS HELD BY A TEST, since 2026-09-13:
 * `objectiveevents.TestFamillesObjectifPariteGoTS` READS this file and compares the array
 * below AND the union type `ObjectiveFamily` to the Go list, order included. Until then this
 * comment asserted the guarantee without any test ensuring it: a 7th family added to
 * the decoder turned the Go red and left this file GREEN, and the layer ceased without a word to
 * draw the pulses of that family (finding R6 of the review of 2026-09-13). Any family
 * added here is added in `objectiveevents/families.go` — and vice versa.
 *
 * WHY A WHITELIST AND NOT A BLACKLIST of `kills`/`assists`: a future statistic
 * that would not be an objective (the sweep adds them as the corpus progress) would pass a
 * blacklist without anything signaling it. A new objective family, it, is a
 * DELIBERATE addition to the decoder, and adding it here is the same line as on the Go side.
 */

/** The objective families, as `objectiveevents/extract.go` names them. */
export type ObjectiveFamily = 'flag' | 'zone' | 'hill' | 'skull' | 'vip' | 'bomb'

/**
 * The order is that of the Go constants (`ObjectiveTypeFlag`, `Zone`, `Hill`, `Skull`, `Vip`,
 * `Bomb`): two lists that answer each other are read side by side.
 */
export const OBJECTIVE_FAMILIES: readonly ObjectiveFamily[] = [
  'flag',
  'zone',
  'hill',
  'skull',
  'vip',
  'bomb',
]

/**
 * objectiveFamilyOf renders the objective family of a named statistic, or `null` when the
 * statistic is not one (`kills`, `assists`, and any name without a family prefix).
 *
 * The separator is required: `flag_grabs` is of the `flag` family, `flagrant` is not.
 */
export function objectiveFamilyOf(stat: string): ObjectiveFamily | null {
  for (const family of OBJECTIVE_FAMILIES) {
    if (stat.startsWith(`${family}_`)) return family
  }
  return null
}

/** isObjectiveFamilyStat — the same question as a boolean, for the filters and the denominators. */
export function isObjectiveFamilyStat(stat: string): boolean {
  return objectiveFamilyOf(stat) !== null
}
