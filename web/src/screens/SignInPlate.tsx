/**
 * SignInPlate — the device-code sign-in flow as a broadcast plate (brief 124, item 6),
 * replacing `AccountPanel`'s pending state: the code, the link, copy and cancel, restyled
 * to the system. It is a `Plate` over the page (a `bc-overlay`), shown while a sign-in is
 * pending; the state it renders comes from `useAuthState`, whose behavior is unchanged.
 */
import { useEffect, useState } from 'react'

import { Plate } from '../ui/Plate'
import { formatTimeLeft } from './homeScreenLogic'
import type { AuthPhase } from './useAuthState'

/** Ticks once a second so the countdown stays live: exactly one `setInterval` per mount. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

export interface SignInPlateProps {
  /** The pending sign-in phase. */
  phase: Extract<AuthPhase, { phase: 'pending' }>
  /** Cancels the pending sign-in (the hook's `logout` also cancels it). */
  onCancel: () => void
}

export function SignInPlate({ phase, onCancel }: SignInPlateProps) {
  const now = useNow()
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
    <div className="bc-overlay" role="dialog" aria-label="Sign in">
      <div className="bc-signin-plate">
        <Plate eyebrow="Sign in" title="Enter this code on Microsoft's sign-in page" as="h2">
          <p className="bc-signin-text">This app never sees your password.</p>
          <div className="bc-signin-code">
            <span className="bc-code">{phase.userCode || '——————'}</span>
            <button type="button" className="bc-signin-btn" onClick={copyCode}>
              {copied ? 'Copied' : 'Copy code'}
            </button>
          </div>
          {phase.verificationUri ? (
            <a
              className="bc-signin-link"
              href={phase.verificationUri}
              target="_blank"
              rel="noopener noreferrer"
            >
              {phase.verificationUri}
            </a>
          ) : null}
          <p className="bc-signin-text">
            {timeLeft
              ? `Code expires in ${timeLeft}`
              : 'This code has expired — cancel and try again.'}
          </p>
          <button type="button" className="bc-signin-btn" onClick={onCancel}>
            Cancel
          </button>
        </Plate>
      </div>
    </div>
  )
}
