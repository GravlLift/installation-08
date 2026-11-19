// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * introSound.ts — THE INTRO MUSIC of the replay (item 7 of the backlog, decision D-8 of 2026-09-26).
 *
 * A THREE-SECOND EXCERPT, NOT A TRACK. The source is the rise of the multiplayer theme
 * (`402178411`, `sb_130_mus_multiplayer_global`, 16 s in 4 channels). The excerpt covers
 * [R − 1 s ; R + 2 s], where R is the RESOLUTION of the rise, its last strong attack (3.19 s
 * in the source, measured 2026-09-27). The replay preamble lasts one second (`LEAD_IN_MS`):
 * launched at the start of playback, the excerpt therefore lands its resolution on the kickoff, at
 * 1x.
 *
 * WHEN IT GOES OUT, AND WHEN IT STAYS SILENT:
 *  - only at THE START FROM THE PREAMBLE ("Play" at open, "Restart",
 *    "Play" on a finished replay) — that is playback that knows it (`useReplayPlayback`,
 *    option `onStarted`). Never on a resume, a drag, a jump, a tactical link or an
 *    automatic playback;
 *  - through the ORDINARY PATH of the player (`playFrom`, voice ceiling included): sound off or
 *    speed beyond SOUND_MAX_SPEED, it stays silent like everything else;
 *  - ABSENT FROM THE EXPORT: a clip starts where the user frames it, not at the preamble. It is
 *    nonetheless shelved as MUSIC in the export families (`exportSoundFamilies.ts`),
 *    so that the classification stays true the day it would enter.
 *
 * Its duration and format are kept by `replaySoundAssets.guard.test.ts`.
 *
 * A LATE BUFFER STAYS ALIGNED (A4.9, DA-9). At the first "Play" after a reload, the
 * audio player is born in that click and the excerpt is not yet decoded: the ordinary path
 * was skipping it. `playIntroAligned` therefore waits for the decoding, then enters the buffer with an
 * OFFSET equal to the wall time elapsed since the gesture. The buffer plays in real time, without
 * acceleration, so that offset is also that of the buffer, and the resolution stays where it
 * would have landed. If the wait exceeds what was left of the on-screen preamble
 * (`introLateBoundS`), the kickoff is past: silence, never a rise offset from its
 * image.
 */
import { LEAD_IN_MS } from '../model/replayWindow'
import type { ReplayAudioPlayer } from './replayAudio'

/** The file of the excerpt, in `static/sounds/halo_infinite/`. */
export const INTRO_MUSIC_STEM = 'intro_music_01'


/** The admitted delay, in seconds: the duration of the preamble ON SCREEN at that speed (1 s at 1x). */
export function introLateBoundS(speed: number): number {
  return LEAD_IN_MS / 1000 / speed
}

/**
 * THE WHOLE THEME, WHEN THE INSTALL GIVES IT (`FootstepManifest.intro`, `internal/footstepsounds/
 * intro.go`): the excerpt above stops 2 s after the resolution at about -21 dB, an abrupt cut
 * (Jordan, 0.1.1-test.7), while the theme rings out after it on its own (-17 dB at 4 s, -36 dB
 * at 12.5 s, silent by 14 s). Entered here, at R - 1 s, it lands the same resolution on the
 * kickoff and ends on the game's decay. Without it, the shipped excerpt plays as before.
 */
export const INTRO_THEME_START_S = 3.19 - 1

/** One file the intro can play, and where in it the intro starts. */
export interface IntroSource {
  url: string
  startS: number
}

/**
 * playIntroAligned plays the excerpt immediately if it is decoded, otherwise as soon as it is, entered at
 * the moment it should have gone out, or not at all beyond the bound (cf. the header).
 * `nowMs` is the wall clock, injected by the tests.
 */
export async function playIntroAligned(
  player: Pick<ReplayAudioPlayer, 'isLoaded' | 'whenLoaded' | 'playFrom'>,
  url: string,
  speed: number,
  nowMs: () => number = () => performance.now(),
): Promise<void> {
  return playIntroFrom(player, [{ url, startS: 0 }], speed, nowMs)
}

/**
 * playIntroFrom is playIntroAligned over SOURCES in order of preference (the whole theme, then
 * the excerpt): the first that decodes plays, entered at its start plus the wait, within the
 * same bound; one that fails to load hands over to the next.
 */
export async function playIntroFrom(
  player: Pick<ReplayAudioPlayer, 'isLoaded' | 'whenLoaded' | 'playFrom'>,
  sources: readonly IntroSource[],
  speed: number,
  nowMs: () => number = () => performance.now(),
): Promise<void> {
  const first = sources[0]
  if (!first) return
  if (player.isLoaded(first.url)) return player.playFrom(first.url, first.startS)
  const geste = nowMs()
  for (const s of sources) {
    await player.whenLoaded(s.url)
    if (!player.isLoaded(s.url)) continue
    const retardS = (nowMs() - geste) / 1000
    if (retardS <= introLateBoundS(speed)) player.playFrom(s.url, s.startS + retardS)
    return
  }
}
