/**
 * roundOverSound.ts — THE "ROUND ENDED" SOUND (announcer voice), dated to the round transition.
 *
 * A FILE APART, on the model of `zoneSound.ts` and `objectiveSound.ts`: the general manifest
 * (`replaySound.ts`) is at its size ceiling, and this family has its source, its key and its
 * doctrine. The stub that described this wiring already lived there (the objective sounds block);
 * it is here implemented, identical to what it announced — a stem table, a `roundOverSoundEvents`.
 *
 * WHEN. At each ROUND TRANSITION (`roundTransitions`, `roundsLogic`) — the exact moment where
 * the inter-round overlay (`ReplayRoundBreakOverlay`) shows "Round N ended". The two share the
 * SAME measurement, through the SAME clock guard (`scoreTimelineOf`, which stays silent on a
 * film whose origin is not resolved): a sound that would go out on the raw clock would sound
 * next to its message. On a single-round mode, `roundTransitions` is empty: nothing sounds.
 *
 * AND THIS TRANSITION IS THE END OF THE ROUND SINCE 2026-08-29, no longer the start of the next
 * one: the voice was arriving 19 to 34 s late (measurement of the four multi-round witnesses,
 * cf. the header of `roundsLogic`) — the announcer was saying "round ended" while the next round
 * was already launched. Nothing to change here: this file does not date anything itself, it reads
 * the shared bound.
 *
 * LOCALE-AWARE, like the END OF MATCH voice (`endMatchSound.ts`): an ANNOUNCER VOICE has a
 * language. The two packs (FR and EN) are extracted from the game, and the language played is
 * that of the INTERFACE (prop `locale` of the replay page) — not that of the game at the moment
 * of the match, which the film does not publish. It is the ONLY locale-aware entry of the TRACK
 * (the end-of-match sounds do not go through the track): hence the `locale` parameter added to
 * `buildSoundTimeline`, served once at construction — the stem is therefore frozen, not drawn at
 * playback like a variant.
 *
 * OBJECTIVE CATEGORY, like the zone state sounds: it is a sound of the mode's PLAY, not a weapon
 * nor an equipment. The settings drawer cuts it with the "Objectives" checkbox.
 *
 * OUT OF THE VOICE CEILING (`announcer`, rule `soundOccupiesVoice`): the end of a round lands in
 * the middle of the last shots, throws and explosions, which hold the eight voices; an announcer
 * voice subject to the ceiling would be silently refused there.
 *
 * No React, no Web Audio: pure logic, tested (`roundOverSound.test.ts`). The guardrail
 * `replaySoundAssets.guard.test.ts` replays these two stems against the assets folder, like the
 * others — a stem without a file, or a file without a stem, breaks the test, never the listening.
 */
import { scoreTimelineOf } from '@/lib/replay/scoreTimeline'

import type { ReplayLocale } from '../i18n/i18n'
import { frameToMs } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { soundEvent, type ReplaySoundEvent } from './replaySoundVariants'
import { roundTransitions } from '../model/roundsLogic'

/**
 * The stem of the "round ended" voice, by language. Extracted from the game (announcer pack
 * provided by the user): FR `257984770`, EN `327120953`, renamed in a speaking stem.
 */
export const ROUND_OVER_SOUND_STEMS: Readonly<Record<ReplayLocale, string>> = {
  fr: 'round_over_fr',
  en: 'round_over_en',
}

/**
 * roundOverSoundEvents — one sound per round transition, in the language of the interface.
 *
 * Returns an empty list when the mode has only one round (no transition), or when the film's
 * clock is not realigned (guard of `scoreTimelineOf`) — same silence as the inter-round overlay.
 */
export function roundOverSoundEvents(
  doc: ReplayDocumentReady,
  locale: ReplayLocale,
): ReplaySoundEvent[] {
  const transitions = roundTransitions(scoreTimelineOf(doc))
  if (transitions.length === 0) return []
  const stem = ROUND_OVER_SOUND_STEMS[locale]
  return transitions.map((tr) => ({ ...soundEvent(frameToMs(tr.frame, doc), stem), announcer: true }))
}
