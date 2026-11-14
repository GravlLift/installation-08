/**
 * TopBar — the thin bar over every broadcast page: the app mark, the "Replay" tag, an
 * optional crumb naming the current section, and on the right the signed-in gamertag or a
 * "Sign in" button. Pure presentation: it receives the tag and callback as props and
 * fetches no data itself (the page owns `useAuthState`).
 */
export interface TopBarProps {
  /** The signed-in gamertag; `null` shows the Sign in button instead. */
  gamertag: string | null
  /** Starts sign-in; rendered only when there is no gamertag. */
  onSignIn?: () => void
  /** The section name after the Replay tag (e.g. "Match library"). */
  crumb?: string
}

export function TopBar({ gamertag, onSignIn, crumb }: TopBarProps) {
  return (
    <>
      <div className="bc-topbar">
        <div className="bc-mark">Infinite <b>Theater</b> 3D</div>
        <div className="bc-onair">Replay</div>
        {crumb ? <div className="bc-crumb">{crumb}</div> : null}
        <div className="bc-spacer" />
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
