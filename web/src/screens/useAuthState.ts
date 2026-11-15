/**
 * useAuthState — drives the home screen's account panel: checks the sign-in state once on
 * mount, lets the caller start a sign-in or sign out, and polls the state route every `pollMs`
 * while a sign-in is pending (a device code is waiting to be entered on Microsoft's page),
 * stopping the moment it leaves `pending` (and always on unmount).
 *
 * Mirrors `useMeshBuild.ts`'s shape on purpose: one effect for the initial check, one effect for
 * polling keyed on the phase's tag (not the whole object, so a tick that only updates countdown
 * fields never tears the interval down), and a single-flight guard read through a ref so the
 * polling callback always sees the latest phase without depending on it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  ApiError,
  fetchAuthState,
  requestLogout,
  startLogin,
  type AuthStateBody,
} from '../lib/api/standalone'

export type AuthPhase =
  | { phase: 'loading' }
  | { phase: 'signed_out' }
  | { phase: 'pending'; verificationUri: string; userCode: string; expiresAt: string }
  | { phase: 'signed_in'; gamertag: string }
  | { phase: 'failed'; error: string }

/** Default polling interval while sign-in is pending. */
export const AUTH_STATE_POLL_MS = 2000

/** Turns one `/api/auth/state` body into the phase the panel renders. Pure, so it is tested
 *  without touching the network or a timer. */
export function phaseOfAuthState(body: AuthStateBody): AuthPhase {
  switch (body.state) {
    case 'signed_out':
      return { phase: 'signed_out' }
    case 'pending':
      return {
        phase: 'pending',
        verificationUri: body.verificationUri ?? '',
        userCode: body.userCode ?? '',
        expiresAt: body.expiresAt ?? '',
      }
    case 'signed_in':
      return { phase: 'signed_in', gamertag: body.gamertag ?? '' }
    case 'failed':
      return { phase: 'failed', error: body.error ?? 'sign-in failed' }
  }
}

/** Whether `phase` needs another poll (a sign-in is waiting on the device code). */
export function isAuthPending(phase: AuthPhase): boolean {
  return phase.phase === 'pending'
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : String(err)
}

export interface UseAuthStateResult {
  phase: AuthPhase
  /** Starts (or joins) sign-in. No-op while a sign-in is already pending. */
  login: () => void
  /** Cancels a pending sign-in, or signs out an already-signed-in account. */
  logout: () => void
  /** The server is read-only (`--read-only`): sign-in is impossible there. */
  readOnly: boolean
}

export function useAuthState(pollMs: number = AUTH_STATE_POLL_MS): UseAuthStateResult {
  const [phase, setPhase] = useState<AuthPhase>({ phase: 'loading' })
  const [readOnly, setReadOnly] = useState(false)
  // Read inside the login/logout callbacks without making `phase` their dependency.
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  useEffect(() => {
    const controller = new AbortController()
    setPhase({ phase: 'loading' })
    void (async () => {
      try {
        const body = await fetchAuthState(controller.signal)
        if (controller.signal.aborted) return
        setReadOnly(body.readOnly === true)
        setPhase(phaseOfAuthState(body))
      } catch (err) {
        if (controller.signal.aborted) return
        setPhase({ phase: 'failed', error: errorMessage(err) })
      }
    })()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!isAuthPending(phase)) return
    const controller = new AbortController()
    // EXACTLY ONE pending poll at a time, same guard as `useMeshBuild.ts`: a slow response must
    // never let the interval queue a second request before the first one lands.
    let polling = false
    const id = setInterval(() => {
      if (polling) return
      polling = true
      void (async () => {
        try {
          const body = await fetchAuthState(controller.signal)
          if (controller.signal.aborted) return
          setPhase(phaseOfAuthState(body))
        } catch (err) {
          if (controller.signal.aborted) return
          setPhase({ phase: 'failed', error: errorMessage(err) })
        } finally {
          polling = false
        }
      })()
    }, pollMs)
    return () => {
      clearInterval(id)
      controller.abort()
    }
    // `phase.phase` (not the whole object) is the dependency — see the file header.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.phase, pollMs])

  const login = useCallback(() => {
    if (isAuthPending(phaseRef.current)) return
    const controller = new AbortController()
    setPhase({ phase: 'loading' })
    void (async () => {
      try {
        const body = await startLogin(controller.signal)
        setPhase(phaseOfAuthState(body))
      } catch (err) {
        setPhase({ phase: 'failed', error: errorMessage(err) })
      }
    })()
  }, [])

  const logout = useCallback(() => {
    const controller = new AbortController()
    setPhase({ phase: 'loading' })
    void (async () => {
      try {
        const body = await requestLogout(controller.signal)
        setPhase(phaseOfAuthState(body))
      } catch (err) {
        setPhase({ phase: 'failed', error: errorMessage(err) })
      }
    })()
  }, [])

  return { phase, login, logout, readOnly }
}
