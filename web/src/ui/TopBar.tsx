/**
 * TopBar — the thin bar over every broadcast page: the app mark, an optional crumb naming
 * the current section, and on the right the server's build indicator (BuildActivity, hidden
 * when nothing builds) then the signed-in gamertag or a "Sign in" button. Pure presentation: it receives the tag and callback as props and
 * fetches no data itself (the page owns `useAuthState`).
 */
import { BuildActivity } from './BuildActivity'

export interface TopBarProps {
  /** The signed-in gamertag; `null` shows the Sign in button instead. */
  gamertag: string | null
  /** Starts sign-in; rendered only when there is no gamertag. */
  onSignIn?: () => void
  /** The section name after the mark (e.g. "Match library"). */
  crumb?: string
}

export function TopBar({ gamertag, onSignIn, crumb }: TopBarProps) {
  return (
    <>
      <div className="bc-topbar">
        <div className="bc-mark">Infinite <b>Theater</b> 3D</div>
        {crumb ? <div className="bc-crumb">{crumb}</div> : null}
        <div className="bc-spacer" />
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
