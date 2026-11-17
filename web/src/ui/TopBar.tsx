// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * TopBar — the thin bar over every broadcast page: the app mark, an optional crumb naming
 * the current section, and on the right the server's build indicator (BuildActivity, hidden
 * when nothing builds) then the signed-in gamertag or a "Sign in" button. Pure presentation: it receives the tag and callback as props and
 * fetches no data itself (the page owns `useAuthState`).
 */
import type { ReactNode } from 'react'

import { BuildActivity } from './BuildActivity'

export interface TopBarProps {
  /** A page's own app-level control, shown left of the build indicator and the account (e.g. the matches page's texture quality). */
  topBarControl?: ReactNode
  /** The signed-in gamertag; `null` shows the Sign in button instead. */
  gamertag: string | null
  /** Starts sign-in; rendered only when there is no gamertag. */
  onSignIn?: () => void
  /** The section name after the mark (e.g. "Match library"). */
  crumb?: string
}

export function TopBar({ gamertag, onSignIn, crumb, topBarControl }: TopBarProps) {
  return (
    <>
      <div className="bc-topbar">
        <div className="bc-mark">Installation <b>08</b></div>
        {crumb ? <div className="bc-crumb">{crumb}</div> : null}
        <div className="bc-spacer" />
        {topBarControl}
        <BuildActivity />
        {gamertag ? (
          <div className="bc-who">Signed in <b>{gamertag}</b></div>
        ) : (
          onSignIn ? <button type="button" className="bc-signin" onClick={onSignIn}>Sign in</button> : null
        )}
      </div>
      <div className="bc-rule" />
    </>
  )
}
