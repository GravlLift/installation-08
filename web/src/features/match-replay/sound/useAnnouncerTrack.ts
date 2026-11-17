// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useAnnouncerTrack.ts — the announcer's inputs to the sound track, with the extracted voice.
 *
 * Extracted from `useReplaySound.ts` (over its size threshold) when the extracted lines arrived:
 * the hook gets one memo back, and the manifest load lives here. The manifest is read ONCE per
 * page (`loadAnnouncerVoiceOnce`): every replay of the session shares it, and a 404 (nothing
 * extracted) is remembered as "bundled lines only" without retrying.
 */
import { useEffect, useMemo, useState } from 'react'

import type { ReplayLocale } from '../i18n/i18n'
import type { AnnouncerMatch } from './announcerMatchCalls'
import type { AnnouncerTrackInput, FeedMedal } from './announcerSound'
import { loadAnnouncerManifest, manifestVoice, type AnnouncerVoice } from './announcerVoice'

let voiceOnce: Promise<AnnouncerVoice | null> | null = null

/** The extracted voice, loaded once per page; `null` = nothing extracted. */
export function loadAnnouncerVoiceOnce(): Promise<AnnouncerVoice | null> {
  voiceOnce ??= loadAnnouncerManifest().then((m) => (m ? manifestVoice(m) : null))
  return voiceOnce
}

/** What the page gives the announcer (`ReplaySoundContext`). */
export interface AnnouncerContext {
  /** The LANGUAGE of the interface: it serves ONLY the announcer (`announcerSound.ts`), the only
   * locale-aware entry of the track. Absent, the announcer stays silent. */
  locale: ReplayLocale | undefined
  /** The FOLLOWED player (point of view): only their own medal calls play. Changing it rebuilds the track. */
  followed: string | null
  /** The medals of the aligned feed (`medalsOfFeed`), on the replay axis. */
  medals: readonly FeedMedal[]
  /** The match context's mode, clock and overtime (`useMatchReplayContext`); absent = no match call. */
  match?: AnnouncerMatch
}

/**
 * useAnnouncerTrack — the announcer's track input, or `undefined` without a language (a voice has
 * one). The track first builds with the bundled lines, then once more when the voice arrives.
 * NOTHING IS DOWNLOADED BEFORE THE SOUND IS ON (`enabled`), the rule of the whole sound chain:
 * the manifest is read at the first activation, like every sound file, and never without a language.
 */
export function useAnnouncerTrack(
  context: AnnouncerContext,
  enabled: boolean,
  load: () => Promise<AnnouncerVoice | null> = loadAnnouncerVoiceOnce,
): AnnouncerTrackInput | undefined {
  const { locale, followed, medals, match } = context
  const [voice, setVoice] = useState<AnnouncerVoice | undefined>(undefined)
  useEffect(() => {
    if (!enabled || !locale) return
    let live = true
    void load().then((v) => {
      if (live && v) setVoice(v)
    })
    return () => {
      live = false
    }
  }, [enabled, locale, load])
  return useMemo(() => (locale ? { locale, followed, medals, voice, match } : undefined), [locale, followed, medals, voice, match])
}
