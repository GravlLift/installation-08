// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useCopyToClipboard — the canonical "copy + transient checkmark" hook.
 *
 * Four buttons carried the same copy-pasted body (`copied` state, `setTimeout`,
 * `navigator.clipboard.writeText`, a silent `catch`) with two different durations
 * (2000 ms and 1500 ms): ShareLinkButton, IdentitiesSection (XuidCell),
 * MatchHeader.card and CopyCodeButton. CLAUDE.md rule #6 (on the 3rd copy:
 * helper + guard rail) — the ratchet is `useCopyToClipboard.guard.test.ts`.
 *
 * What the hook fixes compared to the copies:
 *  - a single checkmark duration (`COPIED_FEEDBACK_MS`);
 *  - the timer is cancelled on unmount AND on every new click (the copies
 *    let a 2nd copy's checkmark disappear on the 1st one's timer, and
 *    called setState after unmount);
 *  - a clipboard failure is logged (`log.error`) instead of being swallowed,
 *    and `copied` stays FALSE — never a false copy confirmation
 *    (MatchHeader.card did not even have a `catch`: an unhandled rejection).
 *
 * The appearance (icon, labels, classes) stays with the calling site: the hook only
 * carries the mechanics.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { log } from './_logger'

/** The single "copied" checkmark duration across the whole application. */
export const COPIED_FEEDBACK_MS = 2000

export interface UseCopyToClipboard {
  /** Copies `text`; sets `copied` to true for the duration of `COPIED_FEEDBACK_MS`. */
  copy: (text: string) => Promise<void>
  /** True during the feedback window that follows a SUCCESSFUL copy. */
  copied: boolean
}

export function useCopyToClipboard(): UseCopyToClipboard {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [])

  const copy = useCallback(async (text: string) => {
    // A new click re-arms the feedback window from zero.
    if (timerRef.current !== null) clearTimeout(timerRef.current)

    try {
      await navigator.clipboard.writeText(text)
    } catch (err) {
      // Clipboard unavailable (insecure context, permission denied).
      // Never a checkmark in that case: the text stays manually selectable.
      log.error('clipboard:write_failed', 'navigator.clipboard.writeText failed', err)
      if (mountedRef.current) setCopied(false)
      return
    }

    if (!mountedRef.current) return
    setCopied(true)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      if (mountedRef.current) setCopied(false)
    }, COPIED_FEEDBACK_MS)
  }, [])

  return { copy, copied }
}
