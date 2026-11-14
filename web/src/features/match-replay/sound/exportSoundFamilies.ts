/**
 * exportSoundFamilies.ts — what the OFFLINE EXPORT receives from the page's sound, in addition to
 * the track: the end-of-match takes it will play, and the voice / music classification of its
 * separate tracks.
 *
 * EXTRACTED FROM `useReplaySound.ts` ON 2026-09-27 (item 7, intro music): the hook is over
 * its size threshold and must not grow. The lot added it a command; these two
 * pure functions, without React, were extracted to compensate. Nothing changed in their logic, except
 * the intro music's entry into the "music" family.
 */
import {
  END_FFA_WIN_VOICE_STEMS,
  END_MUSIC_STEMS,
  END_VOICE_STEMS,
  endMatchSoundsOf,
  type EndMatchSoundSpec,
} from './endMatchSound'
import type { ReplayLocale } from '../i18n/i18n'
import { announcerStems } from './announcerSound'
import { INTRO_MUSIC_STEM } from './introSound'
import { seededRandom } from './replayAudioMix'

/**
 * endMatchSoundsFor — the end takes THAT THE EXPORT WILL PLAY, seeded draw.
 *
 * The real-time path draws randomly at each arrival at end; a file, it, must sound
 * the same on each export of the same match (decision D7 of the export plan).
 */
export function endMatchSoundsFor(spec: EndMatchSoundSpec | null): string[] {
  if (!spec) return []
  return endMatchSoundsOf(spec, seededRandom(spec.outcome.length))
}

/**
 * soundFamiliesFor — which stems are of the VOICE, which stems are of the MUSIC.
 *
 * It lists ALL possible takes, not only the one that was drawn: the classification must
 * hold whatever the draw, and an extra stem in the list costs nothing (nothing will
 * play it).
 *
 * THE ANNOUNCER'S CALLS ARE OF THE VOICE (`announcerStems`, today the round-end voice). They live
 * in the track, mixed in with the sound effects, and they are the only voice a mid-match excerpt
 * can contain.
 *
 * THE INTRO MUSIC IS OF THE MUSIC, even if the export does not play it (decision D-8): the
 * classification says what a stem is, not whether it sounds in the clip.
 */
export function soundFamiliesFor(
  spec: EndMatchSoundSpec | null,
  /** Missing (old calls), the announcer is not in the track either. */
  locale: ReplayLocale | undefined,
): { voice: readonly string[]; music: readonly string[] } {
  const voice: string[] = locale ? announcerStems(locale) : []
  const music: string[] = [INTRO_MUSIC_STEM]
  if (spec) {
    voice.push(...END_FFA_WIN_VOICE_STEMS[spec.locale])
    for (const parIssue of Object.values(END_VOICE_STEMS)) voice.push(...parIssue[spec.locale])
    music.push(...Object.values(END_MUSIC_STEMS))
  }
  return { voice, music }
}
