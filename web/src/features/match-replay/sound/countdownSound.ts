// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * countdownSound.ts — THE PRE-GAME COUNTDOWN TICK, one beep on each of the 3, 2, 1.
 *
 * The game's own countdown tick: Wwise event `play_002_ui_menu_frontend_countdown_0` of the
 * interface's global bank `sb_002_ui_global` (one embedded media, a ~0.25 s beep in a 1.66 s
 * file). It is extracted from the user's install by the sound library build
 * (`internal/uisounds`, the same job as the announcer and reload sounds) into the data
 * directory's sound folder; it is never committed. Not extracted yet (an older library, an
 * install without the bank): the file answers 404, the player memorizes the absence, and the
 * countdown stays silent. No final or "go" tone was found next to the tick, so the countdown
 * plays the same beep on each number and nothing at the end.
 *
 * Through the replay's player (`useReplaySound.countdownTick`): sound off, silence; the volume
 * is the replay's.
 */

/** The file of the tick, in `static/sounds/halo_infinite/` (`internal/uisounds.Sounds`). */
export const COUNTDOWN_TICK_STEM = 'ui_countdown_tick'
