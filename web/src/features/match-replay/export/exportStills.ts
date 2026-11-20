// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * exportStills.ts — STILLS MODE of a camera-script export: only the frames nearest the asked
 * script times are rendered, each one file frame, in the order asked. A beat check (the kill,
 * the freeze, the card, the ending) takes seconds instead of a whole clip's render.
 *
 * The frames are the script plan's own (`buildScriptExportPlan`): a still is exactly the frame
 * the full clip would carry at that time, painted with the same index, so its script time, its
 * film frame and its camera are the full render's. The file is a short silent clip, one frame per
 * still; its camera sidecar carries each still's script time.
 */

/** The most stills one request may ask for. */
export const MAX_STILLS = 64

/**
 * stillIndices: for each wanted script time (ms), the index of the plan frame whose script time
 * is nearest (the earlier on a tie), in the order asked. `scriptMs` is the plan's per-frame script
 * time, ascending; empty gives no index.
 */
export function stillIndices(scriptMs: readonly number[], wanted: readonly number[]): number[] {
  if (scriptMs.length === 0) return []
  return wanted.map((t) => {
    let lo = 0
    let hi = scriptMs.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (scriptMs[mid] < t) lo = mid + 1
      else hi = mid
    }
    // `lo` is the first frame at or after `t`; the one before it may be nearer.
    return lo > 0 && t - scriptMs[lo - 1] <= scriptMs[lo] - t ? lo - 1 : lo
  })
}
