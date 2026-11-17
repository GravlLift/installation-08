// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * outcome.ts — canonical mapping from the backend outcome code to the outcome value
 * used by the timeline (OutcomeSequenceTape) / `outcomes.toml` keys.
 *
 * ADR 0006 contract: 2=win, 3=loss, 1=tie, 4=dnf. Key 'tie' (timeline + outcomes.toml).
 * DO NOT confuse with the 'draw' variant of the accessibility/color SCALES
 * (`outcomeKey` from `lib/outcome-color.ts`) — distinct key sets (tie vs draw).
 *
 * EXPLICIT DEFAULT: a code OUTSIDE the contract (null / undefined / 0 / negative / > 4)
 * maps to `null`. This is the SAFEST default: never manufacture an outcome
 * for an unknown entry. A consumer that COUNTS outcomes (e.g.
 * SessionOutcomeDonut: `if (!key) continue`) must be able to EXCLUDE the unknown — a
 * 'tie' or 'dnf' default would silently skew its statistics.
 *
 * SINGLE source (guard rail `outcome.guard.test.ts`, CLAUDE.md #6) — never
 * redefine a code -> outcome mapping locally.
 */
export type OutcomeValue = 'win' | 'loss' | 'tie' | 'dnf'

/**
 * Maps a backend outcome code to its canonical value, or `null` if the code is
 * outside the ADR 0006 contract (see the module docstring for the default's rationale).
 */
export function outcomeCodeToValue(code: number | null | undefined): OutcomeValue | null {
  switch (code) {
    case 2:
      return 'win'
    case 3:
      return 'loss'
    case 1:
      return 'tie'
    case 4:
      return 'dnf'
    default:
      return null
  }
}

/**
 * Variant for sequential timelines (OutcomeSequenceTape) that require a
 * NON-null value per match. Applies the timeline's 'dnf' default — a neutral
 * "unclassified" bucket asserting neither a win, nor a loss, nor a tie. In practice
 * the API only ever serves codes 1..4 -> this default never triggers on real
 * data; it exists only to satisfy the timeline's non-null typing.
 */
export function outcomeCodeToTapeValue(code: number | null | undefined): OutcomeValue {
  return outcomeCodeToValue(code) ?? 'dnf'
}
