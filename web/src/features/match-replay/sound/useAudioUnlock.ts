// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useAudioUnlock — THE PLAYER OPENS ON THE FIRST GESTURE ON THE PAGE, WHATEVER IT IS, when the
 * preference is "enabled" (item 12 of the backlog plan of 2026-09-26, decision D-10).
 *
 * THE MEASURED DEFECT (A2.0, Chromium and Firefox, default autoplay policy). Only "Play",
 * "Restart" and the sound button opened the player. With automatic playback, the playback starts
 * without any of these gestures: the replay stayed silent, click elsewhere on the page or not,
 * until the sound button was touched. Going from one replay to another without reloading, same
 * silence, even though the document had already received a gesture.
 *
 * TWO RULES, and the browsers' autoplay policy is never bypassed:
 *  - the document HAS ALREADY received a gesture (`navigator.userActivation.hasBeenActive`,
 *    case of going from one replay to another): the player opens as soon as it is displayed.
 *    Chromium and Firefox allow an audio context on an acquired activation;
 *  - otherwise, a unique listener waits for the first gesture on the document, opens the player,
 *    and removes itself. Never any sound without a prior gesture.
 *
 * `click` AND `keyup`, NOT `pointerdown` NOR `keydown`, AND THAT IS A CONDITION OF THE FIX OF
 * 2026-08-27. The first click on the sound button must ACTIVATE. Now `pointerdown` precedes the
 * `click` of the button, and the M key acts on `keydown`, listened by the window AFTER the
 * document. A listener on these two events would therefore open the player before the toggle,
 * which would find it alive and CUT. On `click` and `keyup`, the document passes after the
 * button and after the shortcut. The activation, it, is acquired as of `pointerdown` or
 * `keydown`: the context born in `click` or `keyup` starts in operation (measured at the same
 * A2.0).
 *
 * `open` is `wake`: no effect if the preference is "off" or if the player is already alive.
 */
import { useEffect, useRef } from 'react'

/** The gestures that open the player: see the header for the choice of events. */
const UNLOCK_EVENTS = ['click', 'keyup'] as const

export function useAudioUnlock(wanted: boolean, open: () => void): void {
  // `open` READ BY A REF: it changes identity with the player settings, and the listener
  // must not be removed and re-posed at each render for that.
  const openRef = useRef(open)
  useEffect(() => { openRef.current = open }, [open])
  useEffect(() => {
    if (!wanted) return
    if (navigator.userActivation?.hasBeenActive) {
      openRef.current()
      return
    }
    const onGesture = () => {
      for (const type of UNLOCK_EVENTS) document.removeEventListener(type, onGesture)
      openRef.current()
    }
    for (const type of UNLOCK_EVENTS) document.addEventListener(type, onGesture)
    return () => {
      for (const type of UNLOCK_EVENTS) document.removeEventListener(type, onGesture)
    }
  }, [wanted])
}
