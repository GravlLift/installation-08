// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { useCopyToClipboard } from '../lib/clipboard/useCopyToClipboard'

export function MatchId({ matchId }: { matchId: string }) {
  const { copy, copied } = useCopyToClipboard()
  return <button type="button" className="bc-match-id" onClick={() => void copy(matchId)}>
    <span>{matchId}</span> <span>{copied ? 'Copied' : 'Copy'}</span>
  </button>
}
