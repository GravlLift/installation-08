/**
 * AccountPanel — the home screen's sign-in area: a "Sign in with Xbox" button when signed out,
 * the device code and a countdown while sign-in is pending, the gamertag and a "Sign out" button
 * once signed in, or the server's error with a retry. Logic lives in `useAuthState`; this stays
 * a thin render of its `phase`.
 */
import { useEffect, useState } from 'react'

import type { AuthPhase } from './useAuthState'
import { formatTimeLeft } from './homeScreenLogic'

/** Ticks once a second so the countdown stays live. Schedules exactly one `setInterval` and
 *  clears it on cleanup or when `expiresAt` changes — never more than one timer per mount. */
function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [enabled])
  return now
}

function PendingPanel({
  phase,
  onCancel,
}: {
  phase: Extract<AuthPhase, { phase: 'pending' }>
  onCancel: () => void
}) {
  const now = useNow(true)
  const [copied, setCopied] = useState(false)
  const timeLeft = phase.expiresAt ? formatTimeLeft(phase.expiresAt, now) : null

  const copyCode = () => {
    void navigator.clipboard
      ?.writeText(phase.userCode)
      .then(() => setCopied(true))
      .catch(() => {
        /* Clipboard access can be denied; the code is still shown and selectable by hand. */
      })
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-card p-4 text-sm">
      <p className="text-foreground">
        Enter this code on Microsoft&rsquo;s sign-in page. This app never sees your password.
      </p>
      <div className="flex items-center gap-2">
        <span className="select-all rounded bg-background px-3 py-1.5 font-mono text-xl tracking-widest text-foreground">
          {phase.userCode || '——————'}
        </span>
        <button
          type="button"
          className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
          onClick={copyCode}
        >
          {copied ? 'Copied' : 'Copy code'}
        </button>
      </div>
      {phase.verificationUri && (
        <a
          href={phase.verificationUri}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary underline"
        >
          {phase.verificationUri}
        </a>
      )}
      <p className="text-xs text-muted-foreground">
        {timeLeft ? `Code expires in ${timeLeft}` : 'This code has expired — cancel and try again.'}
      </p>
      <button
        type="button"
        className="self-start rounded border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  )
}

export function AccountPanel({
  phase,
  onLogin,
  onLogout,
}: {
  phase: AuthPhase
  onLogin: () => void
  onLogout: () => void
}) {
  if (phase.phase === 'loading') {
    return <p className="text-sm text-muted-foreground">Checking sign-in…</p>
  }

  if (phase.phase === 'signed_out') {
    return (
      <button
        type="button"
        className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
        onClick={onLogin}
      >
        Sign in with Xbox
      </button>
    )
  }

  if (phase.phase === 'pending') {
    return <PendingPanel phase={phase} onCancel={onLogout} />
  }

  if (phase.phase === 'signed_in') {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="text-foreground">
          Signed in as <span className="font-semibold">{phase.gamertag || 'unknown gamertag'}</span>
        </span>
        <button
          type="button"
          className="rounded border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted"
          onClick={onLogout}
        >
          Sign out
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-destructive">Sign-in failed: {phase.error}</p>
      <button
        type="button"
        className="self-start rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground"
        onClick={onLogin}
      >
        Try again
      </button>
    </div>
  )
}
