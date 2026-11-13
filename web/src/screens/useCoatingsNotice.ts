/**
 * useCoatingsNotice — the match viewer's quiet top-bar notice about the Ekur coating reference.
 *
 * It fetches `GET /api/coatings/status` once (no polling, no refetch on mount) and reduces the
 * response to a single text to render, or `null` while loading and when everything is fine.
 * The text is the one the server's own words describe: coatings off because there is no (or an
 * invalid) Ekur export, or coatings incomplete because the export does not know some of the
 * materials. The decision lives in `coatingNoticeOf`, a pure function so the three texts and
 * the "nothing to show" cases are tested without touching the network.
 */
import { useEffect, useState } from 'react'

import { fetchCoatingsStatus, type CoatingsStatusBody } from '../lib/api/standalone'

/** The three texts the notice can carry; `null` says render nothing. */
export type CoatingsNotice = string | null

/** The tooltip the notice button carries when it has a text. */
export const COATING_NOTICE_TOOLTIP =
  'Set IT3D_EKUR_DIR to a full Ekur export and restart the server to paint every piece.'

/** Reduces one coating status body to the notice text (or `null` when everything is fine).
 *  Pure, so it is tested without the network. Precedence: a missing or invalid export wins
 *  over a partial one, because it is the larger problem and the fix (point at a real export)
 *  clears both. */
export function coatingNoticeOf(body: CoatingsStatusBody): CoatingsNotice {
  if (body.export === 'not_set') return 'Coatings off: no Ekur export found'
  if (body.export === 'invalid') return 'Coatings off: the Ekur export is invalid'
  const missing = [
    body.libraries.spartan_pieces.materialsMissing,
    body.libraries.weapons.materialsMissing,
    body.libraries.first_person.materialsMissing,
  ].reduce((sum, n) => sum + n, 0)
  if (missing > 0) return `Coatings incomplete: ${missing} pieces are missing from the Ekur export`
  return null
}

export interface UseCoatingsNoticeResult {
  /** `null` while loading, when the fetch fails (the viewer shows nothing rather than guess),
   *  and when everything is fine. */
  notice: CoatingsNotice
  /** Whether the status has been fetched and reduced yet (false while loading). */
  ready: boolean
}

/** Fetches the coating status once and reduces it to the notice text. */
export function useCoatingsNotice(): UseCoatingsNoticeResult {
  const [notice, setNotice] = useState<CoatingsNotice>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const body = await fetchCoatingsStatus(controller.signal)
        if (controller.signal.aborted) return
        setNotice(coatingNoticeOf(body))
      } catch (err) {
        // Signed out, server down, or an older server without the route: the viewer renders
        // nothing rather than show a guess.
        if (controller.signal.aborted) return
        setNotice(null)
      } finally {
        if (!controller.signal.aborted) setReady(true)
      }
    })()
    return () => controller.abort()
  }, [])

  return { notice, ready }
}
