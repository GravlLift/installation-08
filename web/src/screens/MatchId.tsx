// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { useCopyToClipboard } from '../lib/clipboard/useCopyToClipboard'

export function MatchId({ matchId }: { matchId: string }) {
  const { copy, copied } = useCopyToClipboard()
  // The ID alone; a click copies it, and "Copied" shows beside it only right after.
  return <button type="button" className="bc-match-id" title="Click to copy the match ID" onClick={() => void copy(matchId)}>
    <span>{matchId}</span>{copied ? <span> Copied</span> : null}
  </button>
}
